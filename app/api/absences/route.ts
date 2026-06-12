import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import {
  HS_GRADING_PERIODS,
  ACADEMY_GRADE_NUMBERS,
} from '@/lib/divisions';
import { getVeracrossCredentials } from '@/lib/getIntegration';

// Veracross v3 student_attendance_status codes
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

// Veracross grade_level ID → display label
const GRADE_LABELS: Record<number, string> = {
  40: 'Infant/Toddler',
  35: '2 Year Nursery',
  30: '3 Year Nursery',
  25: '4 Year Nursery',
  20: 'Kindergarten',
  1: '1st Grade',
  2: '2nd Grade',
  3: '3rd Grade',
  4: '4th Grade',
  5: '5th Grade',
  6: '6th Grade',
  7: '7th Grade',
  8: '8th Grade',
  9: '9th Grade',
  10: '10th Grade',
  11: '11th Grade',
  12: '12th Grade',
};

// Display order — matches PROJECTION_GRADE_ORDER on the client side. Used
// to sort the tier breakdown so charts render Pre-K → 12th in human order
// rather than by grade-id number.
const GRADE_DISPLAY_ORDER = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Set of HS grading_period codes (current and prior school year) —
// used by the live-attendance filter below. Live records don't carry a
// grade_level natively, so we discriminate Academy vs HS via the
// grading_period field on each record.
const HS_GRADING_PERIOD_SET = new Set<number>(HS_GRADING_PERIODS);

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface VCAttendanceRecord {
  id: number;
  attendance_date: string;
  person_id: number;
  person: string; // "Last, First" format
  attendance_category: number; // 0=present, 1=absent, 2=tardy, 3=early dismissal
  student_attendance_status: number; // detailed status code
  excused: boolean;
  late_arrival_time: string | null; // ISO datetime e.g. "1900-01-01T09:15:00Z"
  early_dismissal_time: string | null;
  grading_period: number; // 19=lower/middle, 29=HS
  notes: string | null;
}

interface VCStudent {
  id: number;
  grade_level: number;
}

