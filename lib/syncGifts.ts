import { supabaseAdmin } from '@/lib/supabase';
import { syncIsraelFundRaisedCache } from '@/lib/syncIsraelFundRaised';
import { sendSlackDM } from '@/lib/slackNotifications';
import { getSlackCredentials } from '@/lib/getIntegration';

// Sara Hasson — Development. Receives the "new major gift" alert
// every time a sync surfaces a fresh operating gift ≥ $1,000.
const SARA_SLACK_USER_ID = 'U04NB3YP3';
const MAJOR_GIFT_THRESHOLD = 1000;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface VcPledge {
  balance: number | null;
  total_received: number | null;
  total_writeoff: number | null;
  increment: number | null;
  start_date: string | null;
  payment_frequency: number | null;
}

interface VcGift {
  id: number;
  gift_type: number;
  constituent_id: number;
  constituent_name: string;
  date: string;
  amount: number;
  fund: string | null;
  event: string | null;
  soft_credit_type: number | null;
  hard_credit_gift_id: number | null;
  fundraising_activity: string | null;
  apply_to_pledge: boolean | null;
  anonymous: boolean | null;
  in_kind_gift_description: string | null;
  pledge: VcPledge | null;
  thank_you_letter_date: string | null;
  constituent_record_type: string | number | null;
  [key: string]: unknown;
}

// Veracross payment_frequency codes → human-readable labels.
// Most pledges at SAR carry code 8 (custom/none) which we map to null.
const PAYMENT_FREQUENCY_LABELS: Record<string, string> = {
  '1': 'Annual',
  '2': 'Semi-Annual',
  '3': 'Quarterly',
  '4': 'Monthly',
  '5': 'Weekly',
  '6': 'Bi-Weekly',
  '7': 'One-Time',
};

function mapPaymentFrequency(code: number | null | undefined): string | null {
  if (code == null) return null;
  return PAYMENT_FREQUENCY_LABELS[String(code)] ?? null;
}

// Veracross /v3/development/gifts does not expose granular development roles
// (Parent / Alumni / etc.) on the gift record. As a placeholder we derive a
// coarse role from constituent_record_type until the constituents endpoint
// is wired up. Code 2 = household, 3 = organization at SAR.
function mapPrimaryDevelopmentRole(recordType: string | number | null | undefined): string | null {
  if (recordType == null) return null;
  const key = String(recordType);
  if (key === '2') return 'Household';
  if (key === '3') return 'Organization';
  return null;
}

async function getDevelopmentToken(): Promise<string> {
  const clientId = process.env.VERACROSS_DEVELOPMENT_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_DEVELOPMENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing VERACROSS_DEVELOPMENT_CLIENT_ID or VERACROSS_DEVELOPMENT_CLIENT_SECRET');
  }

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
    console.error('[SYNC GIFTS] Token error:', res.status, err);
    throw new Error(`Token request failed: ${res.status}`);
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

async function fetchAllGiftsFromVeracross(): Promise<VcGift[]> {
  const token = await getDevelopmentToken();
  const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
  const baseUrl = `https://api.veracross.com/${schoolRoute}/v3/development/gifts`;

  // Fetch page 1
  const page1Res = await fetch(baseUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Page-Size': '1000',
      'X-Page-Number': '1',
    },
  });

  if (!page1Res.ok) {
    const err = await page1Res.text();
    throw new Error(`Gifts fetch failed: ${page1Res.status} — ${err}`);
  }

  const page1Json = await page1Res.json();
  const page1Data: VcGift[] = page1Json.data || [];
  if (page1Data.length < 1000) return page1Data;

  let allGifts = [...page1Data];
  const totalCountHeader = page1Res.headers.get('x-total-count');

  if (totalCountHeader) {
    const totalPages = Math.ceil(parseInt(totalCountHeader) / 1000);
    console.log('[SYNC GIFTS] Total pages:', totalPages);

    // Parallel fetch in batches of 5
    for (let batchStart = 2; batchStart <= totalPages; batchStart += 5) {
      const batchEnd = Math.min(batchStart + 4, totalPages);
      const batch = [];
      for (let p = batchStart; p <= batchEnd; p++) {
        batch.push(
          fetch(baseUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
              'X-Page-Size': '1000',
              'X-Page-Number': String(p),
            },
          }).then(async r => {
            if (!r.ok) return [];
            const j = await r.json();
            return (j.data || []) as VcGift[];
          })
        );
      }
      const results = await Promise.all(batch);
      for (const pageData of results) {
        allGifts.push(...pageData);
      }
    }
  } else {
    // Sequential fallback
    console.warn('[SYNC GIFTS] No X-Total-Count header — sequential pagination');
    let pageNum = 2;
    while (pageNum <= 20) {
      const res = await fetch(baseUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-Page-Size': '1000',
          'X-Page-Number': String(pageNum),
        },
      });
      if (!res.ok) break;
      const json = await res.json();
      const pageData: VcGift[] = json.data || [];
      if (pageData.length === 0) break;
      allGifts.push(...pageData);
      if (pageData.length < 1000) break;
      pageNum++;
    }
  }

  return allGifts;
}

