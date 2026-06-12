'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, PieChart, Pie } from 'recharts';
import { ShimmerStatCards, ShimmerTableRows } from '../ui/Shimmer';
import type { DonorTag } from './DonorAnnotations';

// DonorAnnotations does its own data fetching and is interactive — load
// it client-only to match the pattern used by ConstituentTable and
// WeeklyGiftsTab.
const DonorAnnotations = dynamic(() => import('./DonorAnnotations'), { ssr: false });

// Annotations are keyed on a synthetic "Cooper: <category>" name so they
// stay namespaced away from per-donor notes. Slug provides a stable id
// for the constituent_id column.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Warm palette for the disbursement pie chart — all outgoing funds.
// Cycles through the array when there are more categories than colors.
const PIE_PALETTE = [
  '#f87171', '#fb923c', '#fbbf24', '#e879f9', '#a78bfa',
  '#60a5fa', '#34d399', '#f472b6', '#94a3b8', '#f97316',
];

// Event-name consolidation applied to BOTH the Veracross Money In events
// and the Google Sheet disbursement event names before the chart/table
// is built. Two purposes:
//   1. Merge near-duplicates that Veracross/Reconciliation treat as
//      separate but staff treat as one (M Schreck Fund and Israel Gap
//      Year Scholarships are bookkeeping aliases for the same fund —
//      including the literal Veracross spelling "M Schreck Fund/ Israel
//      Gap Year Scholarship" which has no space before the slash).
//   2. Fold tiny no-event-tag buckets (General / Undesignated, Cooper
//      Yahrzeit) into the Cooper 25-26 general bucket so they show up
//      in the General Fund summary card instead of cluttering the
//      chart with sub-1% slices.
// Keys are lowercase, trimmed. Values are the canonical display name.
// `EVENTS_TO_REMOVE` are events that are misclassified upstream (Israel
// Fund items wrongly tagged Cooper, etc.) — they're dropped entirely
// rather than remapped.
const EVENT_NAME_MAP: Record<string, string> = {
  'israel gap year scholarships':
    'M Schreck Fund / Israel Gap Year Scholarship',
  'm schreck b ball tournament':
    'M Schreck Fund / Israel Gap Year Scholarship',
  'schreck fund israel gap year scholarships':
    'M Schreck Fund / Israel Gap Year Scholarship',
  // Veracross literal as it appears in gifts_cache (no space before slash) —
  // beyond the spec, but required so the $46k of real Schreck money
  // consolidates with the $50 B Ball variant under the canonical name.
  'm schreck fund/ israel gap year scholarship':
    'M Schreck Fund / Israel Gap Year Scholarship',
  'general / undesignated': 'Cooper 25-26',
  'cooper yahrzeit': 'Cooper 25-26',
};

const EVENTS_TO_REMOVE = [
  'education sayeret matkal soldier',
];

function normalizeEventName(name: string): string | null {
  const lower = name.toLowerCase().trim();
  if (EVENTS_TO_REMOVE.includes(lower)) return null;
  return EVENT_NAME_MAP[lower] ?? name;
}