async function getVeracrossToken(workspaceId: string): Promise<string> {
  const { clientId, clientSecret, schoolCode } = await getVeracrossCredentials(workspaceId);

  if (!clientId || !clientSecret) {
    throw new Error('Missing Veracross credentials');
  }

  const res = await fetch(`https://accounts.veracross.com/${schoolCode}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'master_attendance:list students:list',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Veracross token error:', res.status, err);
    throw new Error('Failed to get Veracross token');
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

function formatPersonName(person: string): string {
  // Veracross returns "Last, First" — convert to "First Last"
  const parts = person.split(', ');
  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }
  return person;
}

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Determine which school year a date falls into. School year runs
// Sep 1 → Jun 30. For a date in Jul/Aug, we treat it as belonging to
// the school year that just ended (returning the prior Sep). For
// Sep–Jun, the start year is the current calendar year if month >= 9,
// else previous.
function schoolYearStartIso(today: Date): string {
  const month = today.getUTCMonth() + 1; // 1-12
  const year = today.getUTCFullYear();
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-09-01`;
}

// Returns the quarter label (Q1..Q4) for an ISO date string, or null
// if the date falls outside the school year. Boundaries match the
// product spec exactly.
function quarterForDate(dateIso: string, schoolYearStartYear: number): string | null {
  // dateIso is YYYY-MM-DD; compare as ISO strings (lexicographic ===
  // chronological for that format).
  const Q1 = [`${schoolYearStartYear}-09-01`, `${schoolYearStartYear}-11-15`];
  const Q2 = [`${schoolYearStartYear}-11-16`, `${schoolYearStartYear + 1}-01-31`];
  const Q3 = [`${schoolYearStartYear + 1}-02-01`, `${schoolYearStartYear + 1}-04-15`];
  const Q4 = [`${schoolYearStartYear + 1}-04-16`, `${schoolYearStartYear + 1}-06-30`];
  if (dateIso >= Q1[0] && dateIso <= Q1[1]) return 'Q1';
  if (dateIso >= Q2[0] && dateIso <= Q2[1]) return 'Q2';
  if (dateIso >= Q3[0] && dateIso <= Q3[1]) return 'Q3';
  if (dateIso >= Q4[0] && dateIso <= Q4[1]) return 'Q4';
  return null;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.modules?.absences === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }

  // The Student Absences page is Academy-only by product decision —
  // HS attendance lives in a different system and shouldn't surface
  // here even for multi-division users like Becca. We hardcode the
  // Academy grade list and ignore the caller's divisions for scoping.
  // (Module access is still gated above via session.modules.absences.)
  const allowedGrades = ACADEMY_GRADE_NUMBERS;

  // ?view=ytd branch — separate, lazy-loaded aggregation feeding the
  // "Attendance Distribution — Year to Date" section of the Absences
  // page. Skips the today-attendance Veracross calls entirely so this
  // path is cheap to refetch. The default GET (no `view` param) is
  // unchanged.
  const viewParam = new URL(request.url).searchParams.get('view');
  if (viewParam === 'ytd') {
    return getYtdView({ allowedGrades });
  }

  try {
    const token = await getVeracrossToken(session.workspaceId);
    const today = getTodayET();
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);

    // Start students fetch while we paginate attendance
    const studentsPage1Res = await fetch(
      `https://api.veracross.com/${schoolRoute}/v3/students`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-Page-Size': '1000',
          'X-Page-Number': '1',
        },
      }
    );

    // Fetch all attendance pages (API caps at 1000 per page, school has ~1731 students)
    let allAttendance: VCAttendanceRecord[] = [];
    let attendancePage = 1;
    while (true) {
      const attendanceRes = await fetch(
        `https://api.veracross.com/${schoolRoute}/v3/master_attendance?attendance_date=${today}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'X-Page-Number': String(attendancePage),
            'X-Page-Size': '1000',
          },
        }
      );
      if (!attendanceRes.ok) {
        const err = await attendanceRes.text();
        console.error('Veracross attendance error:', attendanceRes.status, err);
        throw new Error(`Veracross API error: ${attendanceRes.status}`);
      }
      const attendanceData = await attendanceRes.json();
      const records: VCAttendanceRecord[] = attendanceData.data || [];
      allAttendance = [...allAttendance, ...records];

      // Stop if we got fewer than 1000 (last page)
      if (records.length < 1000) break;
      attendancePage++;
    }

    // Build grade lookup from students — paginate through all pages
    const gradeMap = new Map<number, number>();
    if (studentsPage1Res.ok) {
      const page1Json = await studentsPage1Res.json();
      const page1: VCStudent[] = page1Json.data || [];
      page1.forEach(s => gradeMap.set(s.id, s.grade_level));

      // Fetch remaining pages if first page was full (1000 records = likely more pages)
      if (page1.length >= 1000) {
        let pageNum = 2;
        while (pageNum <= 10) { // safety cap
          const pageRes = await fetch(
            `https://api.veracross.com/${schoolRoute}/v3/students`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'X-Page-Size': '1000',
                'X-Page-Number': String(pageNum),
              },
            }
          );
          if (!pageRes.ok) break;
          const pageJson = await pageRes.json();
          const pageData: VCStudent[] = pageJson.data || [];
          if (pageData.length === 0) break;
          pageData.forEach(s => gradeMap.set(s.id, s.grade_level));
          if (pageData.length < 1000) break; // last page
          pageNum++;
        }
      }
    } else {
      console.error('Veracross students fetch failed:', studentsPage1Res.status);
    }

    // Filter: not present (category > 0 OR non-zero status like
    // "Not Expected") AND Academy-only (drop HS records — Student
    // Absences page is Academy-scoped, see comment at the top of the
    // handler). HS records carry grading_period ∈ HS_GRADING_PERIODS.
    const filtered = allAttendance.filter(r => {
      if (r.attendance_category === 0 && r.student_attendance_status === 0) return false;
      if (HS_GRADING_PERIOD_SET.has(r.grading_period)) return false;
      return true;
    });

    // Map to clean shape
    const mapped = filtered.map(r => ({
      person_id: r.person_id,
      name: formatPersonName(r.person),
      status_code: r.student_attendance_status,
      status_label: STATUS_LABELS[r.student_attendance_status] || `Unknown (${r.student_attendance_status})`,
      excused: r.excused,
      attendance_category: r.attendance_category,
      notes: r.notes || null,
      late_arrival_time: r.late_arrival_time || null,
      early_dismissal_time: r.early_dismissal_time || null,
      grade_level_id: gradeMap.get(r.person_id) ?? null,
      grade_level: GRADE_LABELS[gradeMap.get(r.person_id) ?? -1] ?? null,
    }));

    // Split by Veracross attendance_category (the canonical bucket):
    //   1 = absent  (includes status 29/30 Absent Excused/Unexcused,
    //                32 Not Expected, 33 Leave of Absence, 71/72/77/78 etc.)
    //   2 = tardy   (status 8 unexcused / 9 excused)
    //   3 = early dismissal (status 50)
    // Previously we filtered by specific status codes and broke out
    // Not Expected as a separate bucket — that missed several other
    // absent statuses (33 LOA, 71/72/77/78) and double-counted some
    // edge cases. Tardies stay separate by design.
    const absences = mapped.filter(r => r.attendance_category === 1);
    const tardies = mapped.filter(r => r.attendance_category === 2);
    const earlyDismissals = mapped.filter(r => r.attendance_category === 3);
    // Kept for response back-compat. The client merges absences +
    // notExpected for display; folding into absences server-side
    // means this is always empty going forward — UI still works.
    const notExpectedRecords: typeof mapped = [];

    // Sort absences: unexcused first, then alphabetical
    absences.sort((a, b) => {
      if (a.excused === b.excused) return a.name.localeCompare(b.name);
      return a.excused ? 1 : -1;
    });
    tardies.sort((a, b) => a.name.localeCompare(b.name));
    earlyDismissals.sort((a, b) => a.name.localeCompare(b.name));
    notExpectedRecords.sort((a, b) => a.name.localeCompare(b.name));

    // Query attendance_cache for YTD + consecutive absence stats
    let ytdCounts = new Map<number, number>();
    let consecutiveCounts = new Map<number, number>();
    const absentPersonIds = absences.map(r => r.person_id);

    if (absentPersonIds.length > 0) {
      try {
        // YTD absences: count records where attendance_category = 1
        // (absent), scoped to the member's allowed grades.
        const { data: ytdData } = await supabaseAdmin
          .from('attendance_cache')
          .select('person_id')
          .in('person_id', absentPersonIds)
          .eq('attendance_category', 1)
          .in('grade_level_id', allowedGrades);

        (ytdData || []).forEach((r: { person_id: number }) => {
          ytdCounts.set(r.person_id, (ytdCounts.get(r.person_id) || 0) + 1);
        });

        // Consecutive absences: get all school days and each student's absence dates
        const { data: schoolDaysData } = await supabaseAdmin
          .from('attendance_cache')
          .select('attendance_date')
          .order('attendance_date', { ascending: false });

        const schoolDays = [...new Set((schoolDaysData || []).map((r: { attendance_date: string }) => r.attendance_date))];

        const { data: absenceRecords } = await supabaseAdmin
          .from('attendance_cache')
          .select('person_id, attendance_date')
          .in('person_id', absentPersonIds)
          .eq('attendance_category', 1)
          .in('grade_level_id', allowedGrades)
          .order('attendance_date', { ascending: false });

        const personAbsenceDates = new Map<number, Set<string>>();
        (absenceRecords || []).forEach((r: { person_id: number; attendance_date: string }) => {
          if (!personAbsenceDates.has(r.person_id)) personAbsenceDates.set(r.person_id, new Set());
          personAbsenceDates.get(r.person_id)!.add(r.attendance_date);
        });

        absentPersonIds.forEach(pid => {
          const dates = personAbsenceDates.get(pid);
          if (!dates) { consecutiveCounts.set(pid, 0); return; }
          let streak = 0;
          for (const day of schoolDays) {
            if (dates.has(day)) streak++;
            else break;
          }
          consecutiveCounts.set(pid, streak);
        });
      } catch (e) {
        console.error('Cache query error (non-fatal):', e);
      }
    }

    // Merge stats into absence records
    const absencesWithStats = absences.map(r => ({
      ...r,
      ytd_absences: ytdCounts.get(r.person_id) || 0,
      consecutive_absences: consecutiveCounts.get(r.person_id) || 0,
    }));
    const tardiesWithStats = tardies.map(r => ({ ...r, ytd_absences: 0, consecutive_absences: 0 }));
    const earlyDismissalsWithStats = earlyDismissals.map(r => ({ ...r, ytd_absences: 0, consecutive_absences: 0 }));
    const notExpectedWithStats = notExpectedRecords.map(r => ({ ...r, ytd_absences: 0, consecutive_absences: 0 }));

    // Chart data queries (non-fatal — wrapped in try/catch)
    // Total enrolled students: count entries in gradeMap whose grade is
    // visible to this member (driven by their divisions).
    const allowedGradeSet = new Set(allowedGrades);
    const totalStudents = [...gradeMap.values()].filter(g => allowedGradeSet.has(g)).length;

    let monthlyTrend: Array<{ date: string; count: number }> = [];
    let topAbsentees: Array<{ person_id: number; name: string; ytd_absences: number; grade_level_id: number | null }> = [];

    try {
      // Monthly trend: absences per day this month (paginated to bypass 1000-row limit)
      const monthStart = today.substring(0, 7) + '-01'; // YYYY-MM-01
      const trendRows: { attendance_date: string }[] = [];
      let trendFrom = 0;
      while (true) {
        const q = supabaseAdmin
          .from('attendance_cache')
          .select('attendance_date')
          .eq('attendance_category', 1)
          .gte('attendance_date', monthStart)
          .lte('attendance_date', today)
          .in('grade_level_id', allowedGrades);
        const { data } = await q.range(trendFrom, trendFrom + 999);
        if (!data || data.length === 0) break;
        trendRows.push(...data);
        if (data.length < 1000) break;
        trendFrom += 1000;
      }

      if (trendRows.length > 0) {
        const dayCount = new Map<string, number>();
        trendRows.forEach(r => {
          dayCount.set(r.attendance_date, (dayCount.get(r.attendance_date) || 0) + 1);
        });
        monthlyTrend = [...dayCount.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count }));
      }
    } catch {
      // Non-fatal
    }

    try {
      // Top 10 most absent students YTD (paginated to bypass 1000-row limit)
      const topRows: { person_id: number; name: string; grade_level_id: number | null }[] = [];
      let topFrom = 0;
      while (true) {
        const q = supabaseAdmin
          .from('attendance_cache')
          .select('person_id, name, grade_level_id')
          .eq('attendance_category', 1)
          .gte('attendance_date', '2025-09-01')
          .in('grade_level_id', allowedGrades);
        const { data } = await q.range(topFrom, topFrom + 999);
        if (!data || data.length === 0) break;
        topRows.push(...data);
        if (data.length < 1000) break;
        topFrom += 1000;
      }

      if (topRows.length > 0) {
        const studentCounts = new Map<number, { name: string; count: number; grade: number | null }>();
        topRows.forEach(r => {
          const existing = studentCounts.get(r.person_id);
          if (existing) {
            existing.count++;
          } else {
            studentCounts.set(r.person_id, { name: r.name || 'Unknown', count: 1, grade: r.grade_level_id });
          }
        });
        topAbsentees = [...studentCounts.entries()]
          .sort(([, a], [, b]) => b.count - a.count)
          .slice(0, 10)
          .map(([person_id, { name, count, grade }]) => ({
            person_id,
            name,
            ytd_absences: count,
            grade_level_id: grade,
          }));
      }
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      date: today,
      total: mapped.length,
      absences: absencesWithStats,
      tardies: tardiesWithStats,
      earlyDismissals: earlyDismissalsWithStats,
      notExpected: notExpectedWithStats,
      totalStudents,
      monthlyTrend,
      topAbsentees,
    });
  } catch (error) {
    console.error('Error fetching absences:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch absences', date: getTodayET(), total: 0, absences: [], tardies: [], earlyDismissals: [], notExpected: [], totalStudents: 0, monthlyTrend: [], topAbsentees: [] },
      { status: 200 }
    );
  }
}