export async function syncGiftsForWorkspace(workspaceId: string): Promise<{ success: boolean; count: number; error?: string }> {
  const startMs = Date.now();

  try {
    // 1. Fetch all gifts from Veracross
    console.log('[SYNC GIFTS] Starting sync for workspace:', workspaceId);
    const gifts = await fetchAllGiftsFromVeracross();
    console.log('[SYNC GIFTS] Fetched', gifts.length, 'gifts from Veracross');

    // 2a. Capture the set of gift IDs already in the cache before
    //     the upsert. This lets us identify which rows are genuinely
    //     new (insert) vs. updates so the major-gift Slack alert only
    //     fires for actual new gifts.
    const incomingIds = gifts.map(g => g.id);
    const existingIds = new Set<number>();
    if (incomingIds.length > 0) {
      // Paginate the existence check — Supabase `in()` happily handles
      // thousands of values, but breaking up the IN list keeps any
      // individual query well under URL length limits.
      const idChunkSize = 1000;
      for (let i = 0; i < incomingIds.length; i += idChunkSize) {
        const chunk = incomingIds.slice(i, i + idChunkSize);
        const { data: existingRows } = await supabaseAdmin
          .from('gifts_cache')
          .select('id')
          .eq('workspace_id', workspaceId)
          .in('id', chunk);
        for (const r of (existingRows ?? []) as Array<{ id: number }>) {
          existingIds.add(r.id);
        }
      }
    }

    // 2. Prepare rows for upsert
    const syncedAt = new Date().toISOString();
    const rows = gifts.map(g => ({
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
      pledge_balance: g.pledge?.balance ?? 0,
      thank_you_letter_date: g.thank_you_letter_date || null,
      payment_frequency: mapPaymentFrequency(g.pledge?.payment_frequency),
      primary_development_role: mapPrimaryDevelopmentRole(g.constituent_record_type),
      raw_data: g,
      synced_at: syncedAt,
    }));

    // 3. Upsert in batches of 500
    const batchSize = 500;
    const totalBatches = Math.ceil(rows.length / batchSize);
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const { error } = await supabaseAdmin
        .from('gifts_cache')
        .upsert(batch, { onConflict: 'id' });

      if (error) {
        console.error('[SYNC GIFTS] Upsert batch', batchNum, 'failed:', error);
        throw new Error(`Upsert failed on batch ${batchNum}: ${error.message}`);
      }
      console.log('[SYNC GIFTS] Upserted batch', batchNum, 'of', totalBatches);
    }

    // 4. Update sync meta
    await supabaseAdmin.from('gifts_sync_meta').upsert({
      workspace_id: workspaceId,
      last_sync_at: syncedAt,
      last_sync_status: 'success',
      last_sync_count: gifts.length,
      last_sync_error: null,
    }, { onConflict: 'workspace_id' });

    // 5. Refresh the Israel Fund raised_cache from the newly-upserted
    //    gifts. Independent failure mode — if this throws or returns
    //    !success, the gifts sync itself is still considered a success.
    try {
      const israelResult = await syncIsraelFundRaisedCache(workspaceId);
      if (!israelResult.success) {
        console.warn('[SYNC GIFTS] Israel raised_cache sync returned error:', israelResult.error);
      }
    } catch (israelErr) {
      console.warn('[SYNC GIFTS] Israel raised_cache sync threw:', israelErr);
    }

    // 6. Major-gift Slack alert. Fires once per sync, batched. Filters:
    //      - gift_type === 1 (hard credit / outright donation ONLY).
    //        Veracross writes two rows per gift — a hard credit
    //        (type 1) AND a soft credit (type 3) for the same donor —
    //        so without this filter the alert fired twice per gift.
    //        Also excludes pledges (type 2) and soft-credit pledges
    //        (type 5): we only alert on real money received.
    //      - gift was newly inserted (not in existingIds before upsert)
    //      - amount >= $1,000
    //      - NOT External Funds (Israel Fund — Sara tracks those
    //        separately via the IF page)
    //      - amount > 0 (defensive)
    try {
      const majorGifts = gifts.filter(g => {
        if (g.gift_type !== 1) return false;
        if (existingIds.has(g.id)) return false;
        const amount = Number(g.amount ?? 0);
        if (!(amount >= MAJOR_GIFT_THRESHOLD)) return false;
        const activity = (g.fundraising_activity || '').toLowerCase();
        if (activity.includes('external funds')) return false;
        return true;
      });
      if (majorGifts.length > 0) {
        const { botToken } = await getSlackCredentials(workspaceId);
        if (botToken) {
          const formatMoney = (n: number) =>
            n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
          let message: string;
          if (majorGifts.length === 1) {
            const g = majorGifts[0];
            const eventLine = g.event ? `\n${g.event}` : (g.fund ? `\n${g.fund}` : '');
            const dateLine = g.date ? `\n${g.date}` : '';
            message = `:gift: New major gift:\n*${g.constituent_name}* gave *${formatMoney(Number(g.amount))}*${eventLine}${dateLine}`;
          } else {
            const lines = majorGifts.map(g => `• ${g.constituent_name} — ${formatMoney(Number(g.amount))}`).join('\n');
            message = `:gift: ${majorGifts.length} major gifts came in:\n${lines}`;
          }
          await sendSlackDM(SARA_SLACK_USER_ID, message, botToken);
        }
      }
    } catch (giftAlertErr) {
      console.warn('[SYNC GIFTS] Major-gift Slack alert threw:', giftAlertErr);
    }

    console.log('[SYNC GIFTS] Complete in', Date.now() - startMs, 'ms,', gifts.length, 'gifts');
    return { success: true, count: gifts.length };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[SYNC GIFTS] Failed in', Date.now() - startMs, 'ms:', errorMsg);

    // Record failure in sync meta
    try {
      await supabaseAdmin.from('gifts_sync_meta').upsert({
        workspace_id: workspaceId,
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_count: 0,
        last_sync_error: errorMsg,
      }, { onConflict: 'workspace_id' });
    } catch { /* ignore meta write failure */ }

    return { success: false, count: 0, error: errorMsg };
  }
}
