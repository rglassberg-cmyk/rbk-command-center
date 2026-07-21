import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getGradeFilterForMember } from '@/lib/divisions';
import { getEffectiveDivisions } from '@/lib/impersonate';
import { applyDivisionParam } from '@/lib/divisionParam';
import { getVeracrossCredentials } from '@/lib/getIntegration';
import { supabaseAdmin } from '@/lib/supabase';
import { type NextRequest } from 'next/server';

// ── Current Enrollment (26-27 headcount) ────────────────────────────────
//
// DATA SOURCE — /v3/students (the roster), NOT academics/enrollments.
//
// The original build used Veracross `academics/enrollments?school_year=2026`,
// on the assumption that the post-rollover `/v3/students.grade_level` reflected
// each student's NEXT-year grade. Live probing (2026-07-21) disproved that:
//   • `academics/enrollments` returns COURSE enrollments (one row per class),
//     with the grade in `grade_level_id` (NOT `grade_level`) — so the old
//     filter read `undefined → 0` and dropped every row → "0 for all grades."
//   • Worse, in July only ~691 persons (mostly HS) have 26-27 class schedules
//     built; Academy course schedules aren't loaded yet, so that endpoint can
//     never give a full Academy headcount this time of year.
//   • The `/v3/students` roster (1700 rows, all active, `grade_level` fully
//     populated in the admissions numbering) IS the current 26-27 grade — its
//     grades match the HS students' 26-27 course `grade_level_id` exactly. This
//     is the same source `/api/admissions` already uses for `currentYearCounts`,
//     so the two views agree.
//
// Also returns the workspace_settings 'enrollment_projection_enabled' flag so
// the UI knows whether to show Projection mode locked or unlocked.

const SETTING_KEY = 'enrollment_projection_enabled';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CurrentEnrollmentStudent {
  id: number; // person_id (students.id)
  first_name: string;
  last_name: string;
  grade_level: number; // CURRENT (26-27) grade in Veracross admissions numbering
  enrollment_status: number;
  campus: string;
  pisgah?: boolean;
}

// Current-year grade sets (division-aware). Includes the graduating tier
// (8 for Academy, 12 for HS) — a headcount shows every currently enrolled
// student, even those in their last year at this division.
const ACADEMY_CURRENT_YEAR_GRADE_LEVELS = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8];
const HS_CURRENT_YEAR_GRADE_LEVELS = [9, 10, 11, 12];

function currentYearGradesForDivisions(divisions: string[]): number[] {
  const grades: number[] = [];
  if (divisions.includes('academy')) grades.push(...ACADEMY_CURRENT_YEAR_GRADE_LEVELS);
  if (divisions.includes('hs')) grades.push(...HS_CURRENT_YEAR_GRADE_LEVELS);
  if (grades.length === 0) return ACADEMY_CURRENT_YEAR_GRADE_LEVELS;
  return grades;
}

async function getStudentsToken(workspaceId: string): Promise<string> {
  const { admissionsClientId, admissionsClientSecret, schoolCode } = await getVeracrossCredentials(workspaceId);
  if (!admissionsClientId || !admissionsClientSecret) {
    throw new Error('Missing Veracross Admissions credentials');
  }
  const res = await fetch(`https://accounts.veracross.com/${schoolCode}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: admissionsClientId,
      client_secret: admissionsClientSecret,
      scope: 'students:list students:read',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[CURRENT-ENROLLMENT ROUTE] students token error:', res.status, err);
    throw new Error('Failed to get Veracross students token');
  }
  const data: TokenResponse = await res.json();
  return data.access_token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages(url: string, token: string, label: string): Promise<any[]> {
  const all: unknown[] = [];
  let pageNum = 1;
  while (pageNum <= 20) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Page-Size': '1000',
        'X-Page-Number': String(pageNum),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[CURRENT-ENROLLMENT ${label}] Fetch failed: ${res.status}`, body.slice(0, 300));
      break;
    }
    const json = await res.json();
    const pageData = json.data || [];
    if (pageNum === 1) {
      console.log(`[CURRENT-ENROLLMENT ${label}]`, JSON.stringify({ status: res.status, page1Count: pageData.length, sample: pageData.slice(0, 2) }).slice(0, 1500));
    }
    if (pageData.length === 0) break;
    all.push(...pageData);
    if (pageData.length < 1000) break;
    pageNum++;
  }
  return all;
}

// Read the projection-unlock flag. Missing table/row/error → false (locked),
// so the feature is safe even before the workspace-settings migration runs.
async function readProjectionEnabled(workspaceId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('workspace_settings')
      .select('value')
      .eq('workspace_id', workspaceId)
      .eq('key', SETTING_KEY)
      .maybeSingle();
    if (error) {
      console.warn('[CURRENT-ENROLLMENT ROUTE] settings read error (defaulting locked):', error.message);
      return false;
    }
    return data?.value === true;
  } catch (e) {
    console.warn('[CURRENT-ENROLLMENT ROUTE] settings read threw (defaulting locked):', e);
    return false;
  }
}

