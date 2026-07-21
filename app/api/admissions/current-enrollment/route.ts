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
// WHY THIS ROUTE EXISTS: after Veracross rolled the school year over, the
// /v3/students `grade_level` field now reflects each student's NEXT-year
// (27-28) grade. The main /api/admissions route (re-enrollment projection)
// leans on that. But the "Current Enrollment" view needs each student's
// CURRENT (26-27) grade, which is only reliable from the year-scoped
// academics/enrollments endpoint (school_year=2026). So this route reads
// enrollments for 2026 for the authoritative current grade, and joins the
// /v3/students roster only for stable, rollover-independent fields (name,
// campus, household, student_group for Pisgah) keyed by person_id.
//
// It also returns the workspace_settings 'enrollment_projection_enabled'
// flag so the UI knows whether to show Projection mode locked or unlocked.

const SETTING_KEY = 'enrollment_projection_enabled';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CurrentEnrollmentStudent {
  id: number; // person_id
  first_name: string;
  last_name: string;
  grade_level: number; // CURRENT (26-27) grade in Veracross numbering
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

async function getEnrollmentsToken(workspaceId: string): Promise<string> {
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
      scope: 'academics.enrollments:list academics.enrollments:read',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[current-enrollment] enrollments token error:', res.status, err);
    throw new Error('Failed to get Veracross enrollments token');
  }
  const data: TokenResponse = await res.json();
  return data.access_token;
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
      scope: 'students:list students:read admission.applications:list admission.applicants:list admission.households:list',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[current-enrollment] students token error:', res.status, err);
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
      console.error(`[current-enrollment][${label}] Fetch failed: ${res.status}`);
      break;
    }
    const json = await res.json();
    const pageData = json.data || [];
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
      console.warn('[current-enrollment] settings read error (defaulting locked):', error.message);
      return false;
    }
    return data?.value === true;
  } catch (e) {
    console.warn('[current-enrollment] settings read threw (defaulting locked):', e);
    return false;
  }
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
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
  console.log('[current-enrollment] divisions=', memberDivisions, 'grades=', [...currentYearGradesSet], 'user=', session.user.email);

  const projectionEnabled = await readProjectionEnabled(session.workspaceId);

  try {
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);
    const [enrollmentsToken, studentsToken] = await Promise.all([
      getEnrollmentsToken(session.workspaceId),
      getStudentsToken(session.workspaceId),
    ]);

    // Current-year enrollment records (authoritative current grade). Pass
    // school_year=2026 as the task specifies; also filter client-side with
    // tolerant year matching in case the param is ignored by the endpoint.
    const allEnrollments = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/academics/enrollments?school_year=2026`,
      enrollmentsToken,
      'Enrollments',
    );

    // Stable roster fields (name/campus/household/student_group) by person_id.
    // grade_level here is the post-rollover NEXT-year grade, so it is NOT used
    // for grade — only for name/campus/pisgah lookup.
    const allStudents = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/students`,
      studentsToken,
      'Students',
    );

    const now = new Date().toISOString().split('T')[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const studentById = new Map<number, any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allStudents.forEach((s: any) => {
      const pid = s.id ?? s.person_id;
      if (pid != null) studentById.set(pid, s);
    });

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
      const s = String(raw).toLowerCase();
      return s.includes('pisgah');
    };

    // Dedup by person_id — academics/enrollments can return more than one row
    // per student. Keep the first row that carries an allowed current grade.
    const seen = new Set<number>();
    const students: CurrentEnrollmentStudent[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of allEnrollments as any[]) {
      const year = e.school_year ?? e.year_id ?? e.school_year_id;
      const yearMatch =
        year == null ||
        year === 2026 || year === '2026' || year === '2025-2026' || String(year).includes('2026');
      if (!yearMatch) continue;

      const pid = e.person_id ?? e.student_id ?? e.id ?? 0;
      if (!pid || seen.has(pid)) continue;

      const grade = e.grade_level ?? e.future_grade_level ?? e.current_grade_level ?? 0;
      if (!currentYearGradesSet.has(grade)) continue;

      const roster = studentById.get(pid);
      // Skip students who have already withdrawn/left (past exit_date).
      if (roster?.exit_date && roster.exit_date <= now) continue;

      const status = e.enrollment_status ?? e.status ?? roster?.enrollment_status ?? 0;

      seen.add(pid);
      students.push({
        id: pid,
        first_name: roster?.first_name ?? e.first_name ?? e.person_first_name ?? '',
        last_name: roster?.last_name ?? e.last_name ?? e.person_last_name ?? '',
        grade_level: grade,
        enrollment_status: status,
        campus: campusName(roster?.campus ?? e.campus),
        pisgah: isPisgah(roster?.student_group ?? roster?.student_group_name),
      });
    }

    // Counts by grade + total.
    const countsByGrade: Record<number, number> = {};
    students.forEach(s => {
      countsByGrade[s.grade_level] = (countsByGrade[s.grade_level] || 0) + 1;
    });
    const totalEnrolled = students.length;

    console.log('[current-enrollment] enrollmentsRows=', allEnrollments.length, 'students=', totalEnrolled, 'countsByGrade=', countsByGrade, 'projectionEnabled=', projectionEnabled);

    return NextResponse.json({
      students,
      countsByGrade,
      totalEnrolled,
      enrollment_projection_enabled: projectionEnabled,
    });
  } catch (error) {
    console.error('[current-enrollment] Error:', error);
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
    console.error('[current-enrollment] toggle upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, enrollment_projection_enabled: body.enrollment_projection_enabled });
}