// Year-to-date attendance aggregation feeding the "Attendance Distribution"
// section on the Absences page. Reads attendance_cache (Supabase, full
// school year scope), aggregates server-side, and returns two pre-bucketed
// arrays so the client just plots them. Pagination matches the existing
// `monthlyTrend` / `topAbsentees` patterns in the default GET above.
// First day with any row in `attendance_cache`. Per RBK's 2026-06-08
// note, the YTD attendance rate must count school days from this date
// onward — `schoolYearStartIso(today)` returns 09-01, but rows only
// begin appearing on 09-03, and the prior denominator (distinct dates
// among absent/tardy rows only) silently undercounted days where every
// student was present in Academy grades. We now derive the denominator
// from a full unfiltered cache scan.
const ATTENDANCE_CACHE_FIRST_DATE = '2025-09-03';

async function getYtdView({ allowedGrades }: { allowedGrades: number[] }) {
  const today = new Date();
  const schoolYearIso = schoolYearStartIso(today); // e.g. "2025-09-01"
  const schoolYearStartYear = parseInt(schoolYearIso.slice(0, 4), 10);
  const todayIso = today.toISOString().slice(0, 10);
  const currentQuarter = quarterForDate(todayIso, schoolYearStartYear);

  try {
    // Pull every absent/tardy row in scope for the school year. Project
    // to the smallest fields needed for both aggregations to keep the
    // payload small on a 90k-row scan.
    type CacheRow = {
      person_id: number;
      attendance_date: string;
      attendance_category: number;
      grade_level_id: number | null;
    };
    const rows: CacheRow[] = [];
    let fromIdx = 0;
    while (true) {
      const { data } = await supabaseAdmin
        .from('attendance_cache')
        .select('person_id, attendance_date, attendance_category, grade_level_id')
        .in('attendance_category', [1, 2]) // absent + tardy
        .in('grade_level_id', allowedGrades)
        .gte('attendance_date', schoolYearIso)
        .range(fromIdx, fromIdx + 999);
      if (!data || data.length === 0) break;
      rows.push(...(data as CacheRow[]));
      if (data.length < 1000) break;
      fromIdx += 1000;
    }

    // True distinct school-day count from `attendance_cache` — counts
    // EVERY date that has any row in the cache (present + absent +
    // tardy), filtered to >= ATTENDANCE_CACHE_FIRST_DATE so phantom
    // pre-school-year dates don't pollute the denominator. Weekends
    // and known breaks fall out naturally because the sync only writes
    // rows for actual school days. Paginated unfiltered scan is the
    // simplest way to compute this client-side; the cache is small
    // enough (~140k rows projected to a single short column) that the
    // extra ~3-5s on lazy YTD load is acceptable.
    const distinctDates = new Set<string>();
    {
      const pageSize = 10000;
      let fromIdx = 0;
      while (fromIdx < 500_000) { // safety cap
        const { data } = await supabaseAdmin
          .from('attendance_cache')
          .select('attendance_date')
          .gte('attendance_date', ATTENDANCE_CACHE_FIRST_DATE)
          .range(fromIdx, fromIdx + pageSize - 1);
        if (!data || data.length === 0) break;
        for (const r of data as Array<{ attendance_date: string }>) {
          distinctDates.add(r.attendance_date);
        }
        if (data.length < pageSize) break;
        fromIdx += pageSize;
      }
    }
    const totalSchoolDays = Math.max(distinctDates.size, 1);

    // Per-student absent count + per-quarter event counts in one pass.
    const absentByPerson = new Map<number, number>();
    const personGrade = new Map<number, number>();
    const quarterEvents: Record<string, { absences: number; tardies: number }> = {
      Q1: { absences: 0, tardies: 0 },
      Q2: { absences: 0, tardies: 0 },
      Q3: { absences: 0, tardies: 0 },
      Q4: { absences: 0, tardies: 0 },
    };
    for (const r of rows) {
      if (r.grade_level_id != null) personGrade.set(r.person_id, r.grade_level_id);
      if (r.attendance_category === 1) {
        absentByPerson.set(r.person_id, (absentByPerson.get(r.person_id) || 0) + 1);
      }
      const q = quarterForDate(r.attendance_date, schoolYearStartYear);
      if (q) {
        if (r.attendance_category === 1) quarterEvents[q].absences++;
        else if (r.attendance_category === 2) quarterEvents[q].tardies++;
      }
    }

    // Tier breakdown by grade. The student roster comes from the cache
    // itself — any student with ≥1 absent/tardy row gets a tier; students
    // who never had an event don't appear here. That's an acceptable
    // approximation since "perfect attendance" students don't change the
    // chart's story (they'd all stack into Satisfactory). Adding the
    // full Veracross roster would require a second API call and double
    // the latency.
    const tierByGrade = new Map<number, { chronically_absent: number; at_risk: number; satisfactory: number }>();
    for (const [personId, absent] of absentByPerson) {
      const grade = personGrade.get(personId);
      if (grade == null) continue;
      const ada = (totalSchoolDays - absent) / totalSchoolDays;
      let bucket: 'chronically_absent' | 'at_risk' | 'satisfactory';
      if (ada < 0.9) bucket = 'chronically_absent';
      else if (ada < 0.95) bucket = 'at_risk';
      else bucket = 'satisfactory';
      const cur = tierByGrade.get(grade) ?? { chronically_absent: 0, at_risk: 0, satisfactory: 0 };
      cur[bucket]++;
      tierByGrade.set(grade, cur);
    }

    const absenceTiersByGrade = GRADE_DISPLAY_ORDER
      .filter(g => tierByGrade.has(g))
      .map(g => {
        const t = tierByGrade.get(g)!;
        return {
          grade_level_id: g,
          grade_label: GRADE_LABELS[g] ?? `Grade ${g}`,
          chronically_absent: t.chronically_absent,
          at_risk: t.at_risk,
          satisfactory: t.satisfactory,
        };
      });

    const quarterlyTrend = (['Q1', 'Q2', 'Q3', 'Q4'] as const).map(q => ({
      quarter: q,
      absences: quarterEvents[q].absences,
      tardies: quarterEvents[q].tardies,
    }));

    return NextResponse.json({
      view: 'ytd',
      schoolYearStart: schoolYearIso,
      currentQuarter,
      totalSchoolDays,
      absenceTiersByGrade,
      quarterlyTrend,
    });
  } catch (err) {
    console.error('[absences ytd] aggregation failed:', err);
    return NextResponse.json({
      view: 'ytd',
      schoolYearStart: schoolYearIso,
      currentQuarter,
      totalSchoolDays: 0,
      absenceTiersByGrade: [],
      quarterlyTrend: [],
      error: err instanceof Error ? err.message : 'YTD aggregation failed',
    }, { status: 200 });
  }
}
