'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';
import ConstituentTable, { type Constituent } from './ConstituentTable';
import ThankYouModal from './ThankYouModal';
import { ShimmerStatCards, ShimmerTableRows } from '../ui/Shimmer';
import type { DonorTag } from './DonorAnnotations';

// Client-only — DonorAnnotations does its own fetching + caret/contenteditable
// logic that historically broke on iOS Safari hydration.
const DonorAnnotations = dynamic(() => import('./DonorAnnotations'), { ssr: false });

// Role pill classes mirrored from ConstituentTable so the sidebar pill
// matches the row pill. 'Other' has no entry → no pill.
const SIDEBAR_ROLE_PILL: Record<string, string> = {
  Parent: 'bg-blue-50 text-blue-700',
  Grandparent: 'bg-purple-50 text-purple-700',
  'Parents of Alumni': 'bg-orange-50 text-orange-700',
  Alumni: 'bg-green-50 text-green-700',
  Faculty: 'bg-amber-50 text-amber-700',
};

const SIDEBAR_GRADE_LABEL: Record<number, string> = {
  40: 'Infant/Toddler', 35: '2 Year Nursery', 30: '3 Year Nursery',
  25: '4 Year Nursery', 20: 'Kindergarten',
};
function sidebarGradeLabel(g: number): string {
  return SIDEBAR_GRADE_LABEL[g] ?? `Grade ${g}`;
}

// Gifts that show up in Veracross reports but are excluded from the
// /v3/development/gifts API response, so they're missing from
// `gifts_cache` and therefore from every total on this page. Maintained
// by hand here until Veracross resolves the API gap — keep this list
// in sync as gifts are added or fixed. The callout is data-driven (sums
// + count + table all derived from this array), so updating one
// FLAGGED_RECORDS entry updates the entire callout automatically.
const FLAGGED_RECORDS: { constituent: string; constituentId: number | null; date: string; amount: number }[] = [
  { constituent: 'Shmidman, Yehuda and Rebecca', constituentId: 5622, date: '04/17/2023', amount: 25000 },
  { constituent: 'Siegel',                       constituentId: null, date: '03/13/2025', amount: 1897 },
  { constituent: 'Levine',                       constituentId: null, date: '04/10/2025', amount: 1774 },
];
const FLAGGED_TOTAL = FLAGGED_RECORDS.reduce((s, r) => s + r.amount, 0);
const FLAGGED_NOTE = 'Gift appears in Veracross reports but is excluded from /v3/development/gifts API response. Veracross ticket submitted 06/03/2026.';

