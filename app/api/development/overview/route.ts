import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// Development Overview — 2026-06-09 rewrite per RBK + dev team spec.
//
// Prior implementation pulled every gift in the FY25/FY26 *date window*
// and summed `amount` regardless of gift_type, which mixed in non-
// Operating campaigns (Israel Fund, Cooper, Capital, etc.) and
// double-counted soft credits. That produced the inflated $17.8M
// number Becca flagged.
//
// New scope (all metrics):
//   - `fundraising_activity LIKE 'Operating %'` (matches the
//     Operating yyyy-yyyy campaigns; ignores Israel Fund, Cooper,
//     Capital, External Funds, etc.).
//   - Headline / campaign / lapsed / new metrics use `gift_type IN
//     (1, 2)` — explicitly excluding soft credits (3 + 5), which were
//     the main source of donor-count inflation.
//   - 2026-06-11: the gifts read also pulls `gift_type = 3` rows so
//     they can feed the per-SEGMENT cards (a trustee/parent who gave
//     via DAF or foundation has a type-3 Donation Soft Credit
//     (soft_credit_type = 1) and that money belongs in their segment).
//     Soft credits affect ONLY the segment cards — NOT the headline
//     Total Raised, the per-fund campaign table, or the donor/
//     lapsed/new counts.
//   - 2026-06-14: soft credits GAP-FILL only — but the original rule
//     ("count soft credits ONLY when the donor has NO type-1 row") was
//     too strict for donors who BOTH give directly AND give through a
//     DAF/foundation in the same year (the foundation's gift, soft-
//     credited to them, got silently dropped because they happened to
//     have a direct gift too).
//   - 2026-06-25: precise twin-matching. A soft credit is a Veracross
//     auto-generated TWIN of a direct gift iff its `hard_credit_gift_id`
//     equals the `id` of one of THIS constituent's own type-1 gifts —
//     in that case it's excluded (already counted via the type-1 row).
//     A soft credit whose `hard_credit_gift_id` is NOT one of their own
//     type-1 ids came from a different source (their family foundation /
//     DAF gave directly and they received a soft credit) — it's a
//     genuinely separate gift and IS counted. So segment `received` =
//     SUM(type-1 amount) + SUM(non-twin soft-credit amount). This counts
//     direct gifts once, foundation gifts once, and never double-counts
//     the auto-generated twins. NOTE: type-1 rows carry
//     `hard_credit_gift_id = NULL`; the twin's id points to the type-1
//     gift's own record `id`, so type1GiftIds is collected from `id`,
//     not `hard_credit_gift_id`. Soft credits stay scoped to gift_type=3
//     (soft_credit_type 1/2) — type-5 pledge-soft-credits are a separate
//     representation of the same pledge and would double-count.
//   - FY bucket = the exact campaign string (`Operating 2025-2026`
//     vs `Operating 2024-2025`), NOT the gift date. Pledge-payment
//     gifts retroactively tagged to a prior campaign now stay in
//     that campaign's bucket even when received in the current FY.
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
// they have ANY of (2026-06-15 fix; soft-credit gap-fill added same day):
//   - gift_type = 1 (direct gift), OR
//   - gift_type = 2 (pledge — the donor committed), OR
//   - gift_type = 3 with soft_credit_type IN (1, 2) AND no gift_type-1 row
//     (gap-fill — the SAME rule the segment cards use). This catches
//     soft-credit-only constituents: a DAF/foundation or household member
//     who gave through an org. Without it, e.g. Engelhardt (FY26 soft
//     credits only) was wrongly flagged lapsed, and Schanzer (FY25 soft
//     credits only) was missing from the lapsed list entirely.
// A pledge (type-2) or qualifying soft credit therefore keeps a constituent
// OUT of lapsed and IN retained.
//   Lapsed   = gave FY25 (Operating 2024-2025) AND NOT gave FY26.
//   New      = gave FY26 (Operating 2025-2026) AND NOT gave FY25.
//   Retained = gave both years.
// (Headline Total Donors stays type-1-only and is unaffected.)
//
// Expected post-fix totals at SAR (June 2026):
//   raisedFY26  ≈ $6,297,617
//   donorsFY26  ≈ 880–1,000

