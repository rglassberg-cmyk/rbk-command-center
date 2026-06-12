import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getDevelopmentToken(): Promise<string> {
  const clientId = process.env.VERACROSS_DEVELOPMENT_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_DEVELOPMENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing development credentials');

  const res = await fetch('https://accounts.veracross.com/sar/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'development.gifts:list development.gifts:read development.constituents:list development.constituents:read',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token failed: ${res.status} — ${err}`);
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

export async function POST(request: NextRequest) {
  // Auth via shared secret
  const secret = request.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = request.headers.get('x-workspace-id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspace ID' }, { status: 400 });
  }

  const url = new URL(request.url);
  // Optional explicit start date. When supplied, takes precedence over
  // the `years` shortcut and is passed straight to Veracross as the
  // `date_from` filter on /v3/development/gifts. Format: YYYY-MM-DD.
  // Falls back gracefully to the years-based start when not provided
  // so existing callers (the nightly backfill) keep working.
  const startDateParam = url.searchParams.get('start_date');
  const yearsParam = parseInt(url.searchParams.get('years') || '5');
  const years = Math.min(Math.max(yearsParam, 1), 10);
  let startDateStr: string;
  if (startDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)) {
    startDateStr = startDateParam;
  } else {
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);
    startDateStr = startDate.toISOString().split('T')[0];
  }

  console.log(`[BACKFILL] Starting backfill from ${startDateStr} (param=${startDateParam ?? `${years}y default`}) for workspace ${workspaceId}`);

  // Return immediately, run backfill in background
  after(async () => {
    const startMs = Date.now();
    try {
      const token = await getDevelopmentToken();
      const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
      const baseUrl = `https://api.veracross.com/${schoolRoute}/v3/development/gifts`;
      // 2026-06-03: Veracross v3 `/v3/development/gifts` rejects both
      // `?date_from=...` (400 unknown param) and `?query_string=...`
      // (400 "Unknown parameters were provided: query_string"). No
      // server-side date filter is exposed. Fallback: page the full
      // history and filter client-side at upsert time. Page cap
      // bumped from 50 → 100 to cover SAR's full historical volume
      // (~13k current cache + ~30k pre-cache estimate). Each page is
      // 1000 rows so 100k is the worst-case fetch.
      console.log(`[BACKFILL] Veracross URL: ${baseUrl} (no server-side date filter; client-side filter on date >= ${startDateStr})`);

      let totalFetched = 0;
      let totalUpserted = 0;
      let pageNum = 1;

      while (pageNum <= 100) {
        const res = await fetch(baseUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'X-Page-Size': '1000',
            'X-Page-Number': String(pageNum),
          },
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.error(`[BACKFILL] Page ${pageNum} fetch error:`, res.status, errBody.slice(0, 500));
          break;
        }

        const json = await res.json();
        const pageData = json.data || [];
        if (pageData.length === 0) break;

        // Client-side date filter — only keep rows with date >= start.
        // Veracross dates are YYYY-MM-DD strings so lexicographic comparison
        // is equivalent to chronological.
        const filteredPageData = pageData.filter((g: any) =>
          typeof g.date === 'string' && g.date >= startDateStr
        );
        totalFetched += pageData.length;
        if (filteredPageData.length === 0) {
          // Page contained no in-range gifts — could be ahead-of-range or
          // behind-range. Continue paging just in case Veracross's
          // ordering isn't strict desc-by-date.
          if (pageData.length < 1000) break;
          pageNum++;
          continue;
        }

        // Prepare rows for upsert
        const syncedAt = new Date().toISOString();
        const rows = filteredPageData.map((g: any) => ({
          id: g.id,
          workspace_id: workspaceId,
          gift_type: g.gift_type,
          constituent_id: g.constituent_id,
          constituent_name: g.constituent_name,
          date: g.date,
          amount: g.amount,
          fund: g.fund,
          event: g.event,
          fundraising_activity: g.fundraising_activity,
          apply_to_pledge: g.apply_to_pledge,
          anonymous: g.anonymous,
          in_kind_gift_description: g.in_kind_gift_description,
          soft_credit_type: g.soft_credit_type,
          hard_credit_gift_id: g.hard_credit_gift_id,
          raw_data: g,
          synced_at: syncedAt,
        }));

        // Upsert in batches of 500
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          const { error } = await supabaseAdmin
            .from('gifts_cache')
            .upsert(batch, { onConflict: 'id' });
          if (error) {
            console.error(`[BACKFILL] Upsert error page ${pageNum}:`, error.message);
          }
        }

        totalUpserted += filteredPageData.length;
        console.log(`[BACKFILL] Page ${pageNum}: fetched ${pageData.length}, upserted ${filteredPageData.length} (in-range), total fetched=${totalFetched} upserted=${totalUpserted}`);

        if (pageData.length < 1000) break;
        pageNum++;
      }

      // Update sync meta
      await supabaseAdmin.from('gifts_sync_meta').upsert({
        workspace_id: workspaceId,
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_count: totalUpserted,
        last_sync_error: null,
      }, { onConflict: 'workspace_id' });

      console.log(`[BACKFILL] Complete in ${Date.now() - startMs}ms. Fetched ${totalFetched}, upserted ${totalUpserted} gifts from ${startDateStr}`);
    } catch (err) {
      console.error(`[BACKFILL] Failed in ${Date.now() - startMs}ms:`, err);
      try {
        await supabaseAdmin.from('gifts_sync_meta').upsert({
          workspace_id: workspaceId,
          last_sync_at: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_count: 0,
          last_sync_error: err instanceof Error ? err.message : String(err),
        }, { onConflict: 'workspace_id' });
      } catch { /* ignore */ }
    }
  });

  return NextResponse.json({
    success: true,
    message: startDateParam
      ? `Backfill started in background from explicit start_date=${startDateStr}`
      : `Backfill started in background for ${years} years from ${startDateStr}`,
    dateRange: { from: startDateStr, to: new Date().toISOString().split('T')[0] },
  }, { status: 202 });
}
