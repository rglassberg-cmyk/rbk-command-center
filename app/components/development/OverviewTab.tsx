'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';
import { ShimmerStatCards, ShimmerCards } from '../ui/Shimmer';
import { useAuth } from '../AuthProvider';

const ADMIN_EMAIL = 'rglassberg@saracademy.org';

interface Segment {
  segment: string;
  donors: number;
  donationsReceived: number;
  outstandingPledges: number;
  total: number;
}

interface LapsedDonor {
  constituent_id: number;
  name: string;
  role: string;
  lastAmount: number;
  lastDate: string;
}

interface OverviewData {
  headline: {
    raisedFY26: number;
    donorsFY26: number;
    raisedFY25: number;
    donorsFY25: number;
  };
  segments: Segment[];
  campaigns: Array<{
    fund: string;
    raisedFY26: number;
    raisedFY25: number;
  }>;
  lapsed: {
    count: number;
    totalLastYearDonors: number;
    donors: LapsedDonor[];
  };
  newDonorsFY26: number;
  newDonors: {
    count: number;
    donors: LapsedDonor[];
  };
}

// One donor row in a segment drill-down (from
// /api/development/overview/segment-donors).
interface SegmentDonor {
  constituentId: string;
  constituentName: string;
  donationsReceived: number;
  outstandingPledges: number;
  total: number;
  lastGiftDate: string | null;
  primaryDevelopmentRole: string;
  secondaryRole?: string | null;
}

// Visual styling per segment — top borders on the segment cards and the
// pill colors on the lapsed-donor table. Keys match the API's
// ALL_SEGMENTS set so every card/pill resolves a color.
const SEGMENT_STYLE: Record<string, { topBorder: string; pillCls: string }> = {
  'Board Members':              { topBorder: 'border-t-indigo-500', pillCls: 'bg-indigo-50 text-indigo-700' },
  Parent:                       { topBorder: 'border-t-blue-400',   pillCls: 'bg-blue-50 text-blue-700' },
  Grandparent:                  { topBorder: 'border-t-purple-400', pillCls: 'bg-purple-50 text-purple-700' },
  'Parents of Alumni':          { topBorder: 'border-t-orange-400', pillCls: 'bg-orange-50 text-orange-700' },
  'Program & Future Families':  { topBorder: 'border-t-teal-400',   pillCls: 'bg-teal-50 text-teal-700' },
  Alumni:                       { topBorder: 'border-t-green-400',  pillCls: 'bg-green-50 text-green-700' },
  Faculty:                      { topBorder: 'border-t-amber-400',  pillCls: 'bg-amber-50 text-amber-700' },
  Other:                        { topBorder: 'border-t-slate-300',  pillCls: 'bg-slate-100 text-slate-600' },
};

// Veracross constituent gift-detail page. Opened in a new tab from any
// donor name in a drill-down drawer.
function veracrossUrl(constituentId: string | number): string {
  return `https://axiom.veracross.com/sar/#/detail/development-constituent/${constituentId}/4028-gift-detail`;
}

