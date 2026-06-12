/**
 * One-time data fix — reset the inflated `raised` column in
 * `israel_fund_raised_cache`.
 *
 * BACKGROUND
 * ----------
 * Veracross writes two rows per gift into `gifts_cache`: a hard credit
 * (gift_type=1) and a soft credit (gift_type=3). `syncIsraelFundRaised.ts`
 * previously summed ALL gift_types when computing the incremental raised
 * total for non-seeded Israel Fund events, so those rows were inflated
 * (roughly double, plus any pledges). The code has now been fixed to
 * filter `gift_type = 1` only. Because the live sync only ratchets `raised`
 * UP (never down), it cannot by itself un-inflate the already-stored
 * values — hence this one-time recompute, which is allowed to LOWER them.
 *
 * WHAT IT TOUCHES
 * ---------------
 * Only the `raised` (and `gift_count` / `last_updated`) of NON-SEEDED rows
 * (seed_raised = 0). For each, `raised` is set to the sum of gift_type=1
 * amounts from `gifts_cache` whose normalized event name matches — exactly
 * what the corrected sync would compute, using the SAME query + the SAME
 * `normalizeIsraelFundEvent` function.
 *
 * NEVER touched: seed_raised, manual_raised, is_excluded, and the `raised`
 * of seeded rows (seed_raised > 0). Seeded rows were frozen from the
 * Veracross CSV seed and were never affected by the bug (the sync skips
 * them), so recomputing them from gifts would be wrong (double-count vs
 * the seed). `manual_raised` is added separately at display time by the
 * route (effective = raised + manual_raised), so it is deliberately NOT
 * folded into `raised` here — doing so would double-count it.
 *
 * Usage:
 *   npx tsx scripts/recompute-israel-fund-raised.ts
 *
 * Safe to re-run — idempotent (recomputes from source each time).
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeIsraelFundEvent } from '../lib/israelFundNormalization';

const TARGET_LOW = 1_880_000;
const TARGET_HIGH = 1_950_000;

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      let val = trimmed.slice(eqIdx + 1);
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Discover the workspace(s) that have Israel Fund rows. Recompute each.
  const { data: wsRows, error: wsErr } = await supabase
    .from('israel_fund_raised_cache')
    .select('workspace_id');
  if (wsErr) { console.error('Failed to read workspaces:', wsErr.message); process.exit(1); }
  const workspaceIds = Array.from(new Set((wsRows ?? []).map((r: { workspace_id: string }) => r.workspace_id)));
  console.log('Workspaces with Israel Fund rows:', workspaceIds);

  for (const workspaceId of workspaceIds) {
    await recomputeWorkspace(supabase, workspaceId);
  }
}

async function recomputeWorkspace(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  workspaceId: string,
) {
  console.log(`\n=== Workspace ${workspaceId} ===`);

  // 1. Pull gift_type=1 ("hard credit") Israel Fund gifts, paginated —
  //    identical query to the corrected syncIsraelFundRaisedCache.
  const collected: Array<{ event: string | null; amount: number | null }> = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('gifts_cache')
      .select('event, amount')
      .eq('workspace_id', workspaceId)
      .eq('gift_type', 1)
      .ilike('fundraising_activity', '%External Funds%')
      .not('event', 'is', null)
      .or('event.ilike.APL: %,event.ilike.DEV: %')
      .range(from, from + pageSize - 1);
    if (error) { console.error('  gifts_cache query failed:', error.message); return; }
    if (!data || data.length === 0) break;
    collected.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // 2. Aggregate by normalized event name (same normalization as sync).
  const byNormalized = new Map<string, { total: number; count: number }>();
  for (const r of collected) {
    if (!r.event) continue;
    const normalized = normalizeIsraelFundEvent(r.event);
    if (!normalized) continue;
    const entry = byNormalized.get(normalized) || { total: 0, count: 0 };
    entry.total += Number(r.amount || 0);
    entry.count += 1;
    byNormalized.set(normalized, entry);
  }

  // 3. Load existing rows.
  const { data: existing, error: exErr } = await supabase
    .from('israel_fund_raised_cache')
    .select('event_name, seed_raised, raised, manual_raised, is_excluded')
    .eq('workspace_id', workspaceId);
  if (exErr) { console.error('  cache read failed:', exErr.message); return; }

  const now = new Date().toISOString();
  let updated = 0;
  const changes: Array<{ name: string; old: number; neu: number }> = [];

  for (const row of (existing ?? []) as Array<{
    event_name: string; seed_raised: number | null; raised: number | null;
    manual_raised: number | null; is_excluded: boolean | null;
  }>) {
    const seed = Number(row.seed_raised ?? 0);
    if (seed !== 0) continue; // seeded rows: never touched.

    const agg = byNormalized.get(row.event_name);
    const newRaised = agg ? agg.total : 0;
    const newCount = agg ? agg.count : 0;
    const oldRaised = Number(row.raised ?? 0);

    if (Math.abs(newRaised - oldRaised) < 0.005) continue; // no change.

    const { error: upErr } = await supabase
      .from('israel_fund_raised_cache')
      .update({ raised: newRaised, gift_count: newCount, last_updated: now })
      .eq('workspace_id', workspaceId)
      .eq('event_name', row.event_name);
    if (upErr) { console.warn('  update failed for', row.event_name, upErr.message); continue; }
    updated += 1;
    changes.push({ name: row.event_name, old: oldRaised, neu: newRaised });
  }

  for (const c of changes.sort((a, b) => (b.old - b.neu) - (a.old - a.neu))) {
    console.log(`  ${c.name}: ${c.old.toFixed(2)} -> ${c.neu.toFixed(2)}  (Δ ${(c.neu - c.old).toFixed(2)})`);
  }
  console.log(`  Non-seeded rows updated: ${updated}`);

  // 4. Verify the resulting displayed total (is_excluded = false).
  const { data: after, error: afErr } = await supabase
    .from('israel_fund_raised_cache')
    .select('raised, manual_raised')
    .eq('workspace_id', workspaceId)
    .eq('is_excluded', false);
  if (afErr) { console.warn('  post-check read failed:', afErr.message); return; }
  const displayed = (after ?? []).reduce(
    (s: number, r: { raised: number | null; manual_raised: number | null }) =>
      s + Number(r.raised ?? 0) + Number(r.manual_raised ?? 0), 0);
  console.log(`  New displayed Total Raised: $${displayed.toFixed(2)}`);
  if (displayed < TARGET_LOW || displayed > TARGET_HIGH) {
    console.warn(`  WARNING: displayed total $${displayed.toFixed(2)} is OUTSIDE expected range ` +
      `$${TARGET_LOW.toLocaleString()}-$${TARGET_HIGH.toLocaleString()}. Review, but proceeding.`);
  } else {
    console.log('  OK: within expected $1.88M-$1.95M range.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
