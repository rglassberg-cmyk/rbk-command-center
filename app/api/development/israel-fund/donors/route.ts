import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// GET /api/development/israel-fund/donors?initiative=ENCODED_NAME
//
// Donor drill-down for a single Israel Fund initiative. Reads recent
// gifts from `gifts_cache` and returns up to 100 most-recent rows.
//
// Match rules:
//   - APL:/DEV: prefix match on the supplied initiative name, OR
//   - exact case-insensitive match on the un-prefixed event name
// This keeps the donor list aligned with the same prefixes the raised
// cache sync respects. Anonymous gifts are returned with name =
// "Anonymous" so the UI doesn't need to know the constituent.
//
// Veracross historical gap: `/v3/development/gifts` only returns the
// most recent ~year of data. Initiatives whose entire donor activity
// predates that window will come back empty here — the page surfaces a
// friendly notice in that case.

interface GiftRow {
  constituent_name: string | null;
  amount: number | null;
  date: string | null;
  anonymous: boolean | null;
  gift_type: number | null;
}

interface DonorOut {
  name: string;
  amount: number;
  date: string | null;
  anonymous: boolean;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gating
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch { /* fail open */ }

  const initiative = (new URL(request.url).searchParams.get('initiative') ?? '').trim();
  if (!initiative) {
    return NextResponse.json({ error: 'initiative required' }, { status: 400 });
  }

  try {
    // Pull a broader External Funds slice and filter by normalized
    // event name in JS — gifts_cache row counts are small enough that
    // a single paginated scan is cheaper than three separate queries.
    const collected: GiftRow[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('constituent_name, amount, date, anonymous, gift_type, event')
        .eq('workspace_id', wsId)
        .ilike('fundraising_activity', '%External Funds%')
        .not('event', 'is', null)
        // Exclude soft-credit rows (gift_type 3 + 5) — they duplicate
        // the underlying hard-credit gift and were causing each donor
        // to appear twice in the drill-down.
        .not('gift_type', 'in', '(3,5)')
        .gt('amount', 0)
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[israel-fund/donors] query failed:', error);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      collected.push(...(data as Array<GiftRow & { event: string | null }>));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const target = initiative.toLowerCase();
    const matches = (collected as Array<GiftRow & { event: string | null }>).filter(r => {
      const ev = (r.event ?? '').trim();
      if (!ev) return false;
      const stripped = ev.replace(/^(APL:|DEV:)\s*/i, '').trim().toLowerCase();
      return stripped === target || ev.toLowerCase() === `apl: ${target}` || ev.toLowerCase() === `dev: ${target}`;
    });

    // Sort by date DESC, amount DESC for ties.
    matches.sort((a, b) => {
      const ad = a.date ?? '';
      const bd = b.date ?? '';
      if (ad !== bd) return ad < bd ? 1 : -1;
      return Number(b.amount ?? 0) - Number(a.amount ?? 0);
    });

    const donors: DonorOut[] = matches.slice(0, 100).map(r => ({
      name: r.anonymous ? 'Anonymous' : (r.constituent_name?.trim() || 'Anonymous'),
      amount: Number(r.amount ?? 0),
      date: r.date,
      anonymous: Boolean(r.anonymous),
    }));

    return NextResponse.json({
      donors,
      hasMore: matches.length > 100,
      totalMatched: matches.length,
    });
  } catch (err) {
    console.error('[israel-fund/donors] exception:', err);
    return NextResponse.json({ error: 'Exception' }, { status: 500 });
  }
}
