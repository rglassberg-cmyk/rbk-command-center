import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

const GIFT_TYPE_DONATION = 1;
const GIFT_TYPE_PLEDGE = 2;

const FY_GOAL = 6_200_000;
// Veracross "Active_Campaign" filter equivalent — matches query #62098. Gifts
// tagged to a prior or future fiscal year (e.g. pledge payments against an
// FY25 pledge made during FY26) should not roll into FY26 totals. This is the
// sole fiscal-year scoping rule; we intentionally do NOT also filter by gift
// date, because some legitimate Operating 2025-2026 gifts carry pre-7/1/2025
// dates (e.g. retro-tagged pledges) that Veracross still counts.
const FY_CAMPAIGN = 'Operating 2025-2026';

interface GiftRow {
  id: number;
  gift_type: number;
  constituent_id: number;
  constituent_name: string;
  date: string;
  amount: number;
  fund: string | null;
  apply_to_pledge: boolean | null;
  pledge_balance: number | null;
  thank_you_letter_date: string | null;
  payment_frequency: string | null;
  primary_development_role: string | null;
  anonymous: boolean | null;
}

export interface Constituent {
  donorId: string;
  donorName: string;
  totalPledge: number;
  paid: number;
  outstanding: number;
  giftType: 'donation' | 'pledge' | 'mixed';
  lastGiftDate: string;
  lastGiftAmount: number;
  thankYouLetterDate: string | null;
  paymentFrequency: string | null;
  primaryDevelopmentRole: string | null;
  // True when ANY of this donor's gifts in scope is flagged anonymous
  // in Veracross. Conservative — once a donor has asked to be anonymous
  // for any gift, surface the indicator so staff don't accidentally
  // publish the name without checking.
  anonymous: boolean;
  // Derived from `primaryDevelopmentRole`. Drives:
  //   1. The Veracross profile URL path (`development-constituent` vs
  //      `organization-constituent` — they have different detail
  //      endpoints in Axiom).
  //   2. The Guardian Circle donor-count filter, which excludes orgs
  //      so corporate/DAF rows don't inflate the headline count
  //      alongside the individual donor who gave through them.
  constituentType: 'person' | 'organization';
  // Big Bold Future capital-campaign total for this donor (cumulative
  // across all gifts where `fund = 'Capital Campaign'`). Populated by
  // guardian-circle/route.ts only; other callers leave it undefined.
  bbfTotal?: number;
  // Coarse role pill displayed in the Guardian Circle donor sidebar.
  // Derived from `primaryDevelopmentRole`. Until Veracross's
  // /v3/development/constituents endpoint is synced, the underlying
  // `primary_development_role` only ever carries 'Household' or
  // 'Organization' (via constituent_record_type in syncGifts.ts), so
  // this resolves to 'Other' for almost every row. Wiring is in place
  // for when the richer roles arrive.
  role?: 'Parent' | 'Grandparent' | 'Parents of Alumni' | 'Alumni' | 'Faculty' | 'Other';
  // Child grade levels at SAR (Veracross grade IDs). Empty array until
  // a household → student lookup is added — gifts_cache has no
  // student/grade info. When populated, drives the grade chips on the
  // donor row and the `agingOut` flag below.
  grades?: number[];
  // True when at least one child is in 8th grade (graduating this year).
  // Calculated as `grades.includes(8)`. Surfaces a red flag on the row
  // so staff can prioritize outreach before the family ages out of GC.
  agingOut?: boolean;
}

export interface FundSummary {
  fund: string;
  totalRaised: number;
  giftCount: number;
  constituents: Constituent[];
}

export interface FundraisingGoalsPayload {
  grandTotal: number;
  goal: number;
  asOf: string;
  funds: FundSummary[];
}

/**
 * Per-row contribution to a fund's totalRaised (matches Veracross's
 * "Donation & Pledge Balance" definition):
 *   - Donation row → amount (cash received)
 *   - Pledge row   → pledge_balance (outstanding only)
 * This avoids double-counting because a pledge's amount = balance + payments
 * received, and the payments are themselves Donation rows with
 * apply_to_pledge=true that already contribute their own amount.
 */
function contribution(g: GiftRow): number {
  if (g.gift_type === GIFT_TYPE_PLEDGE) return g.pledge_balance ?? 0;
  return g.amount;
}