interface GuardianCirclePayload {
  fund: string;
  totalRaised: number;
  donorCount: number;
  outstandingTotal: number;
  constituents: Constituent[];
  asOf: string;
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(constituents: Constituent[]) {
  const header = ['Donor', 'Total Pledge', 'Paid', 'Outstanding', 'Frequency', 'Thank You Sent', 'Status', 'Role', 'Last Gift', 'Veracross ID'];
  const lines = [header.join(',')];
  for (const c of constituents) {
    const status = c.outstanding === 0 ? 'Paid in full' : c.paid > 0 ? 'In progress' : 'Pledge pending';
    lines.push([
      escapeCsvField(c.donorName),
      c.totalPledge,
      c.paid,
      c.outstanding,
      escapeCsvField(c.paymentFrequency || ''),
      escapeCsvField(c.thankYouLetterDate || ''),
      escapeCsvField(status),
      escapeCsvField(c.primaryDevelopmentRole || ''),
      c.lastGiftDate,
      c.donorId,
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guardian-circle-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GuardianCirclePage() {
  const [data, setData] = useState<GuardianCirclePayload | null>(null);
  const [summary, setSummary] = useState<{ totalRaised: number; outstandingTotal: number; donorCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [thankYouTarget, setThankYouTarget] = useState<Constituent | null>(null);
  // Sidebar drawer state — Sprint 4: name click opens this with role,
  // BBF, child grades, aging-out warning, current-year giving, the
  // Giving History placeholder, and DonorAnnotations.
  const [donorPanel, setDonorPanel] = useState<Constituent | null>(null);
  // Data-quality callout collapsed by default. Surfaced when there are
  // any FLAGGED_RECORDS — known gifts that don't come back from the
  // Veracross gifts API.
  const [flaggedOpen, setFlaggedOpen] = useState(false);
  // Workspace-wide tag bulk fetch — grouped by constituent_name so each row
  // can render its tags without firing its own request (would be 246 RTTs).
  const [tagsByDonor, setTagsByDonor] = useState<Map<string, DonorTag[]>>(new Map());

  // Fetch all donor tags once; group by constituent_name.
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/development/donor-tags')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json?.tags) return;
        const map = new Map<string, DonorTag[]>();
        for (const t of json.tags as DonorTag[]) {
          const arr = map.get(t.constituent_name) || [];
          arr.push(t);
          map.set(t.constituent_name, arr);
        }
        setTagsByDonor(map);
      })
      .catch(() => { /* silent — tags will just be empty */ });
    return () => { cancelled = true; };
  }, []);

  const handleTagsChange = useCallback((constituentName: string, next: DonorTag[]) => {
    setTagsByDonor(prev => {
      const m = new Map(prev);
      if (next.length === 0) m.delete(constituentName);
      else m.set(constituentName, next);
      return m;
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setTableLoading(true);
    setError(null);
    // Phase 1: fast summary for stat cards
    try {
      const sumRes = await apiFetch('/api/development/guardian-circle?view=summary');
      if (sumRes.ok) {
        setSummary(await sumRes.json());
        setLoading(false); // stat cards can render now
      }
    } catch { /* non-fatal, full data will populate cards too */ }
    // Phase 2: full constituent data
    try {
      const res = await apiFetch('/api/development/guardian-circle');
      if (!res.ok) throw new Error('Failed');
      const json = (await res.json()) as GuardianCirclePayload;
      setData(json);
      setSummary({ totalRaised: json.totalRaised, outstandingTotal: json.outstandingTotal, donorCount: json.donorCount });
    } catch {
      setError("Couldn't load Guardian Circle.");
    }
    setLoading(false);
    setTableLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const availableRoles = useMemo(() => {
    if (!data) return [] as string[];
    const set = new Set<string>();
    for (const c of data.constituents) {
      if (c.primaryDevelopmentRole) set.add(c.primaryDevelopmentRole);
    }
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [] as Constituent[];
    const q = search.trim().toLowerCase();
    return data.constituents.filter(c => {
      if (q && !c.donorName.toLowerCase().includes(q)) return false;
      if (roleFilter !== 'All' && c.primaryDevelopmentRole !== roleFilter) return false;
      return true;
    });
  }, [data, search, roleFilter]);

  if (loading && !summary) {
    return (
      <div className="px-8 py-8">
        <ShimmerStatCards count={3} />
        <ShimmerTableRows rows={12} cols={5} />
      </div>
    );
  }

  if (error || (!data && !summary)) {
    return (
      <div className="px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-red-700 text-sm">{error || 'No data'}</span>
          <button onClick={fetchData} className="text-red-600 text-sm font-medium hover:text-red-800">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-slate-900 font-semibold" style={{ fontSize: 28 }}>Guardian Circle</h1>
          <p className="text-slate-500 mt-1" style={{ fontSize: 14 }}>FY26 · Pledged and Paid Detail</p>
        </div>
        <button
          onClick={() => downloadCsv(filtered)}
          className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>

      {/* Data-quality callout — known gifts the Veracross API drops.
          Hidden when FLAGGED_RECORDS is empty so the callout self-
          retires once Veracross fixes the API gap. */}
      {FLAGGED_RECORDS.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg">
          <button
            onClick={() => setFlaggedOpen(o => !o)}
            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-amber-100 transition-colors rounded-lg"
          >
            <span className="flex items-center gap-2 text-sm text-amber-800">
              <svg className="w-4 h-4 flex-shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span>
                <strong className="font-semibold">{formatMoney(FLAGGED_TOTAL)}</strong> in known gifts not returned by Veracross API · View details
              </span>
            </span>
            <svg className={`w-4 h-4 text-amber-600 transition-transform flex-shrink-0 ${flaggedOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {flaggedOpen && (
            <div className="border-t border-amber-200 px-4 py-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-amber-700">
                      <th className="py-2 pr-4 font-medium">Constituent</th>
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium text-right">Amount</th>
                      <th className="py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FLAGGED_RECORDS.map((r, i) => (
                      <tr key={`${r.constituent}-${r.date}-${i}`} className="border-b border-amber-100 last:border-0 align-top">
                        <td className="py-2 pr-4 text-slate-800">
                          {r.constituentId != null ? (
                            <a
                              href={`https://axiom.veracross.com/sar/#/detail/development-constituent/${r.constituentId}/5011-general`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-900 hover:text-amber-700 underline-offset-2 hover:underline"
                            >
                              {r.constituent}
                            </a>
                          ) : (
                            r.constituent
                          )}
                        </td>
                        <td className="py-2 pr-4 text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.date}</td>
                        <td className="py-2 pr-4 text-right text-slate-800" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(r.amount)}</td>
                        <td className="py-2 text-xs text-slate-600">{FLAGGED_NOTE}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-amber-700 mt-3">
                Guardian Circle totals on this page may be understated by {formatMoney(FLAGGED_TOTAL)} until Veracross resolves the API gap.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total raised</p>
          <p className="text-blue-700 font-semibold mt-1" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(summary?.totalRaised ?? data?.totalRaised ?? 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Donations + outstanding pledges</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Donors</p>
          <p className="text-slate-900 font-semibold mt-1" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {summary?.donorCount ?? data?.donorCount ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding pledges</p>
          <p className="text-amber-600 font-semibold mt-1" style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(summary?.outstandingTotal ?? data?.outstandingTotal ?? 0)}
          </p>
        </div>
      </div>

      {/* Role filter pills */}
      {availableRoles.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs uppercase tracking-wide text-slate-500 mr-2">Role:</span>
          {['All', ...availableRoles].map(role => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                roleFilter === role
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search donors..."
          className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
          >×</button>
        )}
      </div>

      {/* Full constituent table */}
      {tableLoading ? (
        <ShimmerTableRows rows={12} cols={5} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <ConstituentTable
            constituents={filtered}
            onThankYouClick={(c) => setThankYouTarget(c)}
            tagsByDonor={tagsByDonor}
            onTagsChange={handleTagsChange}
            enableAnnotations
            onDonorClick={(c) => setDonorPanel(c)}
            showBbfColumn
          />
        </div>
      )}

      {thankYouTarget && (
        <ThankYouModal
          constituent={thankYouTarget}
          campaignName="Guardian Circle 2025-26"
          onClose={() => setThankYouTarget(null)}
        />
      )}

      {donorPanel && (() => {
        const c = donorPanel;
        const tags = tagsByDonor.get(c.donorName) ?? [];
        const rolePillCls = c.role && c.role !== 'Other' ? SIDEBAR_ROLE_PILL[c.role] : null;
        const totalCommitted = c.paid + c.outstanding;
        return (
          <>
            <div
              className="fixed inset-0 bg-slate-900/20 z-40 print:hidden"
              onClick={() => setDonorPanel(null)}
            />
            <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col print:hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-slate-900 truncate">{c.donorName}</h3>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {rolePillCls && (
                        <span className={`inline-flex items-center text-xs font-medium rounded px-2 py-0.5 ${rolePillCls}`}>
                          {c.role}
                        </span>
                      )}
                      {c.anonymous === true && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                          🔒 Anon
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setDonorPanel(null)}
                    className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Aging-out warning — amber banner, surfaced before
                    giving stats so it catches the eye when present. */}
                {c.agingOut === true && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                    <span className="text-base leading-none">🚩</span>
                    <span><strong>Youngest child graduating this year</strong> — prioritize outreach.</span>
                  </div>
                )}

                {/* BBF / Capital — only when there's a real pledge. */}
                {(c.bbfTotal ?? 0) > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Big Bold Future Pledge</p>
                    <p className="text-green-700 font-semibold mt-0.5" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(c.bbfTotal!)}
                    </p>
                  </div>
                )}

                {/* Child grades — empty until the household lookup ships. */}
                {c.grades && c.grades.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Children</p>
                    <p className="text-sm text-slate-700">
                      {c.grades.map(sidebarGradeLabel).join(', ')}
                    </p>
                  </div>
                )}

                {/* Current-year giving — totalPledge (commitment) +
                    paid (cash received). Mirrors what's already in the
                    row but in a more legible format. */}
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">FY26 Giving</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500 text-xs">Commitment</p>
                      <p className="text-slate-900 font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(totalCommitted)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">Paid</p>
                      <p className="text-slate-900 font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(c.paid)}
                      </p>
                    </div>
                    {c.outstanding > 0 && (
                      <div className="col-span-2">
                        <p className="text-slate-500 text-xs">Outstanding</p>
                        <p className="text-amber-600 font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(c.outstanding)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Giving History — placeholder for Sprint 5. The
                    multi-year per-constituent feed isn't built yet; the
                    copy below sets the expectation without leaving the
                    section blank. */}
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Giving History</p>
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg px-3 py-3 text-sm text-slate-500">
                    Full history coming soon.
                  </div>
                </div>

                {/* DonorAnnotations preserved per spec — sits below the
                    new content. Same constituentName/Id wiring as the
                    inline expansion used previously. */}
                <div className="pt-2 border-t border-slate-100">
                  <DonorAnnotations
                    constituentName={c.donorName}
                    constituentId={c.donorId}
                    tags={tags}
                    onTagsChange={(next) => handleTagsChange(c.donorName, next)}
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
