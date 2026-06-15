'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, LabelList,
} from 'recharts';
import { apiFetch } from '@/lib/apiFetch';
import { ShimmerStatCards, ShimmerTableRows } from './ui/Shimmer';

// After School Programs page. Standalone (NOT inside Development). Reads
// /api/after-school (Supabase cache) and can trigger /api/after-school/sync.

// Veracross school_year (fall year) → UI label. Default view is 2026-27.
const YEAR_OPTIONS: { value: number; label: string }[] = [
  { value: 2025, label: '2025–26' },
  { value: 2026, label: '2026–27' },
];

// Veracross grade_level_id → display label (per spec mapping).
const GRADE_LABELS: Record<number, string> = {
  40: 'Infant/Toddler', 35: '2YN', 30: '3YN', 25: 'Pre-K', 20: 'K',
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 8: '8th',
  9: '9th', 10: '10th', 11: '11th', 12: '12th',
};
const GRADE_ORDER = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
function gradeLabel(id: number): string {
  return GRADE_LABELS[id] ?? `#${id}`;
}
function sortedGradeIds(ids: number[]): number[] {
  return [...ids].sort((a, b) => {
    const ia = GRADE_ORDER.indexOf(a);
    const ib = GRADE_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

// Veracross Axiom deep links.
const VC_CLASS_URL = (id: number) =>
  `https://axiom.veracross.com/sar/#/detail/class-other-program/${id}/3156-general`;
const VC_STUDENT_URL = (personId: number) =>
  `https://axiom.veracross.com/sar/#/detail/student-ls/${personId}/273-general`;

type ProgramGroupKey = 'tzaharon' | 'after_school' | 'ms_extracurriculars';

interface AfterSchoolClass {
  veracross_class_id: number;
  description: string;
  program_group: ProgramGroupKey;
  enrollment_count: number;
  capacity: number | null;
  grade_breakdown: Record<number, number>;
  begin_date: string | null;
  end_date: string | null;
  course_name: string | null;
  students: { person_id: number; grade_level_id: number | null }[];
}
interface GroupData {
  classes: AfterSchoolClass[];
  total_enrolled: number;
}
interface AfterSchoolData {
  school_year: number;
  groups: Record<ProgramGroupKey, GroupData>;
  last_synced: string | null;
}
interface StudentName {
  first_name: string;
  last_name: string;
  display_name: string;
}

// Section render order: After School, Tzaharon, MS Extra-Curriculars.
// MS is collapsed by default (registration not yet open).
const GROUP_META: {
  key: ProgramGroupKey;
  label: string;
  accent: string;
  defaultCollapsed?: boolean;
  note?: string;
}[] = [
  { key: 'after_school', label: 'After School', accent: 'border-t-teal-400' },
  { key: 'tzaharon', label: 'Tzaharon', accent: 'border-t-blue-400' },
  {
    key: 'ms_extracurriculars',
    label: 'MS Extra-Curriculars',
    accent: 'border-t-violet-400',
    defaultCollapsed: true,
    note: 'Registration opens Fall 2026–27',
  },
];

// Day-of-week derivation (spec order — Friday is checked before Weekend,
// so "Friday/Weekend" buckets as Friday).
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Weekend', 'Other'];
function deriveDay(cl: AfterSchoolClass): string {
  const s = `${cl.description} ${cl.course_name ?? ''}`;
  if (/Monday|Mon\b/i.test(s)) return 'Monday';
  if (/Tuesday|Tue\b/i.test(s)) return 'Tuesday';
  if (/Wednesday|Wed\b/i.test(s)) return 'Wednesday';
  if (/Thursday|Thu\b/i.test(s)) return 'Thursday';
  if (/Friday|Fri\b/i.test(s)) return 'Friday';
  if (/Weekend/i.test(s)) return 'Weekend';
  return 'Other';
}

function enrolledColor(count: number, capacity: number | null): string {
  if (capacity == null || capacity <= 0) return 'text-slate-700';
  const pct = count / capacity;
  if (pct >= 1) return 'text-red-600';
  if (pct >= 0.8) return 'text-amber-600';
  return 'text-green-600';
}
function fillColor(count: number, capacity: number | null): string {
  if (capacity == null || capacity <= 0) return 'bg-slate-300';
  const pct = count / capacity;
  if (pct >= 1) return 'bg-red-500';
  if (pct >= 0.8) return 'bg-amber-500';
  return 'bg-green-500';
}
function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function AfterSchoolTab() {
  const [schoolYear, setSchoolYear] = useState(2026);
  const [data, setData] = useState<AfterSchoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<AfterSchoolClass | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [studentNames, setStudentNames] = useState<Record<number, StudentName>>({});
  const [namesLoading, setNamesLoading] = useState(false);

  const fetchData = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/after-school?school_year=${year}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed to load (${res.status})`);
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(schoolYear);
  }, [schoolYear, fetchData]);

  // Resolve student names when the drilldown opens (only for ids not yet known).
  useEffect(() => {
    if (!drilldown) return;
    const ids = drilldown.students
      .map((s) => s.person_id)
      .filter((id) => !(id in studentNames));
    if (ids.length === 0) return;
    let cancelled = false;
    setNamesLoading(true);
    apiFetch('/api/after-school/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personIds: ids }),
    })
      .then((r) => r.json())
      .then((j: { students?: Record<number, StudentName> }) => {
        if (!cancelled && j.students) setStudentNames((prev) => ({ ...prev, ...j.students }));
      })
      .catch(() => { /* degrade to Student #id */ })
      .finally(() => { if (!cancelled) setNamesLoading(false); });
    return () => { cancelled = true; };
    // studentNames intentionally omitted — we only fetch the missing ids once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drilldown]);

  const runSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await apiFetch('/api/after-school/sync', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.error || `Sync failed (${res.status})`);
      setSyncMsg(`Synced ${j.classes_synced} classes · ${j.enrollments_synced} enrollments`);
      await fetchData(schoolYear);
    } catch (e) {
      setSyncMsg(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 6000);
    }
  };

  const yearLabel = YEAR_OPTIONS.find((y) => y.value === schoolYear)?.label ?? '';
  const searchActive = search.trim().length > 0;
  const q = search.trim().toLowerCase();
  const filterClasses = (classes: AfterSchoolClass[]) =>
    searchActive ? classes.filter((c) => c.description.toLowerCase().includes(q)) : classes;
  const resultsCount = useMemo(() => {
    if (!data || !searchActive) return 0;
    return (Object.keys(data.groups) as ProgramGroupKey[]).reduce(
      (sum, k) => sum + filterClasses(data.groups[k].classes).length,
      0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, searchActive]);

  // After School chart data (full data — charts are an overview, not filtered).
  const afterSchoolClasses = data?.groups.after_school.classes ?? [];
  const chartTop10 = useMemo(
    () =>
      [...afterSchoolClasses]
        .sort((a, b) => b.enrollment_count - a.enrollment_count)
        .slice(0, 10)
        .map((c) => ({ name: trunc(c.description, 30), enrolled: c.enrollment_count })),
    [afterSchoolClasses],
  );
  const chartByDay = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of afterSchoolClasses) {
      const d = deriveDay(c);
      totals.set(d, (totals.get(d) || 0) + c.enrollment_count);
    }
    return DAY_ORDER.filter((d) => (totals.get(d) || 0) > 0).map((d) => ({ day: d, enrolled: totals.get(d) || 0 }));
  }, [afterSchoolClasses]);
  const chartByGrade = useMemo(() => {
    const totals = new Map<number, number>();
    for (const c of afterSchoolClasses) {
      for (const [gid, n] of Object.entries(c.grade_breakdown)) {
        totals.set(Number(gid), (totals.get(Number(gid)) || 0) + n);
      }
    }
    return sortedGradeIds([...totals.keys()])
      .filter((gid) => (totals.get(gid) || 0) > 0)
      .map((gid) => ({ grade: gradeLabel(gid), enrolled: totals.get(gid) || 0 }));
  }, [afterSchoolClasses]);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">After School Programs</h1>
          <p className="text-sm text-slate-500">Registration overview · {yearLabel}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {YEAR_OPTIONS.map((y) => (
              <button
                key={y.value}
                onClick={() => setSchoolYear(y.value)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  schoolYear === y.value ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {y.label}
              </button>
            ))}
          </div>
          <button
            onClick={runSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            title="Pull latest from Veracross"
          >
            <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <span className="text-xs text-slate-400">
            {syncMsg ? syncMsg : data ? `Last synced ${relativeTime(data.last_synced)}` : ''}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search classes..."
            className="w-full md:max-w-md pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          />
          {searchActive && (
            <span className="ml-3 text-xs text-slate-400">
              {resultsCount} result{resultsCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>
      )}

      {loading ? (
        <>
          <ShimmerStatCards count={3} />
          <div className="mt-6 bg-white border border-slate-200 rounded-lg p-4">
            <ShimmerTableRows rows={6} cols={5} />
          </div>
        </>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {GROUP_META.map((g) => {
              const group = data.groups[g.key];
              return (
                <div key={g.key} className={`bg-white border border-slate-200 border-t-4 ${g.accent} rounded-lg p-5`}>
                  <p className="text-sm font-medium text-slate-500">{g.label}</p>
                  <p className="text-3xl font-bold text-slate-800 mt-1">{group.total_enrolled}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {group.total_enrolled === 1 ? 'student' : 'students'} enrolled · {group.classes.length}{' '}
                    {group.classes.length === 1 ? 'class' : 'classes'}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Charts — After School only */}
          {afterSchoolClasses.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
              {/* A — Most Popular Classes */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-slate-700 mb-1">Most Popular Classes</p>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartTop10} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 8 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip formatter={(v) => [`${v} enrolled`, '']} labelStyle={{ fontSize: 12 }} />
                      <Bar dataKey="enrolled" fill="#3b82f6" radius={[0, 3, 3, 0]}>
                        <LabelList dataKey="enrolled" position="right" style={{ fontSize: 11, fill: '#475569' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Classes with high enrollment may need to be split into sections</p>
              </div>

              {/* B — Enrollment by Day */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-slate-700 mb-1">Enrollment by Day</p>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartByDay} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#475569' }} tickFormatter={(d) => d.slice(0, 3)} />
                      <YAxis tick={{ fontSize: 11, fill: '#475569' }} allowDecimals={false} />
                      <Tooltip formatter={(v) => [`${v} enrolled`, '']} labelStyle={{ fontSize: 12 }} />
                      <Bar dataKey="enrolled" fill="#14b8a6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* C — Enrollment by Grade */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-slate-700 mb-1">Enrollment by Grade</p>
                <div style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartByGrade} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="grade" width={90} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip formatter={(v) => [`${v} enrolled`, '']} labelStyle={{ fontSize: 12 }} />
                      <Bar dataKey="enrolled" fill="#a855f7" radius={[0, 3, 3, 0]}>
                        <LabelList dataKey="enrolled" position="right" style={{ fontSize: 11, fill: '#475569' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Per-group tables */}
          {GROUP_META.map((g) => {
            const group = data.groups[g.key];
            const visibleClasses = filterClasses(group.classes);
            const isCollapsed = searchActive ? false : (collapsed[g.key] ?? g.defaultCollapsed ?? false);
            return (
              <div key={g.key} className="mt-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                  className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2 font-semibold text-slate-700">
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    {g.label}
                    {g.note && <span className="text-[11px] font-normal text-slate-400">· {g.note}</span>}
                  </span>
                  <span className="text-xs text-slate-400">
                    {searchActive
                      ? `${visibleClasses.length} match${visibleClasses.length === 1 ? '' : 'es'}`
                      : `${group.classes.length} classes · ${group.total_enrolled} enrolled`}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    {visibleClasses.length === 0 ? (
                      <p className="text-sm text-slate-400 px-4 py-6 text-center">
                        {searchActive ? 'No matching classes.' : `No classes for ${yearLabel}.`}
                      </p>
                    ) : (
                      <table className="w-full min-w-[680px] text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                            <th className="px-4 py-2 font-medium">Class Name</th>
                            <th className="px-4 py-2 font-medium w-20 text-right">Enrolled</th>
                            <th className="px-4 py-2 font-medium w-20 text-right">Capacity</th>
                            <th className="px-4 py-2 font-medium w-32">Fill</th>
                            <th className="px-4 py-2 font-medium">Grades</th>
                            <th className="px-2 py-2 font-medium w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleClasses.map((cl) => {
                            const pct = cl.capacity && cl.capacity > 0 ? Math.min(100, Math.round((cl.enrollment_count / cl.capacity) * 100)) : 0;
                            const gradeIds = sortedGradeIds(Object.keys(cl.grade_breakdown).map(Number));
                            return (
                              <tr
                                key={cl.veracross_class_id}
                                onClick={() => setDrilldown(cl)}
                                className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                              >
                                <td className="px-4 py-2.5 text-slate-700 font-medium">{cl.description}</td>
                                <td className={`px-4 py-2.5 text-right font-semibold ${enrolledColor(cl.enrollment_count, cl.capacity)}`}>
                                  {cl.enrollment_count}
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-500">{cl.capacity ?? '—'}</td>
                                <td className="px-4 py-2.5">
                                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div className={`h-full ${fillColor(cl.enrollment_count, cl.capacity)}`} style={{ width: `${pct}%` }} />
                                  </div>
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {gradeIds.length === 0 ? (
                                      <span className="text-slate-300">—</span>
                                    ) : (
                                      gradeIds.map((gid) => (
                                        <span key={gid} className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                                          {gradeLabel(gid)}
                                          <span className="text-slate-400">·{cl.grade_breakdown[gid]}</span>
                                        </span>
                                      ))
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-2.5 text-right">
                                  <a
                                    href={VC_CLASS_URL(cl.veracross_class_id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex text-slate-400 hover:text-slate-600"
                                    title="Open in Veracross"
                                  >
                                    <ExternalLink size={14} />
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      ) : null}

      {/* Drilldown panel */}
      {drilldown && (
        <>
          <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setDrilldown(null)} />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
            <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  {drilldown.description}
                  <a
                    href={VC_CLASS_URL(drilldown.veracross_class_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-slate-600"
                    title="Open class in Veracross"
                  >
                    <ExternalLink size={15} />
                  </a>
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {drilldown.enrollment_count} enrolled
                  {drilldown.capacity != null ? ` · capacity ${drilldown.capacity}` : ' · capacity not set'}
                </p>
              </div>
              <button onClick={() => setDrilldown(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Student list */}
              <p className="text-xs uppercase tracking-wide text-slate-400 font-medium mb-2 flex items-center gap-2">
                Students ({drilldown.students.length})
                {namesLoading && <span className="text-[11px] normal-case text-slate-400">· loading names…</span>}
              </p>
              <div className="space-y-1 mb-6">
                {drilldown.students.length === 0 ? (
                  <p className="text-sm text-slate-400">No students enrolled.</p>
                ) : (
                  drilldown.students
                    .slice()
                    .sort((a, b) => {
                      const ia = a.grade_level_id != null ? GRADE_ORDER.indexOf(a.grade_level_id) : 999;
                      const ib = b.grade_level_id != null ? GRADE_ORDER.indexOf(b.grade_level_id) : 999;
                      if (ia !== ib) return ia - ib;
                      const na = studentNames[a.person_id]?.display_name ?? '';
                      const nb = studentNames[b.person_id]?.display_name ?? '';
                      return na.localeCompare(nb);
                    })
                    .map((s, i) => {
                      const name = studentNames[s.person_id]?.display_name;
                      return (
                        <a
                          key={`${s.person_id}-${i}`}
                          href={VC_STUDENT_URL(s.person_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between text-sm px-3 py-1.5 rounded bg-slate-50 hover:bg-slate-100 group"
                        >
                          <span className="text-slate-700 group-hover:text-blue-600 inline-flex items-center gap-1">
                            {name || `Student #${s.person_id}`}
                            <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 text-slate-400" />
                          </span>
                          <span className="text-xs font-medium bg-white border border-slate-200 text-slate-500 rounded px-1.5 py-0.5">
                            {s.grade_level_id != null ? gradeLabel(s.grade_level_id) : '—'}
                          </span>
                        </a>
                      );
                    })
                )}
              </div>

              {/* Grade breakdown chart */}
              {Object.keys(drilldown.grade_breakdown).length > 0 && (
                <>
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-medium mb-2">Grade breakdown</p>
                  <div style={{ height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={sortedGradeIds(Object.keys(drilldown.grade_breakdown).map(Number)).map((gid) => ({
                          grade: gradeLabel(gid),
                          count: drilldown.grade_breakdown[gid],
                        }))}
                        layout="vertical"
                        margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                      >
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis type="category" dataKey="grade" width={80} tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip formatter={(v) => [`${v}`, 'students']} labelStyle={{ fontSize: 12 }} />
                        <Bar dataKey="count" fill="#60a5fa" radius={[0, 3, 3, 0]}>
                          <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#475569' }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
