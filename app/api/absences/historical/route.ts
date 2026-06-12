import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import {
  HS_GRADING_PERIODS,
  ACADEMY_GRADE_NUMBERS,
} from '@/lib/divisions';

// GET /api/absences/historical?date=YYYY-MM-DD
//
// Past-day attendance read straight from `attendance_cache`. Mirrors
// the shape of the live `/api/absences` response so the Dashboard's
// existing absences renderer (chart, grade cards, etc.) works without
// any branching. The live route still owns "today" — this endpoint is
// only invoked when the user has navigated to a prior school day.
//
// Filters:
//   - workspace_id matches the caller
//   - attendance_date = the supplied date
//   - Academy-only (HS grading periods + HS grade ids dropped)
//   - present students removed (attendance_category = 0 AND
//     student_attendance_status = 0)

const STATUS_LABELS: Record<number, string> = {
  0: 'Present',
  8: 'Tardy - Unexcused',
  9: 'Tardy - Excused',
  29: 'Absent - Unexcused',
  30: 'Absent - Excused',
  32: 'Not Expected',
  33: 'Leave of Absence',
  50: 'Early Dismissal',
  72: 'Remote',
  75: 'Absent - Unexcused (Unresolved)',
  77: 'Absent - Excused - No RPT',
  78: 'Sick',
  79: 'In School Excused',
};

const HS_GRADING_PERIOD_SET = new Set<number>(HS_GRADING_PERIODS);

interface AttendanceRow {
  person_id: number;
  name: string | null;
  grade_level: string | null;
  grade_level_id: number | null;
  attendance_date: string;
  attendance_category: number;
  student_attendance_status: number;
  excused: boolean | null;
  grading_period: number | null;
  late_arrival_time: string | null;
  early_dismissal_time: string | null;
  notes: string | null;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.modules?.absences === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }

  const date = new URL(request.url).searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  const allowedGrades = ACADEMY_GRADE_NUMBERS;
  const allowedGradeSet = new Set(allowedGrades);

  // Pull all attendance rows for the day. Cache is small per-day
  // (~1700 records) so a single SELECT is fine; if this grows we'll
  // paginate the same way the live route does.
  let allRows: AttendanceRow[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('attendance_cache')
      .select('person_id, name, grade_level, grade_level_id, attendance_date, attendance_category, student_attendance_status, excused, grading_period, late_arrival_time, early_dismissal_time, notes')
      .eq('workspace_id', session.workspaceId)
      .eq('attendance_date', date)
      .range(0, 4999);
    if (error) {
      console.error('[absences/historical] cache query failed:', error);
      return NextResponse.json({ error: 'Cache query failed' }, { status: 500 });
    }
    allRows = (data ?? []) as AttendanceRow[];
  } catch (err) {
    console.error('[absences/historical] exception:', err);
    return NextResponse.json({ error: 'Cache query exception' }, { status: 500 });
  }

  // Filter: drop HS, drop present students, drop unknown-grade rows.
  const filtered = allRows.filter(r => {
    if (r.attendance_category === 0 && r.student_attendance_status === 0) return false;
    if (r.grading_period != null && HS_GRADING_PERIOD_SET.has(r.grading_period)) return false;
    if (r.grade_level_id != null && !allowedGradeSet.has(r.grade_level_id)) return false;
    return true;
  });

  const mapped = filtered.map(r => ({
    person_id: r.person_id,
    name: r.name ?? '',
    status_code: r.student_attendance_status,
    status_label: STATUS_LABELS[r.student_attendance_status] || `Unknown (${r.student_attendance_status})`,
    excused: Boolean(r.excused),
    attendance_category: r.attendance_category,
    notes: r.notes ?? null,
    late_arrival_time: r.late_arrival_time ?? null,
    early_dismissal_time: r.early_dismissal_time ?? null,
    grade_level: r.grade_level ?? null,
    grade_level_id: r.grade_level_id ?? null,
    ytd_absences: 0,
    consecutive_absences: 0,
  }));

  const absences = mapped.filter(r => r.attendance_category === 1);
  const tardies = mapped.filter(r => r.attendance_category === 2);
  const earlyDismissals = mapped.filter(r => r.attendance_category === 3);
  const notExpected: typeof mapped = [];

  absences.sort((a, b) => {
    if (a.excused === b.excused) return a.name.localeCompare(b.name);
    return a.excused ? 1 : -1;
  });
  tardies.sort((a, b) => a.name.localeCompare(b.name));
  earlyDismissals.sort((a, b) => a.name.localeCompare(b.name));

  // Total students for the donut: snap from the full set of cache rows
  // on this date (every student we have a record for that day, capped
  // to Academy grades). Includes present + absent.
  const totalStudents = allRows.filter(r => {
    if (r.grading_period != null && HS_GRADING_PERIOD_SET.has(r.grading_period)) return false;
    if (r.grade_level_id != null && !allowedGradeSet.has(r.grade_level_id)) return false;
    return true;
  }).length;

  return NextResponse.json({
    date,
    total: absences.length + tardies.length + earlyDismissals.length,
    absences,
    tardies,
    earlyDismissals,
    notExpected,
    totalStudents,
    // Charts that depend on cross-day aggregation aren't filled for
    // historical view — the live route's monthly trend + top absentees
    // are intentionally omitted so the page focuses on the day in
    // view. UI handles the absence of these fields.
  });
}
