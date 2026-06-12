import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// Israel Fund route — 2026-06-08 rewrite.
//
// Money In is no longer a live ILIKE over gifts_cache. It now reads
// from `israel_fund_raised_cache`, which is seeded with the historical
// totals from Veracross query 1077990 (June 8 2026 export) and kept
// current by `syncIsraelFundRaisedCache` (hooked into the regular
// gifts sync). That table is the authoritative source — it survives
// Veracross's narrow `/v3/development/gifts` window, and new events
// flow in automatically without code changes.
//
// Money Out is unchanged: paginated `israel_fund_grants` Supabase read
// with in-route aggregation (`SUM(funding_amount) WHERE is_visible AND
// wire_was_sent AND NOT grant_not_given GROUP BY initiative`).
//
// Whitelist logic removed: raised_cache is already curated (the
// `normalizeIsraelFundEvent` rules drop Columbus Baseball Tournament
// and similar unrelated buckets at sync time), so every cache row is
// shown. Grants-only initiatives (disbursed > 0, no cache row) still
// surface with raised = 0.

interface RaisedRow {
  event_name: string;
  // `raised` is the Veracross-sourced figure. `manualRaised` is the
  // editor-entered top-up for money that never flows through Veracross
  // (e.g. a Venmo fundraiser). The page shows the sum of the two as the
  // effective raised; see `effectiveRaised` below.
  raised: number;
  manualRaised: number;
  manualRaisedNote: string | null;
  gift_count: number;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const effectiveWsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gating
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', effectiveWsId)
      .single();
    if (ws?.modules?.development === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch { /* fail open */ }

  // 1. Money In from israel_fund_raised_cache. Cache is small (few
  //    dozen rows) so no pagination needed; ORDER BY raised DESC.
  const raisedRows: RaisedRow[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('israel_fund_raised_cache')
      .select('event_name, raised, manual_raised, manual_raised_note, gift_count')
      .eq('workspace_id', effectiveWsId)
      .eq('is_excluded', false)
      .order('raised', { ascending: false });
    if (error) {
      console.error('[ISRAEL RAISED] query failed:', error);
    } else if (data) {
      for (const r of data as Array<{ event_name: string; raised: number | null; manual_raised: number | null; manual_raised_note: string | null; gift_count: number | null }>) {
        raisedRows.push({
          event_name: r.event_name,
          raised: Number(r.raised ?? 0),
          manualRaised: Number(r.manual_raised ?? 0),
          manualRaisedNote: r.manual_raised_note ?? null,
          gift_count: Number(r.gift_count ?? 0),
        });
      }
    }
  } catch (err) {
    console.error('[ISRAEL RAISED] exception:', err);
  }

  // 2. Disbursements + full grant rows from `israel_fund_grants`.
  //    One paginated SELECT for the full grants list — the page needs
  //    the rows for the per-initiative detail UI, and the per-
  //    initiative disbursed total is aggregated client-side from the
  //    same dataset so we don't double-fetch.
  type GrantRow = {
    id: string;
    workspace_id: string;
    grant_number: string | null;
    confirmed_payment: string | null;
    date_received: string | null;
    initiative: string | null;
    category: string | null;
    organization_person: string | null;
    link: string | null;
    what_funding: string | null;
    wire_status: string | null;
    submitted_by: string | null;
    contact_info: string | null;
    funding_amount: number;
    grant_not_given: boolean;
    notes: string | null;
    submitted_to_procurify: string | null;
    date_wire_sent: string | null;
    wire_was_sent: boolean;
    is_visible: boolean;
    created_at: string;
    updated_at: string;
  };

  const grants: GrantRow[] = [];
  try {
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('israel_fund_grants')
        .select('*')
        .eq('workspace_id', effectiveWsId)
        .order('date_received', { ascending: false, nullsFirst: false })
        .order('grant_number', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[ISRAEL GRANTS] query failed:', error);
        break;
      }
      if (!data || data.length === 0) break;
      grants.push(...(data as GrantRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch (err) {
    console.error('[ISRAEL GRANTS] Exception:', err);
  }

  // Aggregate disbursed totals per initiative — same rule as before:
  //   WHERE is_visible AND wire_was_sent AND NOT grant_not_given
  //   GROUP BY initiative
  const disbursedByInitiative = new Map<string, number>();
  for (const r of grants) {
    if (!r.is_visible) continue;
    if (!r.wire_was_sent) continue;
    if (r.grant_not_given === true) continue;
    const key = (r.initiative ?? '').trim();
    if (!key) continue;
    disbursedByInitiative.set(key, (disbursedByInitiative.get(key) || 0) + Number(r.funding_amount || 0));
  }
  const grantsByInitiative = Array.from(disbursedByInitiative.entries())
    .map(([initiative, disbursed]) => ({ initiative, disbursed }))
    .sort((a, b) => b.disbursed - a.disbursed);

  // 3. Join raised + disbursed by case-insensitive trimmed name. Every
  //    raised_cache row appears regardless of grants — no whitelist.
  //    Grants-only initiatives (no matching cache row) still surface
  //    with raised = 0.
  type InitiativeRowOut = {
    name: string;
    // `raised` is the EFFECTIVE raised = Veracross raised + manual_raised.
    // The summary cards, balance, and chart all key off this so the
    // manual top-up flows through everywhere. `manualRaised` +
    // `manualRaisedNote` are surfaced separately so the UI can show the
    // info icon/tooltip and prefill the inline editor.
    raised: number;
    manualRaised: number;
    manualRaisedNote: string | null;
    // `disbursed` is the canonical key; `paidOut` mirrors it for the
    // current IsraelFundTab.tsx UI back-compat.
    disbursed: number;
    paidOut: number;
    balance: number;
  };
  const rowsByKey = new Map<string, InitiativeRowOut>();
  for (const r of raisedRows) {
    const key = r.event_name.toLowerCase().trim();
    const effectiveRaised = r.raised + r.manualRaised;
    rowsByKey.set(key, {
      name: r.event_name,
      raised: effectiveRaised,
      manualRaised: r.manualRaised,
      manualRaisedNote: r.manualRaisedNote,
      disbursed: 0,
      paidOut: 0,
      balance: effectiveRaised,
    });
  }
  for (const g of grantsByInitiative) {
    const key = g.initiative.toLowerCase().trim();
    const existing = rowsByKey.get(key);
    if (existing) {
      existing.disbursed = g.disbursed;
      existing.paidOut = g.disbursed;
      existing.balance = existing.raised - g.disbursed;
    } else {
      rowsByKey.set(key, {
        name: g.initiative,
        raised: 0,
        manualRaised: 0,
        manualRaisedNote: null,
        disbursed: g.disbursed,
        paidOut: g.disbursed,
        balance: -g.disbursed,
      });
    }
  }
  const initiatives = Array.from(rowsByKey.values()).sort((a, b) => b.raised - a.raised);

  const total_raised = initiatives.reduce((s, r) => s + r.raised, 0);
  const total_disbursed = initiatives.reduce((s, r) => s + r.disbursed, 0);
  const total_balance = total_raised - total_disbursed;

  // veracrossEvents — preserved for the UI's initiative-picker
  // dropdown. Now sourced from raised_cache event_names so the picker
  // shows the canonical normalized set.
  const veracrossEvents = raisedRows
    .map(r => r.event_name)
    .filter((e, i, arr) => arr.indexOf(e) === i)
    .sort((a, b) => a.localeCompare(b));

  // moneyIn — accordion payload. Shape preserved (event, total,
  // pledgeBalance, giftCount) so IsraelFundTab.tsx keeps rendering.
  // pledgeBalance is 0 — the cache rolls up cash-received totals;
  // outstanding-pledge tracking is not part of this pipeline.
  const moneyIn = raisedRows.map(r => ({
    event: r.event_name,
    total: r.raised,
    pledgeBalance: 0,
    giftCount: r.gift_count,
  }));

  return NextResponse.json({
    total_raised,
    // `total_paid_out` kept alongside `total_disbursed` so the existing
    // IsraelFundTab.tsx keeps rendering — UI rename is a follow-up.
    total_paid_out: total_disbursed,
    total_disbursed,
    total_balance,
    initiatives,
    grants,
    veracrossEvents,
    moneyIn,
    as_of: new Date().toISOString(),
  });
}