// Custom outside-the-ring label for the disbursement pie. Hides labels
// for slices below 3% (they'd otherwise overlap each other on small
// categories); those still appear in the legend below the chart. The
// label sits 28px outside the slice's outer edge with a leader line
// (labelLine={true} on the Pie itself), anchored left/right depending
// on which side of the center the slice falls on.
function renderPieLabel(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  name?: string;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, percent = 0, name = '' } = props;
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 32;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={13}
      fill="#374151"
    >
      {`${name} ${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

interface Category {
  name: string;
  amount: number;
}

interface MoneyInEvent {
  event: string;
  total: number;
  giftCount: number;
}

interface CooperData {
  categories: Category[];
  donated_ytd: number;
  current_balance: number;
  as_of_date: string;
  fiscal_year: string;
  updated_by: string | null;
  moneyIn: MoneyInEvent[];
  // Computed FY label for the Money In date range (e.g. "FY26"). Optional
  // so the type stays compatible with any stale client cache that
  // pre-dates the API change.
  moneyInFyLabel?: string;
  // Live Column G (Veracross event) disbursement totals pulled from the
  // Cooper Reconciliation Google Sheet by the route handler. Optional
  // for the same backwards-compat reason — falls back to [] if missing.
  disbursementsByEvent?: { name: string; amount: number }[];
}

export default function CooperFundTab() {
  const [data, setData] = useState<CooperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Click-to-expand category row → renders DonorAnnotations below it.
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  // Workspace-wide tag bulk fetch — same pattern as GuardianCirclePage.
  // The map is keyed on the full prefixed constituent_name
  // ("Cooper: <category>"), so unrelated donor tags pulled in by the same
  // bulk fetch are simply ignored at lookup time.
  const [tagsByCategory, setTagsByCategory] = useState<Map<string, DonorTag[]>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/development/cooper-fund');
        if (!res.ok) throw new Error('Failed to load');
        setData(await res.json());
      } catch {
        setError('Failed to load Cooper Fund data');
      }
      setLoading(false);
    })();
  }, []);

  // Bulk-load tags on mount. Same shape as Guardian Circle's fetch.
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
        setTagsByCategory(map);
      })
      .catch(() => { /* silent — tags will just be empty */ });
    return () => { cancelled = true; };
  }, []);

  const handleTagsChange = useCallback((constituentName: string, next: DonorTag[]) => {
    setTagsByCategory(prev => {
      const m = new Map(prev);
      if (next.length === 0) m.delete(constituentName);
      else m.set(constituentName, next);
      return m;
    });
  }, []);

  if (loading) {
    return (
      <div>
        <ShimmerStatCards count={3} />
        <ShimmerTableRows rows={10} cols={4} />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-red-500 text-sm py-8 text-center">{error || 'No data available'}</p>;
  }

  const sortedCategories = [...data.categories].sort((a, b) => b.amount - a.amount);
  const totalDisbursed = sortedCategories.reduce((s, c) => s + c.amount, 0);
  const moneyIn = (data.moneyIn || []).filter(m => m.total > 0);

  // Chart 1 + table data: pair Veracross event totals (raised) with
  // the live Column G FY26 disbursement totals (disbursed) read by
  // the route handler from the Cooper Reconciliation Google Sheet.
  // Match is case-insensitive on the event name. Both sides are
  // event-level (Column G granularity), so legitimate matches exist —
  // unlike the previous Column H disbursement source where almost
  // nothing matched. The Column H `categories` from the API still
  // drives the pie chart below (unchanged).
  const disbursementsByEvent = data.disbursementsByEvent || [];
  const displayByKey = new Map<string, string>();
  const raisedByKey = new Map<string, number>();
  const disbursedByKey = new Map<string, number>();
  for (const m of moneyIn) {
    const normalized = normalizeEventName(m.event);
    if (normalized === null) continue;
    const key = normalized.toLowerCase().trim();
    if (!displayByKey.has(key)) displayByKey.set(key, normalized);
    raisedByKey.set(key, (raisedByKey.get(key) || 0) + m.total);
  }
  for (const d of disbursementsByEvent) {
    const normalized = normalizeEventName(d.name);
    if (normalized === null) continue;
    const key = normalized.toLowerCase().trim();
    if (!displayByKey.has(key)) displayByKey.set(key, normalized);
    disbursedByKey.set(key, (disbursedByKey.get(key) || 0) + d.amount);
  }

  // Union of all event names that have at least one of raised or
  // disbursed > 0. The table consumes this whole set; the chart drops
  // the Cooper 25-26 general-fund row because its volume dwarfs every
  // other event and flattens the rest visually.
  const allRows = [...displayByKey.entries()]
    .map(([key, name]) => ({
      name,
      raised: raisedByKey.get(key) || 0,
      disbursed: disbursedByKey.get(key) || 0,
    }))
    .filter(r => r.raised > 0 || r.disbursed > 0);

  const cooperGeneralRow = allRows.find(r => r.name.toLowerCase() === 'cooper 25-26') || null;
  const cooperGeneralTotal = cooperGeneralRow ? cooperGeneralRow.raised + cooperGeneralRow.disbursed : 0;
  const cooperGeneralRaisedPct = cooperGeneralRow && cooperGeneralTotal > 0
    ? (cooperGeneralRow.raised / cooperGeneralTotal) * 100
    : 0;
  const cooperGeneralDisbursedPct = cooperGeneralRow && cooperGeneralTotal > 0
    ? (cooperGeneralRow.disbursed / cooperGeneralTotal) * 100
    : 0;

  // Chart 1 — everything except Cooper 25-26. Sorted by combined total
  // descending so the most material rows float to the top.
  const groupedChartData = allRows
    .filter(r => r.name.toLowerCase() !== 'cooper 25-26')
    .sort((a, b) => (b.raised + b.disbursed) - (a.raised + a.disbursed));

  // Pie chart data — the Column H disbursement categories only.
  // Unchanged by spec.
  const pieData = sortedCategories.map((c, i) => ({
    name: c.name,
    amount: c.amount,
    fill: PIE_PALETTE[i % PIE_PALETTE.length],
  }));

  // Table rows — full dataset including Cooper 25-26 (spec: keep it in
  // the table as context; only the chart excludes it).
  const tableRows = allRows
    .map(r => ({
      name: r.name,
      raised: r.raised,
      disbursed: r.disbursed,
      remaining: r.raised - r.disbursed,
    }))
    .sort((a, b) => b.disbursed - a.disbursed);

  const totalRaisedTable = tableRows.reduce((s, r) => s + r.raised, 0);
  const totalDisbursedTable = tableRows.reduce((s, r) => s + r.disbursed, 0);
  const totalRemaining = totalRaisedTable - totalDisbursedTable;

  return (
    <div>
      {/* Metric cards — spec: FY Donated stays green, Total Disbursed turns red, Current Balance stays green */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Current Balance</p>
          <p className="text-2xl font-bold text-green-600">{formatMoney(data.current_balance)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{data.fiscal_year} Donated</p>
          <p className="text-2xl font-bold text-green-600">{formatMoney(data.donated_ytd)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total Disbursed</p>
          <p className="text-2xl font-bold text-red-600">{formatMoney(totalDisbursed)}</p>
        </div>
      </div>

      {/* Chart 1 — Raised vs. Disbursed grouped bar, with a compact
          General Fund summary card to the left for "Cooper 25-26"
          (split out because its volume dwarfs every other event and
          would flatten the rest of the chart). */}
      <div className="flex flex-col md:flex-row items-stretch md:items-start gap-4 mb-6">
      {cooperGeneralRow && (
        <div className="w-full md:w-48 shrink-0 rounded-lg bg-slate-50 border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700">Cooper 25-26</p>
          <p className="text-xs text-slate-400 mb-3">General / Undesignated</p>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="inline-flex items-center text-slate-600">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5" />
              Raised
            </span>
            <span className="text-green-600 font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(cooperGeneralRow.raised)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="inline-flex items-center text-slate-600">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" />
              Disbursed
            </span>
            <span className="text-red-600 font-medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(cooperGeneralRow.disbursed)}
            </span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-200">
            <div className="bg-green-500" style={{ width: `${cooperGeneralRaisedPct}%` }} />
            <div className="bg-red-500" style={{ width: `${cooperGeneralDisbursedPct}%` }} />
          </div>
        </div>
      )}
      <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700">Raised vs. Disbursed{data.moneyInFyLabel ? ` · ${data.moneyInFyLabel}` : ''}</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">Money raised per event (Veracross) alongside disbursements by category</p>
        {/* Custom legend row above the chart — Recharts' default
            legend can move on resize. */}
        <div className="flex items-center gap-4 mb-3 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#4ade80' }} /> Raised</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#f87171' }} /> Disbursed</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[500px]">
            {/* Vertical (column) layout — category names along the bottom
                rotated -35° so long ones fit without overlap. XAxis
                needs explicit height to reserve room for the rotated
                labels; chart container is fixed at 400px tall. */}
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={groupedChartData} margin={{ left: 10, right: 30, top: 10, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 11 }}
                  angle={-35}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis type="number" tickFormatter={(v: number) => formatMoney(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name) => [formatMoney(Number(value)), name === 'raised' ? 'Raised' : 'Disbursed']} labelStyle={{ fontWeight: 600 }} />
                <Bar dataKey="raised" fill="#4ade80" radius={[4, 4, 0, 0]} barSize={16} />
                <Bar dataKey="disbursed" fill="#f87171" radius={[4, 4, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      </div>

      {/* Chart 2 — Disbursements pie chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-slate-700">Disbursements by Reporting Category</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-3">How disbursed funds are allocated · FY26</p>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="amount"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={renderPieLabel}
                labelLine={true}
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => {
                  const num = Number(value);
                  const pct = totalDisbursed > 0 ? ((num / totalDisbursed) * 100).toFixed(1) : '0';
                  return [`${formatMoney(num)} (${pct}%)`, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Updated 4-column table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-3">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Category</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Raised</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Disbursed</th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(row => {
              const constituentName = `Cooper: ${row.name}`;
              const constituentId = `cooper-${slug(row.name)}`;
              const isExpanded = expandedCategory === row.name;
              const remainingColor = row.remaining > 0
                ? 'text-green-600'
                : row.remaining < 0
                  ? 'text-red-600'
                  : 'text-slate-400';
              return (
                <Fragment key={row.name}>
                  <tr
                    className={`border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                    onClick={() => setExpandedCategory(prev => prev === row.name ? null : row.name)}
                  >
                    <td className="px-5 py-3 font-medium text-slate-800">{row.name}</td>
                    <td className="px-5 py-3 text-right text-green-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {row.raised > 0 ? formatMoney(row.raised) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-red-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {row.disbursed > 0 ? formatMoney(row.disbursed) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-5 py-3 text-right font-medium ${remainingColor}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {row.remaining !== 0 ? formatMoney(row.remaining) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={4} className="px-5 py-4">
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-600">{constituentName}</p>
                          <button
                            onClick={() => setExpandedCategory(null)}
                            className="text-slate-400 hover:text-slate-600 text-xs font-medium"
                          >
                            Close ×
                          </button>
                        </div>
                        <DonorAnnotations
                          constituentName={constituentName}
                          constituentId={constituentId}
                          tags={tagsByCategory.get(constituentName) ?? []}
                          onTagsChange={(next) => handleTagsChange(constituentName, next)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr className="bg-slate-50 font-semibold">
              <td className="px-5 py-3 text-slate-800">Total</td>
              <td className="px-5 py-3 text-right text-green-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(totalRaisedTable)}</td>
              <td className="px-5 py-3 text-right text-red-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(totalDisbursedTable)}</td>
              <td className={`px-5 py-3 text-right ${totalRemaining > 0 ? 'text-green-700' : totalRemaining < 0 ? 'text-red-700' : 'text-slate-500'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(totalRemaining)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400 mt-3 mb-4">
        Disbursement amounts read live from the Cooper Reconciliation spreadsheet (Column G). Raised amounts from Veracross.
      </p>

      {/* Footer — moved below the table per spec */}
      <p className="text-xs text-slate-400 mt-4">
        Data as of {data.as_of_date}{data.updated_by ? ` · Updated by ${data.updated_by}` : ''}
      </p>
    </div>
  );
}