export function buildFundsFromGifts(gifts: GiftRow[]): FundSummary[] {
  const byFund = new Map<string, GiftRow[]>();
  for (const g of gifts) {
    if (!g.fund || !g.fund.startsWith('OP:')) continue;
    if (g.gift_type !== GIFT_TYPE_DONATION && g.gift_type !== GIFT_TYPE_PLEDGE) continue;
    const arr = byFund.get(g.fund) || [];
    arr.push(g);
    byFund.set(g.fund, arr);
  }

  const funds: FundSummary[] = [];
  for (const [fund, rows] of byFund) {
    const byDonor = new Map<number, GiftRow[]>();
    for (const r of rows) {
      const arr = byDonor.get(r.constituent_id) || [];
      arr.push(r);
      byDonor.set(r.constituent_id, arr);
    }

    const constituents: Constituent[] = [];
    let totalRaised = 0;

    for (const [donorId, donorRows] of byDonor) {
      let totalPledge = 0;
      let paid = 0;
      let outstanding = 0;
      let hasDonation = false;
      let hasPledge = false;
      let lastGiftDate = '';
      let lastGiftAmount = 0;
      let donorName = '';
      let thankYouLetterDate: string | null = null;
      let paymentFrequency: string | null = null;
      let primaryDevelopmentRole: string | null = null;
      let isAnonymous = false;

      for (const r of donorRows) {
        if (r.date > lastGiftDate) {
          lastGiftDate = r.date;
          lastGiftAmount = r.amount;
        }
        if (r.constituent_name) donorName = r.constituent_name;
        // For status calculation we still need paid + outstanding per donor:
        //   paid       = sum of all donation amounts (incl. pledge payments)
        //   outstanding = sum of pledge_balance
        //   totalPledge = sum of pledge amount
        totalRaised += contribution(r);
        if (r.gift_type === GIFT_TYPE_PLEDGE) {
          hasPledge = true;
          totalPledge += r.amount;
          outstanding += r.pledge_balance ?? 0;
        } else {
          hasDonation = true;
          paid += r.amount;
        }
        if (!thankYouLetterDate && r.thank_you_letter_date) thankYouLetterDate = r.thank_you_letter_date;
        if (!paymentFrequency && r.payment_frequency) paymentFrequency = r.payment_frequency;
        if (!primaryDevelopmentRole && r.primary_development_role) primaryDevelopmentRole = r.primary_development_role;
        if (r.anonymous === true) isAnonymous = true;
      }

      const giftType: Constituent['giftType'] =
        hasDonation && hasPledge ? 'mixed' : hasPledge ? 'pledge' : 'donation';

      constituents.push({
        donorId: String(donorId),
        donorName: donorName || `Donor ${donorId}`,
        totalPledge,
        paid,
        outstanding,
        giftType,
        lastGiftDate,
        lastGiftAmount,
        thankYouLetterDate,
        paymentFrequency,
        primaryDevelopmentRole,
        anonymous: isAnonymous,
        constituentType: primaryDevelopmentRole === 'Organization' ? 'organization' : 'person',
      });
    }

    funds.push({
      fund,
      totalRaised,
      giftCount: constituents.length,
      constituents,
    });
  }

  funds.sort((a, b) => b.totalRaised - a.totalRaised);
  return funds;
}

async function getEffectiveWorkspaceOrThrow(): Promise<{ wsId: string } | { error: NextResponse }> {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled' }, { status: 403 }) };
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 }) };
    }
  } catch { /* fail open if workspace lookup fails */ }

  return { wsId };
}

export async function GET(_request: NextRequest) {
  const result = await getEffectiveWorkspaceOrThrow();
  if ('error' in result) return result.error;
  const { wsId } = result;

  const collected: GiftRow[] = [];
  let from = 0;
  const pageSize = 1000;
  try {
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('id, gift_type, constituent_id, constituent_name, date, amount, fund, apply_to_pledge, pledge_balance, thank_you_letter_date, payment_frequency, primary_development_role, anonymous')
        .eq('workspace_id', wsId)
        .like('fund', 'OP:%')
        .in('gift_type', [GIFT_TYPE_DONATION, GIFT_TYPE_PLEDGE])
        .eq('fundraising_activity', FY_CAMPAIGN)
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[FUNDRAISING GOALS] Query failed:', error);
        return NextResponse.json({ error: 'Failed to load gifts' }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      collected.push(...(data as GiftRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch (err) {
    console.error('[FUNDRAISING GOALS] Exception:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const funds = buildFundsFromGifts(collected);
  const grandTotal = funds.reduce((sum, f) => sum + f.totalRaised, 0);

  let asOf = new Date().toISOString();
  try {
    const { data: meta } = await supabaseAdmin
      .from('gifts_sync_meta')
      .select('last_sync_at')
      .eq('workspace_id', wsId)
      .single();
    if (meta?.last_sync_at) asOf = meta.last_sync_at;
  } catch { /* non-fatal */ }

  const payload: FundraisingGoalsPayload = {
    grandTotal,
    goal: FY_GOAL,
    asOf,
    funds,
  };
  return NextResponse.json(payload);
}