const OPERATING_CAMPAIGN_PREFIX = 'Operating ';
const FY26_CAMPAIGN = 'Operating 2025-2026';
// Last-year campaign is DERIVED from the current one (current minus 1) —
// never hardcode the prior-year string, so the Campaign Giving by Fund
// FY25 column (and the lapsed/new set math) auto-rolls forward next
// fiscal year. "Operating 2025-2026" -> "Operating 2024-2025".
function priorCampaign(current: string): string {
  const m = current.match(/^(.*?)(\d{4})-(\d{4})$/);
  if (!m) return current;
  const [, prefix, y1, y2] = m;
  return `${prefix}${Number(y1) - 1}-${Number(y2) - 1}`;
}
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

interface OverviewResponse {
  headline: {
    raisedFY26: number;
    donorsFY26: number;
    raisedFY25: number;
    donorsFY25: number;
  };
  // Per-segment FY26 giving. `donationsReceived` per constituent =
  // SUM(amount) on type-1 gifts when they gave directly, otherwise
  // SUM(amount) on their qualifying type-3 soft credits (gap-fill — see
  // scope note); `outstandingPledges` = SUM(pledge_balance) on type-2
  // gifts; `total` = the two combined. `donors` = DISTINCT constituents
  // with any type-1, type-2, OR (absent a type-1) qualifying type-3
  // soft-credit Operating gift in FY26 (so pledge-only and soft-credit-
  // only donors still count once toward their segment). YoY segment
  // comparison is intentionally dropped — roles shift annually in
  // Veracross.
  segments: Array<{
    segment: string;
    donors: number;
    donationsReceived: number;
    outstandingPledges: number;
    total: number;
  }>;
  campaigns: Array<{
    fund: string;
    raisedFY26: number;
    raisedFY25: number;
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
  newDonorsFY26: number;
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

  // Single paginated read of every Operating gift (type 1 + 2 for the
  // headline/campaign/lapsed math, plus type 3 for the segment cards).
  // At SAR this is small enough (<5k rows across multiple years) to scan
  // in memory; aggregating client-side keeps the route self-contained
  // without RPCs or materialized views.
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
        .ilike('fundraising_activity', `${OPERATING_CAMPAIGN_PREFIX}%`)
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

  // Bucket gifts into FY26 / FY25 / prior. The FY assignment is the
  // exact campaign string, NOT the gift date.
  let raisedFY26 = 0;
  let raisedFY25 = 0;
  // type-1 donor sets per FY (used for headline donor counts +
  // segment math + lapsed/new logic).
  const fy26Type1Donors = new Set<number>();
  const fy25Type1Donors = new Set<number>();
  // "Gave" sets for lapsed/new/retained: any type-1, type-2, OR qualifying
  // type-3 soft credit (soft_credit_type 1/2) in that campaign. Pledge-only
  // (type-2) and soft-credit-only donors both count as having given. The
  // gap-fill caveat ("only when no type-1 row") is moot for set membership —
  // a type-1 donor is already in the set — so soft credits are added
  // unconditionally here without changing the result.
  const fy26GaveDonors = new Set<number>();
  const fy25GaveDonors = new Set<number>();
  // Per-fund + per-FY raised. fund=null/empty bucketed as '(No fund)'.
  const fundFY26 = new Map<string, number>();
  const fundFY25 = new Map<string, number>();
  // Per-donor FY26 giving for segment aggregation. We accumulate the
  // pools separately so the twin-matching gap-fill rule can be applied
  // AFTER the single pass (a soft credit's twin status depends on the
  // donor's full set of type-1 gift ids):
  //   `type1`        = SUM(amount) on type-1 gifts.
  //   `type1GiftIds` = the SET of record `id`s of those type-1 gifts. A
  //                    soft credit is a Veracross-generated TWIN iff its
  //                    `hard_credit_gift_id` is in this set (type-1 rows
  //                    themselves carry hard_credit_gift_id = NULL, so we
  //                    collect their own `id`).
  //   `softByKey`    = qualifying type-3 soft credits (soft_credit_type
  //                    1/2), deduped by hard_credit_gift_id. Each value
  //                    keeps {hcid, amount} so the twin test runs after
  //                    the loop. Dedup is by hard_credit_gift_id (the
  //                    sc_type 1 + 2 rows for one gift share an id;
  //                    falls back to `amt_<n>` when the id is null), so
  //                    11 monthly $540 soft credits sum to $5,940 — they
  //                    are NOT collapsed by amount.
  //   `pledged`      = SUM(pledge_balance) on type-2 gifts.
  // Final segment `received` = type1 + SUM(amount of soft credits whose
  // hcid is NOT a own-type-1 id). Segment totals = received + pledged.
  // `fy26SegmentDonors` (built after the loop) is every constituent who
  // gave directly (type-1), pledged (type-2), or has any qualifying soft
  // credit.
  const fy26ByDonor = new Map<number, {
    type1: number;
    type1GiftIds: Set<number>;
    softByKey: Map<string, { hcid: number | null; amount: number }>;
    pledged: number;
    hasType1: boolean;
    hasType2: boolean;
  }>();
  let fy26SegmentDonors = new Set<number>();
  // Last type-1/type-2 gift per donor per FY — feeds the lapsed (FY25)
  // and new (FY26) donor lists' "last gift" amount + date.
  const lastFy25GiftByDonor = new Map<number, { amount: number; date: string }>();
  const lastFy26GiftByDonor = new Map<number, { amount: number; date: string }>();
  // Last qualifying soft credit per donor per FY — gap-fill source for the
  // lapsed/new drilldown "last gift" amount + date when a constituent has NO
  // direct (type-1/type-2) gift in that FY (soft-credit-only donors). Direct
  // gifts always win via `direct ?? soft` at list-build time.
  const lastFy25SoftByDonor = new Map<number, { amount: number; date: string }>();
  const lastFy26SoftByDonor = new Map<number, { amount: number; date: string }>();
  const recordLast = (map: Map<number, { amount: number; date: string }>, cid: number, amount: number, date: string) => {
    const prior = map.get(cid);
    if (!prior || date > prior.date) map.set(cid, { amount, date });
  };
  const nameByDonor = new Map<number, string>();

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

    if (activity === FY26_CAMPAIGN) {
      const seg = fy26ByDonor.get(cid) ?? {
        type1: 0, type1GiftIds: new Set<number>(), softByKey: new Map<string, { hcid: number | null; amount: number }>(), pledged: 0, hasType1: false, hasType2: false,
      };
      if (isType1) {
        raisedFY26 += amt;
        fy26Type1Donors.add(cid);
        fy26GaveDonors.add(cid);
        recordLast(lastFy26GiftByDonor, cid, amt, g.date);
        fundFY26.set(fund, (fundFY26.get(fund) || 0) + amt);
        seg.type1 += amt;
        seg.type1GiftIds.add(g.id);
        seg.hasType1 = true;
        fy26ByDonor.set(cid, seg);
      } else if (isType2) {
        raisedFY26 += pledgeBal;
        fy26GaveDonors.add(cid);
        recordLast(lastFy26GiftByDonor, cid, amt, g.date);
        fundFY26.set(fund, (fundFY26.get(fund) || 0) + pledgeBal);
        seg.pledged += pledgeBal;
        seg.hasType2 = true;
        fy26ByDonor.set(cid, seg);
      } else if (isSoftCredit) {
        // Soft credits feed segment math AND the lapsed/new/retained "gave"
        // set (gap-fill: a soft-credit-only constituent counts as having
        // given). They do NOT touch raisedFY26, the per-fund campaign table,
        // or the type-1 headline donor count. Stored by hard_credit_gift_id
        // (sc_type 1 + 2 share an id → deduped to one underlying gift;
        // falls back to `amt_<n>` when null) with {hcid, amount} so the
        // after-loop twin test can drop only the soft credits whose hcid is
        // one of THIS donor's own type-1 gift ids. `lastFy26SoftByDonor` is
        // the gap-fill last-gift source for the new-donor drilldown (used
        // only when the donor has no direct gift).
        const softKey = g.hard_credit_gift_id != null ? String(g.hard_credit_gift_id) : `amt_${amt}`;
        if (!seg.softByKey.has(softKey)) {
          seg.softByKey.set(softKey, { hcid: g.hard_credit_gift_id, amount: amt });
        }
        fy26ByDonor.set(cid, seg);
        fy26GaveDonors.add(cid);
        recordLast(lastFy26SoftByDonor, cid, amt, g.date);
      }
    } else if (activity === FY25_CAMPAIGN) {
      if (isType1) {
        raisedFY25 += amt;
        fy25Type1Donors.add(cid);
        fy25GaveDonors.add(cid);
        recordLast(lastFy25GiftByDonor, cid, amt, g.date);
        fundFY25.set(fund, (fundFY25.get(fund) || 0) + amt);
      } else if (isType2) {
        raisedFY25 += pledgeBal;
        fy25GaveDonors.add(cid);
        recordLast(lastFy25GiftByDonor, cid, amt, g.date);
        fundFY25.set(fund, (fundFY25.get(fund) || 0) + pledgeBal);
      } else if (isSoftCredit) {
        // FY25 gap-fill: a soft-credit-only constituent counts as having
        // given last year, so they correctly enter the lapsed set when they
        // have no FY26 gift (e.g. Schanzer, Bruce and Jill — FY25 soft
        // credits only; their fund made the direct gift). Soft credits do
        // NOT touch raisedFY25, the FY25 headline donor count, or the
        // per-fund FY25 column. `lastFy25SoftByDonor` is the gap-fill
        // last-gift source for the lapsed drilldown.
        fy25GaveDonors.add(cid);
        recordLast(lastFy25SoftByDonor, cid, amt, g.date);
      }
    }
  }

