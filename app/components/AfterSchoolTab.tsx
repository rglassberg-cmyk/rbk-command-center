'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { ShimmerStatCards, ShimmerTableRows } from './ui/Shimmer';

// After School Programs page. Standalone (NOT inside Development). Reads
// /api/after-school (Supabase cache) and can trigger /api/after-school/sync.

// Veracross school_year (fall year) → UI label. Default view is 2026-27.
const YEAR_OPTIONS: { value: number; label: string }[] = [
  { value: 2025, label: '2025–26' },
  { value: 2026, label: '2026–27' },
];

// Compact grade chip labels (Veracross grade_level_id → short label).
const GRADE_LABELS: Record<number, string> = {
  40: 'I/T', 35: '2N', 30: '3N', 25: 'Pre-K', 20: 'K',
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: '11', 12: '12',
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

interface AfterSchoolClass {
  veracross_class_id: number;
  description: string;
  program_group: 'tzaharon' | 'after_school' | 'ms_extracurriculars';
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
  groups: {
    tzaharon: GroupData;
    after_school: GroupData;
    ms_extracurriculars: GroupData;
  };
  last_synced: string | null;
}

const GROUP_META: { key: 'tzaharon' | 'after_school' | 'ms_extracurriculars'; label: string; accent: string }[] = [
  { key: 'tzaharon', label: 'Tzaharon', accent: 'border-t-blue-400' },
  { key: 'after_school', label: 'After School', accent: 'border-t-teal-400' },
  { key: 'ms_extracurriculars', label: 'MS Extra-Curriculars', accent: 'border-t-violet-400' },
];

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

export default function AfterSchoolTab() {
  const [schoolYear, setSchoolYear] = useState(2026);
  const [data, setData] = useState<AfterSchoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<AfterSchoolClass | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">After School Programs</h1>
          <p className="text-sm text-slate-500">Registration overview · {yearLabel}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Year toggle */}
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
          {/* Sync */}
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

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
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

          {/* Per-group tables */}
          {GROUP_META.map((g) => {
            const group = data.groups[g.key];
            const isCollapsed = collapsed[g.key] ?? false;
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
                  </span>
                  <span className="text-xs text-slate-400">{group.classes.length} classes · {group.total_enrolled} enrolled</span>
                </button>
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    {group.classes.length === 0 ? (
                      <p className="text-sm text-slate-400 px-4 py-6 text-center">No classes for {yearLabel}.</p>
                    ) : (
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                            <th className="px-4 py-2 font-medium">Class Name</th>
                            <th className="px-4 py-2 font-medium w-20 text-right">Enrolled</th>
                            <th className="px-4 py-2 font-medium w-20 text-right">Capacity</th>
                            <th className="px-4 py-2 font-medium w-32">Fill</th>
                            <th className="px-4 py-2 font-medium">Grades</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.classes.map((cl) => {
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
                <h2 className="text-lg font-bold text-slate-800">{drilldown.description}</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {drilldown.enrollment_count} enrolled
                  {drilldown.capacity != null ? ` · capacity ${drilldown.capacity}` : ' · capacity not set'}
                </p>
              </div>
              <button onClick={() => setDrilldown(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Grade breakdown */}
              <p className="text-xs uppercase tracking-wide text-slate-400 font-medium mb-2">Grade breakdown</p>
              {Object.keys(drilldown.grade_breakdown).length === 0 ? (
                <p className="text-sm text-slate-400 mb-6">No grade data.</p>
              ) : (
                <div className="space-y-1.5 mb-6">
                  {sortedGradeIds(Object.keys(drilldown.grade_breakdown).map(Number)).map((gid) => {
                    const count = drilldown.grade_breakdown[gid];
                    const max = Math.max(...Object.values(drilldown.grade_breakdown));
                    return (
                      <div key={gid} className="flex items-center gap-2">
                        <span className="w-12 text-xs text-slate-500">{gradeLabel(gid)}</span>
                        <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                          <div className="h-full bg-blue-400" style={{ width: `${max > 0 ? (count / max) * 100 : 0}%` }} />
                        </div>
                        <span className="w-6 text-xs text-slate-600 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Student list */}
              <p className="text-xs uppercase tracking-wide text-slate-400 font-medium mb-2">
                Students ({drilldown.students.length})
              </p>
              <p className="text-[11px] text-slate-400 mb-3">
                Student names require an additional API call — coming soon. Showing Veracross person IDs + grade.
              </p>
              <div className="space-y-1">
                {drilldown.students.length === 0 ? (
                  <p className="text-sm text-slate-400">No students enrolled.</p>
                ) : (
                  drilldown.students
                    .slice()
                    .sort((a, b) => {
                      const ia = a.grade_level_id != null ? GRADE_ORDER.indexOf(a.grade_level_id) : 999;
                      const ib = b.grade_level_id != null ? GRADE_ORDER.indexOf(b.grade_level_id) : 999;
                      return ia - ib;
                    })
                    .map((s, i) => (
                      <div key={`${s.person_id}-${i}`} className="flex items-center justify-between text-sm px-3 py-1.5 rounded bg-slate-50">
                        <span className="text-slate-600">Student #{s.person_id}</span>
                        <span className="text-xs font-medium bg-white border border-slate-200 text-slate-500 rounded px-1.5 py-0.5">
                          {s.grade_level_id != null ? gradeLabel(s.grade_level_id) : '—'}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
