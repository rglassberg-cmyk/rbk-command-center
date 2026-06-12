// Israel Fund raised_cache incremental sync.
//
// `israel_fund_raised_cache` is the authoritative money-in source for
// the Israel Fund page. It's seeded from Veracross query 1077990
// (June 8 2026 export) so historical totals survive even though
// `/v3/development/gifts` only returns the past ~year of data.
//
// `seed_raised` is the frozen baseline from that CSV import. Seeded
// events (seed_raised > 0) are NEVER touched by this sync — their
// `raised` value is controlled solely by re-running the CSV seed.
// When Becca re-exports query 1077990, she re-runs the seed and the
// new totals land.
//
// For non-seeded events (seed_raised = 0):
//   - If the event already has a row, `raised` ratchets up only when
//     the live total exceeds the current `raised`. This prevents a
//     Veracross-window rollover (older gifts dropping off the API)
//     from shrinking what we've already recorded.
//   - If the event has no row yet, this sync INSERTS it with
//     seed_raised = 0. New Israel Fund initiatives appear on the page
//     automatically as soon as Veracross reports their first gift.
//
// Source-of-truth filter: only `gifts_cache` rows whose `event` starts
// with `APL: ` or `DEV: ` are considered. That prefix is Veracross's
// identifier for Israel Fund events; unrelated External Funds buckets
// (Purim fundraisers, KCI, tour events, etc.) lack the prefix and are
// excluded at the query level.
//
// Hooked into `syncGiftsForWorkspace` so it fires after every gifts
// sync (manual + hourly weekdays + daily weekends via the Cloud
// Functions in functions/src/index.ts).

import { supabaseAdmin } from '@/lib/supabase';
import { normalizeIsraelFundEvent } from '@/lib/israelFundNormalization';

interface GiftRow {
  event: string | null;
  amount: number | null;
}

interface AggregatedEvent {
  total: number;
  count: number;
}

interface ExistingRow {
  event_name: string;
  seed_raised: number;
  raised: number;
}

export async function syncIsraelFundRaisedCache(
  workspaceId: string,
): Promise<{ success: boolean; updated: number; inserted: number; error?: string }> {
  const startMs = Date.now();
  try {
    // 1. Pull all Israel Fund-prefixed External Funds gifts, paginated.
    //    The `event ILIKE 'APL: %' OR 'DEV: %'` clause is the canonical
    //    Israel Fund identifier on the Veracross side.
    const collected: GiftRow[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('event, amount')
        .eq('workspace_id', workspaceId)
        // gift_type = 1 ONLY (hard credit / outright donation = real money
        // received). Veracross writes two rows per gift — hard credit
        // (gift_type=1) and soft credit (gift_type=3) — so summing all
        // types double-counts. Pledges (gift_type=2) and soft-credit
        // pledges (gift_type=5) are also excluded: we only want cash in.
        // This filter MUST run before the amounts are summed.
        .eq('gift_type', 1)
        .ilike('fundraising_activity', '%External Funds%')
        .not('event', 'is', null)
        .or('event.ilike.APL: %,event.ilike.DEV: %')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      collected.push(...(data as GiftRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // 2. Aggregate by normalized event name. Multiple raw events can
    //    map to the same normalized name (e.g. all Kfar Aza variants).
    const byNormalized = new Map<string, AggregatedEvent>();
    for (const r of collected) {
      if (!r.event) continue;
      const normalized = normalizeIsraelFundEvent(r.event);
      if (!normalized) continue;
      const entry = byNormalized.get(normalized) || { total: 0, count: 0 };
      entry.total += Number(r.amount || 0);
      entry.count += 1;
      byNormalized.set(normalized, entry);
    }

    // 3. Load existing rows. Need both seed_raised (to filter seeded
    //    vs non-seeded events) and current raised (so we only write
    //    when the live total exceeds it).
    const { data: existingRowsRaw, error: existingError } = await supabaseAdmin
      .from('israel_fund_raised_cache')
      .select('event_name, seed_raised, raised')
      .eq('workspace_id', workspaceId);
    if (existingError) throw existingError;
    const existingByName = new Map<string, ExistingRow>();
    for (const row of (existingRowsRaw ?? []) as { event_name: string; seed_raised: number | null; raised: number | null }[]) {
      existingByName.set(row.event_name, {
        event_name: row.event_name,
        seed_raised: Number(row.seed_raised ?? 0),
        raised: Number(row.raised ?? 0),
      });
    }

    // 4. For each live event:
    //    - No existing row → INSERT with seed_raised = 0.
    //    - Existing row, seed_raised = 0, live > current raised →
    //      UPDATE raised / gift_count / last_updated (seed_raised
    //      stays untouched).
    //    - Existing row, seed_raised > 0 → never touched (seeded
    //      events are controlled by the CSV re-seed only).
    //    - Else → no-op.
    const now = new Date().toISOString();
    const inserts: Array<{
      workspace_id: string;
      event_name: string;
      raised: number;
      seed_raised: number;
      gift_count: number;
      last_updated: string;
      is_excluded: boolean;
    }> = [];
    let updated = 0;
    for (const [event_name, agg] of byNormalized.entries()) {
      const existing = existingByName.get(event_name);
      if (!existing) {
        // New events always start visible. Hiding is an Emily-driven
        // action via the per-row UI toggle — the sync never touches
        // `is_excluded` on existing rows, so a pre-excluded row keeps
        // its `is_excluded = true` across syncs.
        inserts.push({
          workspace_id: workspaceId,
          event_name,
          raised: agg.total,
          seed_raised: 0,
          gift_count: agg.count,
          last_updated: now,
          is_excluded: false,
        });
        continue;
      }
      if (existing.seed_raised !== 0) continue;
      if (agg.total <= existing.raised) continue;

      const { error: updateError } = await supabaseAdmin
        .from('israel_fund_raised_cache')
        .update({
          raised: agg.total,
          gift_count: agg.count,
          last_updated: now,
        })
        .eq('workspace_id', workspaceId)
        .eq('event_name', event_name);
      if (updateError) {
        console.warn('[ISRAEL RAISED SYNC] update failed for', event_name, updateError);
        continue;
      }
      updated += 1;
    }

    let inserted = 0;
    if (inserts.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('israel_fund_raised_cache')
        .insert(inserts);
      if (insertError) {
        console.warn('[ISRAEL RAISED SYNC] insert failed:', insertError);
      } else {
        inserted = inserts.length;
      }
    }

    console.log(
      '[ISRAEL RAISED SYNC] Complete in', Date.now() - startMs, 'ms — workspace',
      workspaceId, 'inserted=', inserted, 'updated=', updated,
    );
    return { success: true, updated, inserted };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ISRAEL RAISED SYNC] Failed:', errorMsg);
    return { success: false, inserted: 0, updated: 0, error: errorMsg };
  }
}