  // A constituent counts toward a segment if they gave directly (type-1),
  // pledged (type-2), or — only when they have NO direct gift — carry a
  // qualifying soft credit. This excludes constituents whose sole FY26
  // attribution was a non-qualifying type-3 row (e.g. a pledge soft
  // credit), which would otherwise be a $0 donor.
  fy26SegmentDonors = new Set<number>();
  for (const [cid, v] of fy26ByDonor) {
    if (v.hasType1 || v.hasType2 || v.softByKey.size > 0) fy26SegmentDonors.add(cid);
  }

  // Prior-year "gave" baseline for lapsed/new/retained. Prefer
  // giving_history_cache (the nightly "Operating Gift History Export" —
  // complete across all years; gifts_cache is missing pre-FY26 history).
  // Falls back to the gifts_cache prior-year set when the history table is
  // empty (before the first import) so nothing breaks.
  //
  // 2026-06-18 FIX: match on `fundraising_activity = FY25_CAMPAIGN`
  // ('Operating 2024-2025'), NOT `fiscal_year = 'FY25'`. Veracross stamps
  // `fiscal_year` from the GIFT DATE, not the campaign — so gifts to the
  // Operating 2024-2025 campaign dated in the summer-2024 shoulder land in
  // FY24, and gifts dated in the fall-2025 shoulder land in FY26. The old
  // fiscal_year filter therefore missed long-time donors (e.g. Newman /
  // Perl Aug-2024 gifts → FY24; Landes Sep-2025 soft credit → FY26),
  // mislabeling them "New". The campaign field is date-independent and
  // mirrors how the FY26 side (`fy26GaveDonors`) already keys off the
  // exact campaign string. Gift types broadened to 1-5 so pledge
  // installments (4) and pledge soft-credits (5) also count as having
  // given (Perl/Landes had FY25 type-4 rows the old 1-3 filter dropped).
  let fy25Baseline = fy25GaveDonors;
  let fy25BaselineSource: 'giving_history_cache' | 'gifts_cache' = 'gifts_cache';
  try {
    const histDonors = new Set<number>();
    let hfrom = 0;
    const hpage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('giving_history_cache')
        .select('constituent_id')
        .eq('workspace_id', wsId)
        .eq('fundraising_activity', FY25_CAMPAIGN)
        .in('gift_type', [1, 2, 3, 4, 5])
        .range(hfrom, hfrom + hpage - 1);
      if (error) { console.error('[OVERVIEW] giving_history prior-year query failed:', error); break; }
      if (!data || data.length === 0) break;
      for (const r of data) if (r.constituent_id != null) histDonors.add(r.constituent_id);
      if (data.length < hpage) break;
      hfrom += hpage;
    }
    if (histDonors.size > 0) {
      fy25Baseline = histDonors;
      fy25BaselineSource = 'giving_history_cache';
    }
  } catch (err) {
    console.error('[OVERVIEW] giving_history prior-year lookup failed (non-fatal):', err);
  }
  console.log(`[OVERVIEW] prior-year baseline source=${fy25BaselineSource} campaign=${FY25_CAMPAIGN} size=${fy25Baseline.size}`);

  // Pull role + roles_raw from constituents_cache for every donor we
  // saw (FY26 segment donors + FY25 baseline donors for lapsed pills).
  // Chunked IN(...) to keep individual queries small.
  const allDonorIds = Array.from(new Set<number>([...fy25Baseline, ...fy26SegmentDonors, ...fy26GaveDonors]));
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

  // Build per-segment aggregates: received (type-1) + pledged (type-2)
  // + total, and a distinct-donor set per segment.
  const segmentMap = new Map<string, { donationsReceived: number; outstandingPledges: number; donors: Set<number> }>();
  for (const seg of ALL_SEGMENTS) {
    segmentMap.set(seg, { donationsReceived: 0, outstandingPledges: 0, donors: new Set() });
  }
  for (const [cid, v] of fy26ByDonor) {
    if (!fy26SegmentDonors.has(cid)) continue; // drop non-qualifying $0 donors
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
    const s = segmentMap.get(segmentOf(cid))!;
    s.donationsReceived += received;
    s.outstandingPledges += v.pledged;
    s.donors.add(cid);
  }
  const segments = ALL_SEGMENTS.map(seg => {
    const s = segmentMap.get(seg)!;
    return {
      segment: seg,
      donors: s.donors.size,
      donationsReceived: s.donationsReceived,
      outstandingPledges: s.outstandingPledges,
      total: s.donationsReceived + s.outstandingPledges,
    };
  });

  // Campaigns by fund within Operating — union of FY26 + FY25 fund
  // buckets, sorted by FY26 desc. Sums use the Total Raised formula
  // (type-1 amount + type-2 pledge_balance) so per-fund subtotals
  // reconcile with the headline.
  const allFunds = new Set<string>([...fundFY26.keys(), ...fundFY25.keys()]);
  const campaigns = Array.from(allFunds)
    .map(fund => ({
      fund,
      raisedFY26: fundFY26.get(fund) || 0,
      raisedFY25: fundFY25.get(fund) || 0,
    }))
    .filter(c => c.raisedFY26 > 0 || c.raisedFY25 > 0)
    .sort((a, b) => b.raisedFY26 - a.raisedFY26);

  // Lapsed = gave FY25 and NOT gave FY26. New = gave FY26 and NOT gave FY25.
  // Retained (computed in the UI from the counts) = both. The "gave" sets
  // now include type-1, type-2, AND qualifying soft credits (gap-fill), so a
  // FY26 pledge OR soft credit keeps a constituent out of lapsed, and a
  // FY25-soft-credit-only constituent correctly enters lapsed.
  // FY25 baseline = giving_history_cache (complete) when available, else
  // gifts_cache. FY26 "gave" stays gifts_cache (fresher current-year data).
  const lapsedIds = Array.from(fy25Baseline).filter(cid => !fy26GaveDonors.has(cid));
  const newIds = Array.from(fy26GaveDonors).filter(cid => !fy25Baseline.has(cid));

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

  const lapsedDonors = buildDonorList(lapsedIds, lastFy25GiftByDonor, lastFy25SoftByDonor);
  const newDonorsList = buildDonorList(newIds, lastFy26GiftByDonor, lastFy26SoftByDonor);
  // Person-only counts (orgs excluded) so the pills match the drilldown lists.
  const lapsedCount = lapsedIds.filter(cid => !orgIds.has(cid)).length;
  const newCount = newIds.filter(cid => !orgIds.has(cid)).length;
  const newDonorsFY26 = newCount;

  const payload: OverviewResponse = {
    headline: {
      raisedFY26,
      donorsFY26: fy26Type1Donors.size,
      raisedFY25,
      donorsFY25: fy25Type1Donors.size,
    },
    segments,
    campaigns,
    lapsed: {
      count: lapsedCount,
      totalLastYearDonors: fy25Baseline.size,
      donors: lapsedDonors,
    },
    newDonorsFY26,
    newDonors: {
      count: newCount,
      donors: newDonorsList,
    },
  };
  return NextResponse.json(payload);
}