function pctDelta(curr: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((curr - prior) / prior) * 100;
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function OverviewTab() {
  const { user } = useAuth();
  const isAdmin = (user?.email ?? '').toLowerCase() === ADMIN_EMAIL;
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lapsedOpen, setLapsedOpen] = useState(false);
  // Admin-only "Import History" trigger state.
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const runImport = useCallback(async () => {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await apiFetch('/api/development/giving-history/ingest', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.error || `Import failed (${res.status})`);
      setImportMsg(`Imported ${Number(j.rows_upserted).toLocaleString()} records from ${j.file}`);
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
      setTimeout(() => setImportMsg(null), 8000);
    }
  }, []);

  // Drill-down drawer. `kind: 'segment'` fetches donors lazily;
  // `kind: 'lapsed'` reuses the lapsed list already in the payload.
  const [drawer, setDrawer] = useState<{ kind: 'segment'; segment: string } | { kind: 'lapsed' } | { kind: 'new' } | null>(null);
  const [drawerSearch, setDrawerSearch] = useState('');
  const [segCache, setSegCache] = useState<Map<string, SegmentDonor[]>>(new Map());
  const [segLoading, setSegLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/development/overview')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed')))
      .then(json => { if (!cancelled) setData(json as OverviewData); })
      .catch(() => { if (!cancelled) setError("Couldn't load overview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Lazy-fetch segment donors on first open of each segment; cached for
  // the session so re-opening is instant.
  useEffect(() => {
    if (drawer?.kind !== 'segment') return;
    const seg = drawer.segment;
    if (segCache.has(seg)) return;
    let cancelled = false;
    setSegLoading(true);
    apiFetch(`/api/development/overview/segment-donors?segment=${encodeURIComponent(seg)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed')))
      .then(json => { if (!cancelled) setSegCache(prev => new Map(prev).set(seg, (json.donors ?? []) as SegmentDonor[])); })
      .catch(() => { if (!cancelled) setSegCache(prev => new Map(prev).set(seg, [])); })
      .finally(() => { if (!cancelled) setSegLoading(false); });
    return () => { cancelled = true; };
  }, [drawer, segCache]);

  // Close the drawer on Escape.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const openSegment = useCallback((segment: string) => { setDrawerSearch(''); setDrawer({ kind: 'segment', segment }); }, []);
  const openLapsed = useCallback(() => { setDrawerSearch(''); setDrawer({ kind: 'lapsed' }); }, []);
  const openNew = useCallback(() => { setDrawerSearch(''); setDrawer({ kind: 'new' }); }, []);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const lapsedRatio = data && data.lapsed.totalLastYearDonors > 0
    ? data.lapsed.count / data.lapsed.totalLastYearDonors
    : 0;

  // Rows currently shown in the drawer, filtered by the search box.
  const drawerRows = useMemo(() => {
    if (!drawer || !data) return [];
    const q = drawerSearch.trim().toLowerCase();
    if (drawer.kind === 'segment') {
      const rows = segCache.get(drawer.segment) ?? [];
      return q ? rows.filter(r => r.constituentName.toLowerCase().includes(q)) : rows;
    }
    const rows = drawer.kind === 'new' ? data.newDonors.donors : data.lapsed.donors;
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
  }, [drawer, data, drawerSearch, segCache]);

  if (loading) {
    return (
      <div>
        <ShimmerStatCards count={4} />
        <div className="mt-6"><ShimmerCards count={6} /></div>
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-red-500 text-sm py-8 text-center">{error || 'No data available'}</p>;
  }

  // Campaign totals row at the bottom of the table.
  const campaignTotalFY26 = data.campaigns.reduce((s, c) => s + c.raisedFY26, 0);
  const campaignTotalFY25 = data.campaigns.reduce((s, c) => s + c.raisedFY25, 0);

  const drawerTitle = drawer?.kind === 'segment' ? drawer.segment
    : drawer?.kind === 'new' ? 'New Donors'
    : 'Lapsed Donors';
  // Header count: segment uses the loaded list length; lapsed/new use the
  // authoritative count from the payload (list may be truncated to 100).
  const drawerCount = drawer?.kind === 'segment'
    ? (segCache.get(drawer.segment)?.length ?? 0)
    : drawer?.kind === 'new' ? data.newDonors.count
    : data.lapsed.count;

  return (
    <div className="space-y-8">
      {/* Admin-only: manually trigger the giving-history CSV import. */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-3 -mb-4">
          {importMsg && <span className="text-xs text-slate-500">{importMsg}</span>}
          <button
            onClick={runImport}
            disabled={importing}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            title="Import the latest Operating Gift History Export from Gmail"
          >
            <svg className={`w-4 h-4 ${importing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {importing ? 'Importing…' : 'Import History'}
          </button>
        </div>
      )}

      {/* SECTION 1 — Headline cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 border-t-4 border-t-blue-500 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Raised FY26</p>
          <p className="text-slate-900 font-bold mt-2" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(data.headline.raisedFY26)}
          </p>
          <p className="text-xs text-slate-400 mt-2">FY26 · Hard credits + outstanding pledges</p>
          <p className="text-[11px] text-slate-400 mt-0.5">FY25 comparison pending</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 border-t-4 border-t-slate-500 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Donors FY26</p>
          <p className="text-slate-900 font-bold mt-2" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {data.headline.donorsFY26.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-2">Unique donors</p>
          <p className="text-[11px] text-slate-400 mt-0.5">FY25 comparison pending</p>
        </div>

        <button
          onClick={openLapsed}
          title="Donors who gave in FY2024-25 but have not yet given in FY2025-26"
          className="text-left bg-white rounded-xl shadow-sm border border-slate-200 border-t-4 border-t-red-500 p-5 hover:shadow-md hover:border-red-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lapsed Donors</p>
            <span className="text-[11px] text-red-500 font-medium">View →</span>
          </div>
          <p className="text-red-600 font-bold mt-2" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {data.lapsed.count.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-2">Gave FY2024-25, not yet FY2025-26</p>
          <div className="mt-2">
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-red-500" style={{ width: `${Math.min(100, lapsedRatio * 100)}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Goal: 0 by Aug 31</p>
          </div>
        </button>

        <button
          onClick={openNew}
          title="First-time donors in FY2025-26 who did not give in FY2024-25"
          className="text-left bg-white rounded-xl shadow-sm border border-slate-200 border-t-4 border-t-green-500 p-5 hover:shadow-md hover:border-green-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New Donors</p>
            <span className="text-[11px] text-green-600 font-medium">View →</span>
          </div>
          <p className="text-green-600 font-bold mt-2" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {data.newDonors.count.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-2">First-time in FY2025-26 (not FY2024-25)</p>
        </button>
      </div>

      {/* SECTION 2 — Segment cards (clickable → donor drill-down) */}
      <div>
        <h2 className="text-base font-semibold text-slate-800">Giving by Segment · FY26</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">Each donor counted once by current primary role · click a card to see its donors · YoY segment comparison omitted — roles shift annually in Veracross</p>
        <div className="overflow-x-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 min-w-[780px] lg:min-w-0">
            {data.segments.map(s => {
              const style = SEGMENT_STYLE[s.segment] ?? SEGMENT_STYLE.Other;
              return (
                <button
                  key={s.segment}
                  onClick={() => openSegment(s.segment)}
                  className={`text-left bg-white rounded-xl shadow-sm border border-slate-200 border-t-4 ${style.topBorder} p-4 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer`}
                >
                  <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    {s.segment}
                    {s.segment === 'Other' && (
                      <span
                        title="Donors whose Veracross role doesn't match a named segment — may include DAFs, foundations, and untagged constituents."
                        className="text-slate-400 cursor-help"
                        aria-label="What is Other?"
                      >
                        ⓘ
                      </span>
                    )}
                  </p>
                  <p className="text-slate-900 font-bold mt-1" style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(s.total)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {s.donors.toLocaleString()} donor{s.donors === 1 ? '' : 's'}
                  </p>
                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-0.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Received</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(s.donationsReceived)}</span>
                    </div>
                    {s.outstandingPledges > 0 && (
                      <div className="flex items-center justify-between text-xs font-light text-slate-400">
                        <span>Pledged</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(s.outstandingPledges)}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECTION 3 — Campaign giving YoY table */}
      <div>
        <h2 className="text-base font-semibold text-slate-800">Campaign Giving by Fund</h2>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">FY26 vs FY25</p>
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Fund</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">FY26</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">FY25</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Change</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-sm text-slate-400 py-6">No campaign data.</td></tr>
              ) : data.campaigns.map(c => {
                const delta = c.raisedFY26 - c.raisedFY25;
                const pct = pctDelta(c.raisedFY26, c.raisedFY25);
                const deltaCls = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-slate-400';
                return (
                  <tr key={c.fund} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-800">{c.fund}</td>
                    <td className="px-5 py-3 text-right text-slate-800" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c.raisedFY26 > 0 ? formatMoney(c.raisedFY26) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c.raisedFY25 > 0 ? formatMoney(c.raisedFY25) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-5 py-3 text-right ${deltaCls}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {delta === 0 ? <span className="text-slate-300">—</span> : (
                        <>
                          {delta > 0 ? '+' : ''}{formatMoney(delta)}
                          {pct != null && <span className="text-xs ml-1.5 opacity-70">({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</span>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.campaigns.length > 0 && (() => {
                const totalDelta = campaignTotalFY26 - campaignTotalFY25;
                const totalPct = pctDelta(campaignTotalFY26, campaignTotalFY25);
                const cls = totalDelta > 0 ? 'text-green-700' : totalDelta < 0 ? 'text-red-700' : 'text-slate-500';
                return (
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-5 py-3 text-slate-800">Total</td>
                    <td className="px-5 py-3 text-right text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(campaignTotalFY26)}</td>
                    <td className="px-5 py-3 text-right text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(campaignTotalFY25)}</td>
                    <td className={`px-5 py-3 text-right ${cls}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {totalDelta > 0 ? '+' : ''}{formatMoney(totalDelta)}
                      {totalPct != null && <span className="text-xs ml-1.5 opacity-70">({totalPct > 0 ? '+' : ''}{totalPct.toFixed(0)}%)</span>}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 4 — Lapsed donors (inline accordion; the headline card
          also opens the same list in a drawer) */}
      <div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setLapsedOpen(o => !o)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
              <div className="text-left">
                <h2 className="text-base font-semibold text-slate-800">Lapsed Donors</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {data.lapsed.count.toLocaleString()} {data.lapsed.count === 1 ? 'donor' : 'donors'} gave in FY25, haven&apos;t given yet in FY26 — click to {lapsedOpen ? 'collapse' : 'view'}
                </p>
              </div>
            </div>
            <svg className={`w-5 h-5 text-slate-400 transition-transform ${lapsedOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {lapsedOpen && (
            <div className="border-t border-slate-100 overflow-x-auto">
              {data.lapsed.donors.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No lapsed donors yet.</p>
              ) : (
                <>
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Role</th>
                        <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Last Gift</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Last Gift Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lapsed.donors.map(d => {
                        const style = SEGMENT_STYLE[d.role] ?? SEGMENT_STYLE.Other;
                        return (
                          <tr key={d.constituent_id} className="border-b border-slate-100 last:border-0">
                            <td className="px-5 py-3 font-medium text-slate-800">
                              <a href={veracrossUrl(d.constituent_id)} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 hover:underline">
                                {d.name}
                              </a>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center text-[11px] font-medium rounded-full px-2 py-0.5 ${style.pillCls}`}>
                                {d.role}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right text-slate-800" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatMoney(d.lastAmount)}
                            </td>
                            <td className="px-5 py-3 text-slate-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatShortDate(d.lastDate)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {data.lapsed.count > data.lapsed.donors.length && (
                    <p className="text-xs text-slate-400 px-5 py-3 italic">
                      Showing top {data.lapsed.donors.length} by last gift amount.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Drill-down drawer — shared by segment cards (STEP 2) and the
          lapsed headline card (STEP 3). Same slide-in pattern as the
          Israel Fund / Guardian Circle side panels. */}
      {drawer && (
        <>
          <div className="fixed inset-0 bg-slate-900/20 z-40 print:hidden" onClick={closeDrawer} />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-[560px] bg-white shadow-2xl z-50 flex flex-col print:hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 truncate">{drawerTitle}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{drawerCount.toLocaleString()} {drawerCount === 1 ? 'donor' : 'donors'}</p>
              </div>
              <button
                onClick={closeDrawer}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-3 border-b border-slate-100">
              <input
                type="text"
                value={drawerSearch}
                onChange={e => setDrawerSearch(e.target.value)}
                placeholder="Search by name…"
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {drawer.kind === 'segment' && segLoading && !segCache.has(drawer.segment) ? (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-12">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Loading donors…
                </div>
              ) : drawerRows.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-12">
                  {drawerSearch.trim()
                    ? 'No donors match your search.'
                    : drawer.kind === 'segment' ? 'No donors in this segment.'
                    : drawer.kind === 'new' ? 'No new donors yet.' : 'No lapsed donors.'}
                </p>
              ) : drawer.kind === 'segment' ? (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Donor</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Received</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Pledged</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drawerRows as SegmentDonor[]).map(d => {
                      // Board Members drilldown only: show the role each
                      // trustee would otherwise classify as.
                      const showSecondary = drawer.kind === 'segment' && drawer.segment === 'Board Members' && !!d.secondaryRole;
                      const secStyle = d.secondaryRole ? (SEGMENT_STYLE[d.secondaryRole] ?? SEGMENT_STYLE.Other) : null;
                      return (
                      <tr key={d.constituentId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            <a href={veracrossUrl(d.constituentId)} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-800 hover:text-blue-600 hover:underline">
                              {d.constituentName}
                            </a>
                            {showSecondary && secStyle && (
                              <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-1.5 py-0.5 ${secStyle.pillCls}`}>
                                {d.secondaryRole}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.donationsReceived)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-400" style={{ fontVariantNumeric: 'tabular-nums' }}>{d.outstandingPledges > 0 ? formatMoney(d.outstandingPledges) : '—'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.total)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Donor</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">{drawer.kind === 'new' ? 'FY26 Gift' : 'FY25 Gift'}</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drawerRows as LapsedDonor[]).map(d => (
                      <tr key={d.constituent_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <a href={veracrossUrl(d.constituent_id)} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-800 hover:text-blue-600 hover:underline">
                            {d.name}
                          </a>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.lastAmount)}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{drawer.kind === 'new' ? 'New this year' : 'Not yet given FY26'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {drawer.kind === 'lapsed' && data.lapsed.count > data.lapsed.donors.length && !drawerSearch.trim() && (
                <p className="text-xs text-slate-400 px-4 py-3 italic">Showing top {data.lapsed.donors.length} by last gift amount.</p>
              )}
              {drawer.kind === 'new' && data.newDonors.count > data.newDonors.donors.length && !drawerSearch.trim() && (
                <p className="text-xs text-slate-400 px-4 py-3 italic">Showing top {data.newDonors.donors.length} by gift amount.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