export async function GET(request: NextRequest) {
  console.log('[CURRENT-ENROLLMENT ROUTE] called', new URL(request.url).search);
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    console.warn('[CURRENT-ENROLLMENT ROUTE] unauthorized — no session');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Division-aware + impersonation-aware, matching /api/admissions.
  const callerDivisions = await getEffectiveDivisions(session);
  const memberDivisions = applyDivisionParam(
    new URL(request.url).searchParams.get('division'),
    callerDivisions,
  );
  const allowedGrades = getGradeFilterForMember(memberDivisions);
  const allowedGradesSet = new Set(allowedGrades);
  const currentYearGradesSet = new Set(
    currentYearGradesForDivisions(memberDivisions).filter(g => allowedGradesSet.has(g)),
  );
  console.log('[CURRENT-ENROLLMENT ROUTE] divisions=', memberDivisions, 'grades=', [...currentYearGradesSet], 'user=', session.user.email);

  const projectionEnabled = await readProjectionEnabled(session.workspaceId);

  try {
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);
    const studentsToken = await getStudentsToken(session.workspaceId);
    console.log('[CURRENT-ENROLLMENT ROUTE] token acquired, schoolRoute=', schoolRoute);

    // The roster — the authoritative current-year (26-27) source. `grade_level`
    // is the admissions numbering (40=I/T … 20=K, 1-8, 9-12), fully populated.
    const allStudents = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/students`,
      studentsToken,
      'STUDENTS',
    );

    const now = new Date().toISOString().split('T')[0];

    const campusName = (raw: unknown): string => {
      if (raw && typeof raw === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const o = raw as any;
        return String(o.name ?? o.description ?? o.id ?? '');
      }
      return raw != null ? String(raw) : '';
    };
    const isPisgah = (raw: unknown): boolean => {
      if (raw == null) return false;
      return String(raw).toLowerCase().includes('pisgah');
    };

    const students: CurrentEnrollmentStudent[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of allStudents as any[]) {
      const grade = s.grade_level;
      if (!currentYearGradesSet.has(grade)) continue;
      // Active only — drop students who have already left (past exit_date).
      if (s.exit_date && s.exit_date <= now) continue;

      const pid = s.id ?? s.person_id;
      if (pid == null) continue;

      students.push({
        id: pid,
        first_name: s.first_name ?? '',
        last_name: s.last_name ?? '',
        grade_level: grade,
        enrollment_status: s.enrollment_status ?? 0,
        campus: campusName(s.campus),
        pisgah: isPisgah(s.student_group ?? s.student_group_name),
      });
    }

    // Counts by grade + total.
    const countsByGrade: Record<number, number> = {};
    students.forEach(s => {
      countsByGrade[s.grade_level] = (countsByGrade[s.grade_level] || 0) + 1;
    });
    const totalEnrolled = students.length;

    console.log('[CURRENT-ENROLLMENT RESULT]', JSON.stringify({
      rosterRows: allStudents.length,
      totalEnrolled,
      gradesCount: Object.keys(countsByGrade).length,
      countsByGrade,
      projectionEnabled,
    }));

    return NextResponse.json({
      students,
      countsByGrade,
      totalEnrolled,
      enrollment_projection_enabled: projectionEnabled,
    });
  } catch (error) {
    console.error('[CURRENT-ENROLLMENT ROUTE] Error:', error);
    // Non-fatal: return an empty payload + the flag so the UI still renders.
    return NextResponse.json(
      {
        students: [],
        countsByGrade: {},
        totalEnrolled: 0,
        enrollment_projection_enabled: projectionEnabled,
        error: error instanceof Error ? error.message : 'Failed to fetch current enrollment',
      },
      { status: 200 },
    );
  }
}

// PATCH — owner-only toggle of the projection-unlock flag. This is how Emily
// or Becca unlock (or re-lock) Projection mode in Jan 2027 without a deploy.
export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'owner') {
    return NextResponse.json({ error: 'Only workspace owners can change this setting' }, { status: 403 });
  }

  let body: { enrollment_projection_enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.enrollment_projection_enabled !== 'boolean') {
    return NextResponse.json({ error: 'enrollment_projection_enabled (boolean) required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('workspace_settings')
    .upsert(
      {
        workspace_id: session.workspaceId,
        key: SETTING_KEY,
        value: body.enrollment_projection_enabled,
        updated_by: session.user.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,key' },
    );

  if (error) {
    console.error('[CURRENT-ENROLLMENT ROUTE] toggle upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, enrollment_projection_enabled: body.enrollment_projection_enabled });
}
