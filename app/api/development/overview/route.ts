import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// Development Overview — 2026-06-09 rewrite per RBK + dev team spec,
// rolled forward to FY27 on 2026-09-02 (the fiscal year turned over on
// September 1st).
//
// Scope (all metrics):
//   - Operating campaigns only, matched on the EXACT campaign string
//     (never a `LIKE 'Operating %'` prefix), so Israel Fund, Cooper,
//     Capital and External Funds never leak in and a future
//     `Operating 2027-2028` pledge booked early can't inflate FY27.
//   - Headline / campaign / lapsed / new metrics use `gift_type IN
//     (1, 2)` — explicitly excluding soft credits (3 + 5), which were
//     the main source of donor-count inflation.
//   - The gifts read also pulls `gift_type = 3` rows so they can feed
//     the per-SEGMENT cards (a trustee/parent who gave via DAF or
//     foundation has a type-3 Donation Soft Credit (soft_credit_type = 1)
//     and that money belongs in their segment). Soft credits affect ONLY
//     the segment cards — NOT the headline Total Raised, the per-fund
//     campaign table, or the donor counts.
//   - 2026-06-25 twin-matching gap-fill (UNCHANGED by the FY27 roll, and
//     now applied to FY27 exactly as it was to FY26): a soft credit is a
//     Veracross auto-generated TWIN of a direct gift iff its
//     `hard_credit_gift_id` equals the `id` of one of THIS constituent's
//     own type-1 gifts — in that case it's excluded (already counted via
//     the type-1 row). A soft credit whose `hard_credit_gift_id` is NOT
//     one of their own type-1 ids came from a different source (their
//     family foundation / DAF gave directly and they received a soft
//     credit) — it's a genuinely separate gift and IS counted. So segment
//     `received` = SUM(type-1 amount) + SUM(non-twin soft-credit amount).
//     NOTE: type-1 rows carry `hard_credit_gift_id = NULL`; the twin's id
//     points to the type-1 gift's own record `id`, so type1GiftIds is
//     collected from `id`, not `hard_credit_gift_id`. Soft credits stay
//     scoped to gift_type=3 (soft_credit_type 1/2) — type-5
//     pledge-soft-credits are a separate representation of the same
//     pledge and would double-count.
//   - FY bucket = the exact campaign string (`Operating 2026-2027` vs
//     `Operating 2025-2026` vs `Operating 2024-2025`), NOT the gift date.
//     Pledge-payment gifts retroactively tagged to a prior campaign stay
//     in that campaign's bucket even when the cash arrives in the current
//     FY.
//
// Total Raised formula (Veracross "Donation & Pledge Balance"):
//   SUM(amount         WHERE gift_type = 1)
// + SUM(pledge_balance WHERE gift_type = 2)
// Type 1 (cash donation) contributes its amount. Type 2 (pledge)
// contributes only the *outstanding* portion — payments against the
// pledge come back through as their own type-1 rows.
//
// Total Donors = COUNT DISTINCT constituent_id WHERE gift_type = 1
// (hard credits only). Pledge-only donors (no payment yet) aren't
// counted as donors until they pay.
//
// Lapsed / New / Retained use "gave" = a constituent gave in a campaign if
// they have ANY of:
//   - gift_type = 1 (direct gift), OR
//   - gift_type = 2 (pledge — the donor committed), OR
//   - gift_type = 3 with soft_credit_type IN (1, 2) (gap-fill — the SAME
//     rule the segment cards use). This catches soft-credit-only
//     constituents: a DAF/foundation or household member who gave through
//     an org. Without it, soft-credit-only donors are wrongly flagged
//     lapsed or missing from the lapsed list entirely.
// A pledge (type-2) or qualifying soft credit therefore keeps a constituent
// OUT of lapsed and IN retained.
//   Lapsed   = gave FY26 (Operating 2025-2026) AND NOT gave FY27.
//   New      = gave FY27 (Operating 2026-2027) AND NOT gave FY26.
//   Retained = gave both years.
// (Headline Total Donors stays type-1-only and is unaffected.)
//
// FY27 rollover (2026-09-02) — what changed:
//   - Current campaign is now `Operating 2026-2027`; FY26 is the prior
//     year and FY25 is two years ago (both derived, never hardcoded).
//   - Segment cards report FY27 giving and carry a `priorYearTotal`
//     (the same donor→segment math run over FY26) for reference.
//   - Campaign Giving by Fund returns three years (FY27 / FY26 / FY25)
//     plus the FY27-vs-FY26 change.
//   - The lapsed/new prior-year baseline is FY26.
//
// Verified at SAR on 2026-09-02: FY27 type-1/2 raised = $191,397.70 across
// 62 gifts, 63 distinct type-1/2/3 donors (43 retained, 20 new). The huge
// lapsed count early in a fiscal year is expected — almost nobody has
// given yet — and drains toward 0 as the year fills in.

const FY27_CAMPAIGN = 'Operating 2026-2027';
// Prior-year campaigns are DERIVED from the current one (minus 1 each
// step) — never hardcode them, so next September's roll only needs
// FY27_CAMPAIGN bumped. "Operating 2026-2027" -> "Operating 2025-2026"
// -> "Operating 2024-2025".
function priorCampaign(current: string): string {
  const m = current.match(/^(.*?)(\d{4})-(\d{4})$/);
  if (!m) return current;
  const [, prefix, y1, y2] = m;
  return `${prefix}${Number(y1) - 1}-${Number(y2) - 1}`;
}
const FY26_CAMPAIGN = priorCampaign(FY27_CAMPAIGN);
const FY25_CAMPAIGN = priorCampaign(FY26_CAMPAIGN);

