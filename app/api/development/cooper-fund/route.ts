import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { getGoogleAccessToken } from '@/lib/googleToken';

interface MoneyInEvent {
  event: string;
  total: number;
  giftCount: number;
}

function stripPrefix(name: string | null | undefined): string {
  if (!name) return 'General / Undesignated';
  if (name === 'None') return 'General / Undesignated';
  return name.replace(/^APL:\s*/i, '').trim() || 'General / Undesignated';
}

// SAR's fiscal year runs Sep 1 – Aug 31. FY26 = 2025-09-01 → 2026-08-31.
// The label is keyed off the end-year so Sep 2025 onwards reads "FY26",
// matching how the disbursement snapshot (cooper_fund_categories.fiscal_year)
// is labelled. Note: this is DISTINCT from the school year used in
// app/api/absences/route.ts which ends Jun 30 (when students leave) —
// both happen to start Sep 1 but end on different months.
function getFiscalYear(today: Date): { fyStart: string; fyEnd: string; fyLabel: string } {
  const month = today.getMonth() + 1; // 1-12
  const year = today.getFullYear();
  const fyStartYear = month >= 9 ? year : year - 1;
  const fyEndYear = fyStartYear + 1;
  return {
    fyStart: `${fyStartYear}-09-01`,
    fyEnd: `${fyEndYear}-08-31`,
    fyLabel: `FY${String(fyEndYear).slice(2)}`,
  };
}

// Hardcoded FY26 window for the Cooper Reconciliation sheet read. The
// fiscal-year window in the rest of this route is derived from the
// current date, but the sheet has its own pace and the disbursement
// view is FY26-locked until further notice. When FY27 starts, bump
// both ends here.
const COOPER_SHEET_FY_START = new Date(2025, 8, 1);  // 2025-09-01
const COOPER_SHEET_FY_END = new Date(2026, 7, 31);   // 2026-08-31

function parseSheetDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const match = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function parseSheetAmount(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  // Strip $, commas, whitespace, parentheses. Treat (xxx) as negative
  // per accounting convention — though for our credit column we filter
  // to > 0 anyway.
  let s = v.trim();
  const negative = /^\(.+\)$/.test(s);
  s = s.replace(/[(),\s$]/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  return negative ? -n : n;
}

/**
 * Reads Column G (Veracross event) disbursement totals from the Cooper
 * Reconciliation Google Sheet for the FY26 window. Returns an array of
 * { name, amount } sorted by amount descending.
 *
 * Sheet layout (Master Sheet!A:H, 0-indexed):
 *   0 Date (M/D/YYYY)
 *   1 Check #
 *   2 Payee
 *   3 Debit (money in — ignored)
 *   4 Credit (money out — what we sum)
 *   5 Balance
 *   6 Category Veracross (any non-empty value — the Veracross event
 *     tag. Most rows start with 'APL:' but some carry other prefixes
 *     like 'DEV: ' or 'M Schreck …' that need to match the Raised
 *     side verbatim, so we no longer require 'APL:'.)
 *   7 Category for reporting
 *
 * Filters out: void rows, transfer/wire rows, rows outside FY26,
 * rows with empty or zero credit, rows where Column G is blank.
 * On the kept rows, only the 'APL: ' prefix is stripped from the
 * event name — other prefixes (DEV:, M Schreck …) are preserved so
 * they match the Veracross Raised side exactly.
 *
 * Returns [] on any failure — the rest of the route still works.
 */
async function fetchCooperDisbursementsByEvent(
  accessToken: string,
): Promise<{ name: string; amount: number }[]> {
  const sheetId = process.env.COOPER_RECONCILIATION_SHEET_ID;
  if (!sheetId) {
    console.warn('[COOPER SHEETS] COOPER_RECONCILIATION_SHEET_ID not set — skipping');
    return [];
  }

  try {
    const range = encodeURIComponent("'Master Sheet'!A:H");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[COOPER SHEETS] Sheets API non-ok:', res.status, body.slice(0, 500));
      return [];
    }
    const json = (await res.json()) as { values?: unknown[][] };
    const rows = json.values || [];
    if (rows.length === 0) return [];

    const totals = new Map<string, number>();
    // Skip header row (index 0).
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const dateRaw = row[0];
      const checkRaw = row[1];
      const payeeRaw = row[2];
      const creditRaw = row[4];
      const gRaw = row[6];

      const g = typeof gRaw === 'string' ? gRaw.trim() : '';
      if (g === '') continue;

      const credit = parseSheetAmount(creditRaw);
      if (!(credit > 0)) continue;

      const date = parseSheetDate(dateRaw);
      if (!date) continue;
      if (date < COOPER_SHEET_FY_START || date > COOPER_SHEET_FY_END) continue;

      const payee = typeof payeeRaw === 'string' ? payeeRaw : '';
      const check = typeof checkRaw === 'string' ? checkRaw : String(checkRaw ?? '');
      if (/void/i.test(payee)) continue;
      if (/void/i.test(check)) continue;
      // Bank-internal lines that aren't real disbursements
      if (/^\s*(transfer|wire|transfer to operating|void checks?)\b/i.test(payee)) continue;

      const eventName = g.replace(/^APL:\s*/i, '').trim();
      if (!eventName) continue;
      totals.set(eventName, (totals.get(eventName) || 0) + credit);
    }

    return Array.from(totals.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  } catch (err) {
    console.error('[COOPER SHEETS] Disbursements fetch failed:', err);
    return [];
  }
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

  // 1. Categories / disbursements (existing)
  let categoriesData: {
    categories: unknown;
    donated_ytd: number;
    current_balance: number;
    as_of_date: string;
    fiscal_year: string;
    updated_by: string | null;
  } | null = null;
  try {
    const { data, error } = await supabaseAdmin
      .from('cooper_fund_categories')
      .select('*')
      .eq('workspace_id', effectiveWsId)
      .order('as_of_date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'No Cooper Fund data found' }, { status: 404 });
    }
    categoriesData = data;
  } catch (err) {
    console.error('Cooper Fund GET error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // 2. Money In — grouped by event from gifts_cache, paginated.
  // Scoped to the current fiscal year so the chart aligns with the
  // disbursement snapshot (which is already FY-tagged in
  // cooper_fund_categories). Without this filter the query was summing
  // every Cooper gift ever recorded (~$1.39M lifetime as of 2026-05),
  // not the in-year ~$447K.
  const { fyStart, fyEnd, fyLabel } = getFiscalYear(new Date());
  const moneyInRows: { event: string | null; amount: number }[] = [];
  try {
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('event, amount')
        .eq('workspace_id', effectiveWsId)
        .eq('fund', 'Cooper')
        .eq('fundraising_activity', 'Cooper')
        // Hard-credit gift types only — 1=Donation, 2=Pledge. Excludes
        // 3=Donation Soft-Credit and 5=Pledge Soft-Credit, which carry
        // the same amount as their associated hard credit and would
        // double the chart total (verified against the Rosen Israel Gap
        // Year pledge: a single $15K pledge appeared as $30K because the
        // hard credit + spouse soft credit were both summed).
        .in('gift_type', [1, 2])
        .gte('date', fyStart)
        .lte('date', fyEnd)
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[COOPER MONEY IN] Query failed:', error);
        break;
      }
      if (!data || data.length === 0) break;
      moneyInRows.push(...(data as { event: string | null; amount: number }[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch (err) {
    console.error('[COOPER MONEY IN] Exception:', err);
  }

  const moneyInMap = new Map<string, { total: number; giftCount: number }>();
  for (const r of moneyInRows) {
    const key = stripPrefix(r.event);
    const entry = moneyInMap.get(key) || { total: 0, giftCount: 0 };
    entry.total += Number(r.amount || 0);
    entry.giftCount += 1;
    moneyInMap.set(key, entry);
  }
  const moneyIn: MoneyInEvent[] = Array.from(moneyInMap.entries())
    .map(([event, v]) => ({ event, total: v.total, giftCount: v.giftCount }))
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total);

  // 3. Live Column G disbursement totals from the Cooper Reconciliation
  // Google Sheet. Workspace-level token is used so the same sheet read
  // works for any user with module access (the sheet is shared with the
  // workspace owner's account, not individual staffers). Degrades
  // silently to [] on any failure so the rest of the page still renders.
  let disbursementsByEvent: { name: string; amount: number }[] = [];
  try {
    const accessToken = await getGoogleAccessToken(effectiveWsId);
    if (accessToken) {
      disbursementsByEvent = await fetchCooperDisbursementsByEvent(accessToken);
    } else {
      console.warn('[COOPER SHEETS] No workspace Google token available — skipping');
    }
  } catch (err) {
    console.error('[COOPER SHEETS] Token/fetch wrapper failed:', err);
  }

  return NextResponse.json({
    categories: categoriesData!.categories,
    donated_ytd: categoriesData!.donated_ytd,
    current_balance: categoriesData!.current_balance,
    as_of_date: categoriesData!.as_of_date,
    fiscal_year: categoriesData!.fiscal_year,
    updated_by: categoriesData!.updated_by,
    moneyIn,
    // Computed FY label for the Money In date range so the client can
    // show "Money In · FY26" alongside the chart. Distinct from
    // `fiscal_year` above, which is the snapshot's manually-set label.
    moneyInFyLabel: fyLabel,
    // Live Column G (Veracross event) disbursement totals from the
    // Cooper Reconciliation sheet. Empty array if the Sheets API call
    // failed (revoked token, missing env var, sheet permission revoked,
    // etc.); the frontend treats [] as "no disbursement data" rather
    // than 500-ing.
    disbursementsByEvent,
  });
}