const GIFT_TYPE_DONATION = 1;
const GIFT_TYPE_PLEDGE = 2;
// Veracross soft credits: gift_type = 3. soft_credit_type 1 = Donation Soft
// Credit (DAF/org gave on the constituent's behalf), 2 = household soft
// credit (spouse/household attribution). Counted toward SEGMENT cards only.
// Veracross writes a soft-credit twin for every direct gift, so a soft
// credit is only counted when it is NOT a twin of one of the donor's own
// type-1 gifts (twin = its hard_credit_gift_id matches a type-1 gift's id);
// see the twin-matching gap-fill rule in the scope note above.
const GIFT_TYPE_SOFT_CREDIT = 3;
const SOFT_CREDIT_TYPE_DONATION = 1;
const SOFT_CREDIT_TYPE_HOUSEHOLD = 2;

// Eight donor segments, in priority order — each constituent lands in
// exactly ONE bucket (first match wins). Classification reads the raw
// Veracross role string (`roles_raw`, a comma-joined list like
// "Parent, Grndprnt") with the normalized `role` field as a fallback.
// The UI renders every segment even when total = 0 so the layout stays
// stable. Order here = render order. Board Members (trustees) sit at the
// top so a trustee who is also a parent classifies as a board member.
const ALL_SEGMENTS = [
  'Board Members',
  'Parent',
  'Grandparent',
  'Parents of Alumni',
  'Program & Future Families',
  'Alumni',
  'Faculty',
  'Other',
] as const;

// Shared segment classifier — MUST stay byte-for-byte in sync with the
// drill-down route (app/api/development/overview/segment-donors).
// Mirrors the SQL: Board Members match `roles_raw ILIKE '%Trustee%'`
// while excluding `%Trustee - Former%` and `%DECEASED%`; Parent uses a
// word-boundary match on roles_raw so "Parents of Alumni"/"Prnt of ..."
// don't false-match; the rest are case-insensitive substring (ILIKE)
// checks with a `role` fallback. Board Members is first — a trustee who
// is also a parent classifies as a board member.
export function classifySegment(rolesRaw: string | null, role: string | null): string {
  const rr = rolesRaw ?? '';
  const r = role ?? '';
  if (/Trustee/i.test(rr) && !/Trustee - Former/i.test(rr) && !/DECEASED/i.test(rr)) return 'Board Members';
  if (/(^|, )Parent(,|$)/.test(rr)) return 'Parent';
  if (/Grndprnt/i.test(rr) || /Grandparent/i.test(rr)) return 'Grandparent';
  if (/Prnt of Alum/i.test(rr) || r === 'Parents of Alumni') return 'Parents of Alumni';
  if (/Prnt of Prg Stud/i.test(rr) || /Prnt of Fut Stud/i.test(rr)) return 'Program & Future Families';
  if (/Frmr Student/i.test(rr) || r === 'Alumni') return 'Alumni';
  if (r === 'Faculty') return 'Faculty';
  return 'Other';
}

interface GiftRow {
  id: number;
  constituent_id: number | null;
  constituent_name: string | null;
  amount: number | null;
  pledge_balance: number | null;
  gift_type: number;
  soft_credit_type: number | null;
  hard_credit_gift_id: number | null;
  fund: string | null;
  fundraising_activity: string | null;
  date: string;
}

// Per-donor, per-campaign accumulator for the segment math. Pools are
// kept separate so the twin-matching gap-fill rule can be applied AFTER
// the single pass (a soft credit's twin status depends on the donor's
// full set of type-1 gift ids):
//   `type1`        = SUM(amount) on type-1 gifts.
//   `type1GiftIds` = the SET of record `id`s of those type-1 gifts. A
//                    soft credit is a Veracross-generated TWIN iff its
//                    `hard_credit_gift_id` is in this set (type-1 rows
//                    themselves carry hard_credit_gift_id = NULL, so we
//                    collect their own `id`).
//   `softByKey`    = qualifying type-3 soft credits (soft_credit_type
//                    1/2), deduped by hard_credit_gift_id. Each value
//                    keeps {hcid, amount} so the twin test runs after the
//                    loop. Dedup is by hard_credit_gift_id (the sc_type
//                    1 + 2 rows for one gift share an id; falls back to
//                    `amt_<n>` when the id is null), so 11 monthly $540
//                    soft credits sum to $5,940 — they are NOT collapsed
//                    by amount.
//   `pledged`      = SUM(pledge_balance) on type-2 gifts.
// Final segment `received` = type1 + SUM(amount of soft credits whose
// hcid is NOT one of this donor's own type-1 ids). Segment total =
// received + pledged.
interface DonorAgg {
  type1: number;
  type1GiftIds: Set<number>;
  softByKey: Map<string, { hcid: number | null; amount: number }>;
  pledged: number;
  hasType1: boolean;
  hasType2: boolean;
}
const emptyDonorAgg = (): DonorAgg => ({
  type1: 0,
  type1GiftIds: new Set<number>(),
  softByKey: new Map<string, { hcid: number | null; amount: number }>(),
  pledged: 0,
  hasType1: false,
  hasType2: false,
});

interface OverviewResponse {
  headline: {
    raisedFY27: number;
    donorsFY27: number;
    raisedFY26: number;
    donorsFY26: number;
  };
  // Per-segment FY27 giving. `donationsReceived` per constituent =
  // SUM(amount) on type-1 gifts when they gave directly, otherwise
  // SUM(amount) on their qualifying type-3 soft credits (gap-fill — see
  // scope note); `outstandingPledges` = SUM(pledge_balance) on type-2
  // gifts; `total` = the two combined. `donors` = DISTINCT constituents
  // with any type-1, type-2, OR (absent a type-1) qualifying type-3
  // soft-credit Operating gift in FY27 (so pledge-only and soft-credit-
  // only donors still count once toward their segment). YoY segment
  // comparison is intentionally dropped — roles shift annually in
  // Veracross.
  segments: Array<{
    segment: string;
    donors: number;
    donationsReceived: number;
    outstandingPledges: number;
    total: number;
    // FY26 total for the SAME segment, computed with the identical
    // donor→segment math (type-1 + non-twin soft credits + outstanding
    // pledges, "Other" org-dedup applied). Prior-year reference line on
    // each card — it is NOT part of the FY27 total.
    priorYearTotal: number;
  }>;
  // Campaign Giving by Fund — three years. FY27 + FY26 come from
  // gifts_cache (type-1 amount + type-2 pledge_balance, so they reconcile
  // with the headline); FY25 comes from giving_history_cache (complete
  // history) with a gifts_cache fallback.
  campaigns: Array<{
    fund: string;
    raisedFY27: number;
    raisedFY26: number;
    raisedFY25: number;
    changeFY27vFY26: number;
    changePctFY27vFY26: number | null;
  }>;
  lapsed: {
    count: number;
    totalLastYearDonors: number;
    donors: Array<{
      constituent_id: number;
      name: string;
      role: string;
      lastAmount: number;
      lastDate: string;
    }>;
  };
  newDonorsFY27: number;
  newDonors: {
    count: number;
    donors: Array<{
      constituent_id: number;
      name: string;
      role: string;
      lastAmount: number;
      lastDate: string;
    }>;
  };
}

export async function GET() {
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

  // Single paginated read of the FY27 + FY26 + FY25 Operating gifts (type
  // 1 + 2 for the headline/campaign/lapsed math, plus type 3 for the
  // segment cards). Scoped with an explicit
  // `.in([FY25_CAMPAIGN, FY26_CAMPAIGN, FY27_CAMPAIGN])` rather than a
  // `LIKE 'Operating %'` prefix so a future Operating campaign (e.g. an
  // 'Operating 2027-2028' pledge booked early) can NEVER leak into FY27
  // totals — the loop below ALSO exact-matches each campaign string, so
  // this is defense-in-depth. FY25 is pulled ONLY as the fallback source
  // for the Campaign-Giving-by-Fund FY25 column (giving_history_cache is
  // preferred); it feeds no donor set, headline, or segment total. At SAR
  // this is ~10k rows; we scan it in memory and aggregate client-side (no
  // RPCs / materialized views).
  const gifts: GiftRow[] = [];
  try {
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('id, constituent_id, constituent_name, amount, pledge_balance, gift_type, soft_credit_type, hard_credit_gift_id, fund, fundraising_activity, date')
        .eq('workspace_id', wsId)
        .in('gift_type', [GIFT_TYPE_DONATION, GIFT_TYPE_PLEDGE, GIFT_TYPE_SOFT_CREDIT])
        .in('fundraising_activity', [FY25_CAMPAIGN, FY26_CAMPAIGN, FY27_CAMPAIGN])
        .range(from, from + pageSize - 1);
      if (error) {
        console.error('[OVERVIEW] gifts query failed:', error);
        return NextResponse.json({ error: 'Failed to load gifts' }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      gifts.push(...(data as GiftRow[]));
      if (data.length < pageSize) break;
      from += pageSize;
    }
  } catch (err) {
    console.error('[OVERVIEW] Exception fetching gifts:', err);
    return NextResponse.json({ error: 'Failed to load gifts' }, { status: 500 });
  }

  // Bucket gifts into FY27 / FY26 / FY25. The FY assignment is the
  // exact campaign string, NOT the gift date.
  let raisedFY27 = 0;
  let raisedFY26 = 0;
  // type-1 donor sets per FY (used for headline donor counts +
  // segment math + lapsed/new logic).
  const fy27Type1Donors = new Set<number>();
  const fy26Type1Donors = new Set<number>();
  // "Gave" sets for lapsed/new/retained: any type-1, type-2, OR qualifying
  // type-3 soft credit (soft_credit_type 1/2) in that campaign. Pledge-only
  // (type-2) and soft-credit-only donors both count as having given. The
  // gap-fill caveat ("only when no type-1 row") is moot for set membership —
  // a type-1 donor is already in the set — so soft credits are added
  // unconditionally here without changing the result.
  const fy27GaveDonors = new Set<number>();
  const fy26GaveDonors = new Set<number>();
  // Per-fund + per-FY raised. fund=null/empty bucketed as '(No fund)'.
  const fundFY27 = new Map<string, number>();
  const fundFY26 = new Map<string, number>();
  // FY25 per-fund from gifts_cache — fallback only for the third campaign
  // column when giving_history_cache has no FY25 rows.
  const fundFY25 = new Map<string, number>();
  // Per-donor FY27 giving for segment aggregation — see the DonorAgg
  // interface above for what each pool holds and why they're kept
  // separate until after the pass. `fy27SegmentDonors` (built after the
  // loop) is every constituent who gave directly (type-1), pledged
  // (type-2), or has any qualifying soft credit.
  const fy27ByDonor = new Map<number, DonorAgg>();
  // Same accumulator over FY26 — powers the prior-year reference line on
  // each segment card. Built with identical rules so the two numbers are
  // apples-to-apples.
  const fy26ByDonor = new Map<number, DonorAgg>();
  let fy27SegmentDonors = new Set<number>();
  // Last type-1/type-2 gift per donor per FY — feeds the lapsed (FY26)
  // and new (FY27) donor lists' "last gift" amount + date.
  const lastFy26GiftByDonor = new Map<number, { amount: number; date: string }>();
  const lastFy27GiftByDonor = new Map<number, { amount: number; date: string }>();
  // Last qualifying soft credit per donor per FY — gap-fill source for the
  // lapsed/new drilldown "last gift" amount + date when a constituent has NO
  // direct (type-1/type-2) gift in that FY (soft-credit-only donors). Direct
  // gifts always win via `direct ?? soft` at list-build time.
  const lastFy26SoftByDonor = new Map<number, { amount: number; date: string }>();
  const lastFy27SoftByDonor = new Map<number, { amount: number; date: string }>();
  const recordLast = (map: Map<number, { amount: number; date: string }>, cid: number, amount: number, date: string) => {
    const prior = map.get(cid);
    if (!prior || date > prior.date) map.set(cid, { amount, date });
  };
  const nameByDonor = new Map<number, string>();
  // FY27 type-1/type-2 gift record id → the constituent who made it. Used
  // after the loop to find family foundations / DAFs whose own gift was
  // soft-credited to a DIFFERENT constituent (a named-segment individual) —
  // those orgs are already represented via that person's segment and must be
  // excluded from "Other" so they don't double-count. See softCreditedOrgs.
  const type1GiftToConstituentFY27 = new Map<number, number>();
  // Same map for FY26, so the "Other" org-dedup can be applied to the
  // prior-year segment totals too.
  const type1GiftToConstituentFY26 = new Map<number, number>();

  for (const g of gifts) {
    if (g.constituent_id == null) continue;
    const cid = g.constituent_id;
    const activity = g.fundraising_activity ?? '';
    const isType1 = g.gift_type === GIFT_TYPE_DONATION;
    const isType2 = g.gift_type === GIFT_TYPE_PLEDGE;
    // Qualifying soft credit (gift_type 3 AND soft_credit_type 1 or 2) —
    // other type-3 variants (e.g. pledge soft credits) are ignored. These
    // only fill the gap for constituents with no direct gift (decided
    // after the loop).
    const isSoftCredit = g.gift_type === GIFT_TYPE_SOFT_CREDIT &&
      (g.soft_credit_type === SOFT_CREDIT_TYPE_DONATION || g.soft_credit_type === SOFT_CREDIT_TYPE_HOUSEHOLD);
    const amt = Number(g.amount || 0);
    const pledgeBal = Number(g.pledge_balance || 0);
    const fund = (g.fund && g.fund.trim()) || '(No fund)';

    if (g.constituent_name && !nameByDonor.has(cid)) {
      nameByDonor.set(cid, g.constituent_name);
    }

    if (activity === FY27_CAMPAIGN) {
      const seg = fy27ByDonor.get(cid) ?? emptyDonorAgg();
      if (isType1) {
        raisedFY27 += amt;
        fy27Type1Donors.add(cid);
        fy27GaveDonors.add(cid);
        recordLast(lastFy27GiftByDonor, cid, amt, g.date);
        fundFY27.set(fund, (fundFY27.get(fund) || 0) + amt);
        seg.type1 += amt;
        seg.type1GiftIds.add(g.id);
        seg.hasType1 = true;
        type1GiftToConstituentFY27.set(g.id, cid);
        fy27ByDonor.set(cid, seg);
      } else if (isType2) {
        raisedFY27 += pledgeBal;
        fy27GaveDonors.add(cid);
        recordLast(lastFy27GiftByDonor, cid, amt, g.date);
        fundFY27.set(fund, (fundFY27.get(fund) || 0) + pledgeBal);
        seg.pledged += pledgeBal;
        seg.hasType2 = true;
        type1GiftToConstituentFY27.set(g.id, cid);
        fy27ByDonor.set(cid, seg);
      } else if (isSoftCredit) {
        // Soft credits feed segment math AND the lapsed/new/retained "gave"
        // set (gap-fill: a soft-credit-only constituent counts as having
        // given). They do NOT touch raisedFY27, the per-fund campaign table,
        // or the type-1 headline donor count. Stored by hard_credit_gift_id
        // (sc_type 1 + 2 share an id → deduped to one underlying gift;
        // falls back to `amt_<n>` when null) with {hcid, amount} so the
        // after-loop twin test can drop only the soft credits whose hcid is
        // one of THIS donor's own type-1 gift ids. `lastFy27SoftByDonor` is
        // the gap-fill last-gift source for the new-donor drilldown (used
        // only when the donor has no direct gift).
        const softKey = g.hard_credit_gift_id != null ? String(g.hard_credit_gift_id) : `amt_${amt}`;
        if (!seg.softByKey.has(softKey)) {
          seg.softByKey.set(softKey, { hcid: g.hard_credit_gift_id, amount: amt });
        }
        fy27ByDonor.set(cid, seg);
        fy27GaveDonors.add(cid);
        recordLast(lastFy27SoftByDonor, cid, amt, g.date);
      }
    } else if (activity === FY26_CAMPAIGN) {
      // FY26 is now the PRIOR year: it feeds the headline comparison, the
      // lapsed/new baseline, the middle Campaign-Giving column, and the
      // per-segment `priorYearTotal`. It runs the same accumulator as FY27
      // so the two segment numbers are computed identically.
      const seg = fy26ByDonor.get(cid) ?? emptyDonorAgg();
      if (isType1) {
        raisedFY26 += amt;
        fy26Type1Donors.add(cid);
        fy26GaveDonors.add(cid);
        recordLast(lastFy26GiftByDonor, cid, amt, g.date);
        fundFY26.set(fund, (fundFY26.get(fund) || 0) + amt);
        seg.type1 += amt;
        seg.type1GiftIds.add(g.id);
        seg.hasType1 = true;
        type1GiftToConstituentFY26.set(g.id, cid);
        fy26ByDonor.set(cid, seg);
      } else if (isType2) {
        raisedFY26 += pledgeBal;
        fy26GaveDonors.add(cid);
        recordLast(lastFy26GiftByDonor, cid, amt, g.date);
        fundFY26.set(fund, (fundFY26.get(fund) || 0) + pledgeBal);
        seg.pledged += pledgeBal;
        seg.hasType2 = true;
        type1GiftToConstituentFY26.set(g.id, cid);
        fy26ByDonor.set(cid, seg);
      } else if (isSoftCredit) {
        // FY26 gap-fill: a soft-credit-only constituent counts as having
        // given last year, so they correctly enter the lapsed set when they
        // have no FY27 gift (the classic shape is a donor whose family fund
        // made the direct gift and who carries only the soft credit).
        // Soft credits do
        // NOT touch raisedFY26, the FY26 headline donor count, or the
        // per-fund FY26 column — only the segment prior-year total and the
        // "gave" set. `lastFy26SoftByDonor` is the gap-fill last-gift
        // source for the lapsed drilldown.
        const softKey = g.hard_credit_gift_id != null ? String(g.hard_credit_gift_id) : `amt_${amt}`;
        if (!seg.softByKey.has(softKey)) {
          seg.softByKey.set(softKey, { hcid: g.hard_credit_gift_id, amount: amt });
        }
        fy26ByDonor.set(cid, seg);
        fy26GaveDonors.add(cid);
        recordLast(lastFy26SoftByDonor, cid, amt, g.date);
      }
    } else if (activity === FY25_CAMPAIGN) {
      // FY25 contributes ONLY the per-fund fallback column. No donor sets,
      // no headline, no segments — two years back is context, not a
      // comparison the rest of the page reasons about.
      if (isType1) fundFY25.set(fund, (fundFY25.get(fund) || 0) + amt);
      else if (isType2) fundFY25.set(fund, (fundFY25.get(fund) || 0) + pledgeBal);
    }
  }

  // Family foundations / DAFs to exclude from "Other": any constituent whose
  // own FY27 gift was soft-credited to a DIFFERENT constituent. That recipient
  // (a named-segment individual — Parent, Grandparent, Board Member, …) already
  // carries the money in their segment, so leaving the org in Other would
  // double-count it. Second pass over the raw gifts: for every FY27 type-3
  // soft credit pointing at a known type-1/type-2 gift, if the recipient isn't
  // the gift's owner, the owner (the org) is "already represented". Orgs that
  // give only to OP: Grants with NO soft credit to a household (e.g.
  // UJA-Federation) never appear here and correctly stay in Other.
  const buildSoftCreditedOrgs = (campaign: string, giftOwners: Map<number, number>) => {
    const orgs = new Set<number>();
    for (const g of gifts) {
      if (g.constituent_id == null) continue;
      if ((g.fundraising_activity ?? '') !== campaign) continue;
      if (g.gift_type !== GIFT_TYPE_SOFT_CREDIT || g.hard_credit_gift_id == null) continue;
      const owner = giftOwners.get(g.hard_credit_gift_id);
      if (owner != null && owner !== g.constituent_id) orgs.add(owner);
    }
    return orgs;
  };
  const softCreditedOrgs = buildSoftCreditedOrgs(FY27_CAMPAIGN, type1GiftToConstituentFY27);
  const softCreditedOrgsFY26 = buildSoftCreditedOrgs(FY26_CAMPAIGN, type1GiftToConstituentFY26);

  // A constituent counts toward a segment if they gave directly (type-1),
  // pledged (type-2), or — only when they have NO direct gift — carry a
  // qualifying soft credit. This excludes constituents whose sole FY27
  // attribution was a non-qualifying type-3 row (e.g. a pledge soft
  // credit), which would otherwise be a $0 donor.
  fy27SegmentDonors = new Set<number>();
  for (const [cid, v] of fy27ByDonor) {
    if (v.hasType1 || v.hasType2 || v.softByKey.size > 0) fy27SegmentDonors.add(cid);
  }

  // Prior-year "gave" baseline for lapsed/new/retained — now FY26
  // (Operating 2025-2026).
  //
  // Sources are UNIONED rather than one preferred over the other, because
  // for FY26 each is incomplete in a different direction:
  //   - `giving_history_cache` is the nightly Veracross "Operating Gift
  //     History Export". It is complete for closed years but its FY26 slice
  //     only reflects the LAST CSV drop, so it lags live giving.
  //   - `gifts_cache` covers FY26 fully (the campaign opened well inside
  //     the Veracross /v3/development/gifts API window) and is refreshed by
  //     the gifts sync, but it has no deep history.
  // Preferring history alone would shrink the baseline and wrongly promote
  // FY26 donors missing from the last export into "New Donors". A union can
  // only ever grow the baseline, so it is strictly the safer set. When the
  // history table has no FY26 rows the union degrades to exactly the
  // gifts_cache set (the spec's stated fallback).
  //
  // The match is on `fundraising_activity`, NOT `fiscal_year`: Veracross
  // stamps fiscal_year from the GIFT DATE, not the campaign, so
  // shoulder-dated gifts land in a neighbouring FY and get missed (the
  // 2026-06-18 false-"New" bug). Gift types 1-5 so pledge installments (4)
  // and pledge soft-credits (5) also count as having given.
  const fy26Baseline = new Set<number>(fy26GaveDonors);
  const giftsCacheBaselineSize = fy26Baseline.size;
  let historyBaselineSize = 0;
  try {
    let hfrom = 0;
    const hpage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('giving_history_cache')
        .select('constituent_id')
        .eq('workspace_id', wsId)
        .eq('fundraising_activity', FY26_CAMPAIGN)
        .in('gift_type', [1, 2, 3, 4, 5])
        .range(hfrom, hfrom + hpage - 1);
      if (error) { console.error('[OVERVIEW] giving_history prior-year query failed:', error); break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        if (r.constituent_id != null) { historyBaselineSize += fy26Baseline.has(r.constituent_id) ? 0 : 1; fy26Baseline.add(r.constituent_id); }
      }
      if (data.length < hpage) break;
      hfrom += hpage;
    }
  } catch (err) {
    console.error('[OVERVIEW] giving_history prior-year lookup failed (non-fatal):', err);
  }
  console.log(`[OVERVIEW] prior-year baseline campaign=${FY26_CAMPAIGN} gifts_cache=${giftsCacheBaselineSize} +history_only=${historyBaselineSize} union=${fy26Baseline.size}`);

  // FY25 per-fund totals (the third, context-only campaign column) — prefer
  // giving_history_cache, which holds the complete FY25 history. gifts_cache
  // is missing pre-April-2025 gifts, so its `fundFY25` (built in the main
  // loop above) understates FY25 and is only the fallback. Same rule as the
  // gifts_cache path: type-1 + type-2 only, soft credits excluded (the `.in`
  // filter selects only 1 and 2). Paginated — the FY25 type-1/2 slice is
  // ~3.2k rows, well over Supabase's 1000-row default cap.
  //
  // NOTE: giving_history_cache has no `pledge_balance` column (the Veracross
  // export carries only `amount`), so type-2 here contributes its face-value
  // `amount` rather than the outstanding `pledge_balance` the gifts_cache path
  // uses. Acceptable tradeoff: FY25 is a historical reference column and
  // completeness matters more than the pledge-balance nuance; the FY27 and
  // FY26 columns (which reconcile with the headline) are gifts_cache and
  // untouched.
  const fundFY25History = new Map<string, number>();
  try {
    let ffrom = 0;
    const fpage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('giving_history_cache')
        .select('fund, gift_type, amount')
        .eq('workspace_id', wsId)
        .eq('fundraising_activity', FY25_CAMPAIGN)
        .in('gift_type', [1, 2])
        .range(ffrom, ffrom + fpage - 1);
      if (error) { console.error('[OVERVIEW] giving_history FY25 fund query failed:', error); break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const f = (typeof r.fund === 'string' && r.fund.trim()) ? r.fund.trim() : '(No fund)';
        fundFY25History.set(f, (fundFY25History.get(f) || 0) + Number(r.amount || 0));
      }
      if (data.length < fpage) break;
      ffrom += fpage;
    }
  } catch (err) {
    console.error('[OVERVIEW] giving_history FY25 fund lookup failed (non-fatal):', err);
  }
  const fundFY25Final = fundFY25History.size > 0 ? fundFY25History : fundFY25;
  console.log(`[OVERVIEW] FY25 per-fund source=${fundFY25History.size > 0 ? 'giving_history_cache' : 'gifts_cache'} funds=${fundFY25Final.size}`);

  // Pull role + roles_raw from constituents_cache for every donor we
  // saw (FY27 segment donors + FY26 baseline donors for lapsed pills).
  // Chunked IN(...) to keep individual queries small.
  const allDonorIds = Array.from(new Set<number>([...fy26Baseline, ...fy27SegmentDonors, ...fy27GaveDonors]));
  const roleByDonor = new Map<number, string>();
  const rolesRawByDonor = new Map<number, string>();
  try {
    const chunkSize = 500;
    for (let i = 0; i < allDonorIds.length; i += chunkSize) {
      const chunk = allDonorIds.slice(i, i + chunkSize);
      const { data, error } = await supabaseAdmin
        .from('constituents_cache')
        .select('constituent_id, role, roles_raw')
        .eq('workspace_id', wsId)
        .in('constituent_id', chunk);
      if (error) {
        console.error('[OVERVIEW] constituents_cache chunk failed:', error);
        continue;
      }
      for (const r of (data || [])) {
        roleByDonor.set(r.constituent_id, r.role || 'Other');
        if (r.roles_raw) rolesRawByDonor.set(r.constituent_id, r.roles_raw);
      }
    }
  } catch (err) {
    console.error('[OVERVIEW] constituents_cache lookup failed (non-fatal):', err);
  }

  // Board Member overrides — spouse-record trustees whose gifts sit on a
  // joint household record that has no "Trustee" in its own roles_raw, so
  // classifySegment can't catch them. These constituent_ids are forced to
  // the Board Members segment.
  const boardOverrideIds = new Set<number>();
  try {
    const { data: overrideRows, error } = await supabaseAdmin
      .from('board_member_overrides')
      .select('constituent_id')
      .eq('workspace_id', wsId);
    if (error) console.error('[OVERVIEW] board_member_overrides query failed:', error);
    for (const r of (overrideRows || [])) if (r.constituent_id != null) boardOverrideIds.add(r.constituent_id);
  } catch (err) {
    console.error('[OVERVIEW] board_member_overrides lookup failed (non-fatal):', err);
  }

  // Segment a donor by their cached roles. Single source of truth used
  // for both the segment cards and the lapsed-donor role pills. Board
  // Member overrides win first (joint-record trustees).
  const segmentOf = (cid: number) =>
    boardOverrideIds.has(cid)
      ? 'Board Members'
      : classifySegment(rolesRawByDonor.get(cid) ?? null, roleByDonor.get(cid) ?? null);

  // Build per-segment aggregates: received (type-1 + non-twin soft credits)
  // + pledged (type-2) + total, and a distinct-donor set per segment.
  // Extracted into a helper so FY27 (the cards) and FY26 (the prior-year
  // reference line) are computed by IDENTICAL rules — a difference in the
  // two numbers is then a real year-over-year difference, not a methodology
  // artifact.
  const buildSegmentTotals = (
    byDonor: Map<number, DonorAgg>,
    excludedOtherOrgs: Set<number>,
  ) => {
    const map = new Map<string, { donationsReceived: number; outstandingPledges: number; donors: Set<number> }>();
    for (const seg of ALL_SEGMENTS) {
      map.set(seg, { donationsReceived: 0, outstandingPledges: 0, donors: new Set() });
    }
    for (const [cid, v] of byDonor) {
      // Drop non-qualifying $0 donors (sole attribution was a non-qualifying
      // type-3 row, e.g. a pledge soft credit).
      if (!(v.hasType1 || v.hasType2 || v.softByKey.size > 0)) continue;
      const segName = segmentOf(cid);
      // "Other" double-count filter: exclude a foundation/DAF whose own gift
      // that year was soft-credited to a named-segment individual (that
      // person's segment already counts the money). Named segments are
      // unaffected. UJA-style orgs that give only to OP: Grants with no
      // household soft credit are NOT in the set and stay in Other.
      if (segName === 'Other' && excludedOtherOrgs.has(cid)) continue;
      // Twin-matching gap-fill: count every direct (type-1) gift, PLUS every
      // soft credit that is NOT a Veracross twin of one of this donor's own
      // type-1 gifts (i.e. hcid not in type1GiftIds — it came from a DAF /
      // foundation that gave directly). Twins are skipped (already counted via
      // their type-1 row). softByKey is already deduped by hard_credit_gift_id.
      let softFromOther = 0;
      for (const { hcid, amount } of v.softByKey.values()) {
        if (hcid == null || !v.type1GiftIds.has(hcid)) softFromOther += amount;
      }
      const received = v.type1 + softFromOther;
      const s = map.get(segName)!;
      s.donationsReceived += received;
      s.outstandingPledges += v.pledged;
      s.donors.add(cid);
    }
    return map;
  };
  const segmentMap = buildSegmentTotals(fy27ByDonor, softCreditedOrgs);
  const segmentMapFY26 = buildSegmentTotals(fy26ByDonor, softCreditedOrgsFY26);
  const segments = ALL_SEGMENTS.map(seg => {
    const s = segmentMap.get(seg)!;
    const prior = segmentMapFY26.get(seg)!;
    return {
      segment: seg,
      donors: s.donors.size,
      donationsReceived: s.donationsReceived,
      outstandingPledges: s.outstandingPledges,
      total: s.donationsReceived + s.outstandingPledges,
      priorYearTotal: prior.donationsReceived + prior.outstandingPledges,
    };
  });

  // Campaigns by fund within Operating — union of the FY27 + FY26 + FY25
  // fund buckets, sorted by FY27 desc. FY27 and FY26 use the Total Raised
  // formula (type-1 amount + type-2 pledge_balance) so those columns
  // reconcile with the headline; FY25 is the giving_history_cache
  // face-value column (see the note above) and is context only. The
  // change columns compare FY27 against FY26 — the like-for-like pair.
  // `changePctFY27vFY26` is null when FY26 is 0 (no meaningful percentage
  // against a zero base); the UI renders a dash.
  const allFunds = new Set<string>([...fundFY27.keys(), ...fundFY26.keys(), ...fundFY25Final.keys()]);
  const campaigns = Array.from(allFunds)
    .map(fund => {
      const raisedFY27 = fundFY27.get(fund) || 0;
      const raisedFY26 = fundFY26.get(fund) || 0;
      const raisedFY25 = fundFY25Final.get(fund) || 0;
      return {
        fund,
        raisedFY27,
        raisedFY26,
        raisedFY25,
        changeFY27vFY26: raisedFY27 - raisedFY26,
        changePctFY27vFY26: raisedFY26 === 0 ? null : ((raisedFY27 - raisedFY26) / raisedFY26) * 100,
      };
    })
    .filter(c => c.raisedFY27 > 0 || c.raisedFY26 > 0 || c.raisedFY25 > 0)
    .sort((a, b) => b.raisedFY27 - a.raisedFY27);

  // Lapsed = gave FY26 and NOT gave FY27. New = gave FY27 and NOT gave FY26.
  // Retained (computed in the UI from the counts) = both. The "gave" sets
  // now include type-1, type-2, AND qualifying soft credits (gap-fill), so a
  // FY27 pledge OR soft credit keeps a constituent out of lapsed, and a
  // FY26-soft-credit-only constituent correctly enters lapsed.
  // FY26 baseline = the UNION of the gifts_cache FY26 "gave" set and the
  // giving_history_cache FY26 donors (see the baseline block above — each
  // source is incomplete in a different direction). FY27 "gave" is
  // gifts_cache only, which is the live current-year source.
  const lapsedIds = Array.from(fy26Baseline).filter(cid => !fy27GaveDonors.has(cid));
  const newIds = Array.from(fy27GaveDonors).filter(cid => !fy26Baseline.has(cid));

  // Exclude organizations (DAFs, foundations, charitable funds) from the
  // lapsed + new *lists* — only individual persons should appear there.
  // In gifts_cache the Veracross record type lives in
  // raw_data->>'constituent_record_type' ('2' = person, '3' = org). A
  // constituent is treated as an org if ANY of their gift rows carries
  // record type '3' (a lapsed org may have no current-year row). Unknown/
  // missing record types are kept. As of 2026-06-16 the COUNT pills ALSO
  // exclude orgs so the pill number matches the (person-only) drilldown
  // list exactly.
  const orgIds = new Set<number>();
  const orgCandidateIds = Array.from(new Set<number>([...lapsedIds, ...newIds]));
  try {
    const chunkSize = 500;
    for (let i = 0; i < orgCandidateIds.length; i += chunkSize) {
      const chunk = orgCandidateIds.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      const { data, error } = await supabaseAdmin
        .from('gifts_cache')
        .select('constituent_id')
        .eq('workspace_id', wsId)
        .in('constituent_id', chunk)
        .eq('raw_data->>constituent_record_type', '3');
      if (error) {
        console.error('[OVERVIEW] org-filter query failed:', error);
        continue;
      }
      for (const r of (data || [])) {
        if (r.constituent_id != null) orgIds.add(r.constituent_id);
      }
    }
  } catch (err) {
    console.error('[OVERVIEW] org-filter failed (non-fatal):', err);
  }

  // `directMap` holds the latest type-1/type-2 gift; `softMap` holds the
  // latest qualifying soft credit. Gap-fill: a direct gift always wins
  // (`direct ?? soft`), so soft credits only surface the "last gift" for
  // soft-credit-only donors.
  const buildDonorList = (
    ids: number[],
    directMap: Map<number, { amount: number; date: string }>,
    softMap: Map<number, { amount: number; date: string }>,
  ) =>
    ids
      .filter(cid => !orgIds.has(cid))
      .map(cid => {
        const last = directMap.get(cid) ?? softMap.get(cid);
        return {
          constituent_id: cid,
          name: nameByDonor.get(cid) || `Donor ${cid}`,
          role: segmentOf(cid),
          lastAmount: last?.amount ?? 0,
          lastDate: last?.date ?? '',
        };
      })
      .sort((a, b) => b.lastAmount - a.lastAmount)
      .slice(0, 100);

  const lapsedDonors = buildDonorList(lapsedIds, lastFy26GiftByDonor, lastFy26SoftByDonor);
  const newDonorsList = buildDonorList(newIds, lastFy27GiftByDonor, lastFy27SoftByDonor);
  // Person-only counts (orgs excluded) so the pills match the drilldown lists.
  const lapsedCount = lapsedIds.filter(cid => !orgIds.has(cid)).length;
  const newCount = newIds.filter(cid => !orgIds.has(cid)).length;
  const newDonorsFY27 = newCount;

  const payload: OverviewResponse = {
    headline: {
      raisedFY27,
      donorsFY27: fy27Type1Donors.size,
      raisedFY26,
      donorsFY26: fy26Type1Donors.size,
    },
    segments,
    campaigns,
    lapsed: {
      count: lapsedCount,
      totalLastYearDonors: fy26Baseline.size,
      donors: lapsedDonors,
    },
    newDonorsFY27,
    newDonors: {
      count: newCount,
      donors: newDonorsList,
    },
  };
  return NextResponse.json(payload);
}
