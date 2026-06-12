import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getGradeFilterForMember } from '@/lib/divisions';
import { getEffectiveDivisions } from '@/lib/impersonate';
import { applyDivisionParam } from '@/lib/divisionParam';
import { getVeracrossCredentials } from '@/lib/getIntegration';
import { type NextRequest } from 'next/server';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AdmissionApplication {
  application_id: number;
  applicant_id: number;
  year_applying_for: number;
  grade_applying_for: number;
  application_status: number;
  application_decision_response: number;
  application_date: string | null;
  application_decision_date: string | null;
  application_decision_response_date: string | null;
  requesting_financial_aid: boolean;
  decline_reason: string | null;
  student_group_applying_for: number;
  // Phase 6-fix: household_id powers the "View current amount due"
  // accounting link in the student side panel. isNewFamily powers the
  // teal "New Family" badge (distinct from the "New Student" label on
  // applicant rows in general, which only signals "new applicant" not
  // "new family"). Source fields probed on the Veracross record below
  // — the first non-empty value wins.
  household_id: number | null;
  isNewFamily: boolean;
}

export interface ReEnrollmentStudent {
  id: number;
  first_name: string;
  last_name: string;
  grade_level: number;
  next_grade: number;
  grade_applying_for: number | null;
  enrollment_status: number;
  campus: number;
  student_group: string | null;
  city: string | null;
  state: string | null;
}

async function getAdmissionsToken(workspaceId: string): Promise<string> {
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
      scope: 'admission.applications:list admission.applications:read admission.applicants:list admission.applicants:read admission.households:list',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Veracross admissions token error:', res.status, err);
    throw new Error('Failed to get Veracross admissions token');
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
    console.error('Veracross students token error:', res.status, err);
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
      console.error(`[${label}] Fetch failed: ${res.status}`);
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

const VALID_ENROLLMENT_STATUSES = [2, 3, 4, 5, 6, 8];

// next_grade for re-enrolling students. The Academy half maps each
// current grade to the same student's next grade at SAR Academy
// (8th graders graduate; their HS transition goes through the new
// applications pipeline, not re-enrollment). The HS half maps current
// 9/10/11 to 10/11/12 (12th graders graduate).
const NEXT_GRADE_MAP: Record<number, number> = {
  40: 35, 35: 30, 30: 25, 25: 20, 20: 1,
  1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8,
  9: 10, 10: 11, 11: 12,
};

// "Re-enrollment grade levels" = current-year grades whose next-year
// grade stays within the SAME division at SAR. The split is
// division-aware so an Academy-only user does not see HS data, and an
// HS-enabled user sees their re-enrolling 9/10/11 graders.
const ACADEMY_RE_ENROLLMENT_GRADE_LEVELS = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7];
const HS_RE_ENROLLMENT_GRADE_LEVELS = [9, 10, 11];
// Current-year counts shown alongside the projection. Includes the
// graduating tier (8 for Academy, 12 for HS) so the "current year"
// column shows enrolled students even in their last year.
const ACADEMY_CURRENT_YEAR_GRADE_LEVELS = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8];
const HS_CURRENT_YEAR_GRADE_LEVELS = [9, 10, 11, 12];

function reEnrollmentGradesForDivisions(divisions: string[]): number[] {
  const grades: number[] = [];
  if (divisions.includes('academy')) grades.push(...ACADEMY_RE_ENROLLMENT_GRADE_LEVELS);
  if (divisions.includes('hs')) grades.push(...HS_RE_ENROLLMENT_GRADE_LEVELS);
  if (grades.length === 0) return ACADEMY_RE_ENROLLMENT_GRADE_LEVELS;
  return grades;
}

function currentYearGradesForDivisions(divisions: string[]): number[] {
  const grades: number[] = [];
  if (divisions.includes('academy')) grades.push(...ACADEMY_CURRENT_YEAR_GRADE_LEVELS);
  if (divisions.includes('hs')) grades.push(...HS_CURRENT_YEAR_GRADE_LEVELS);
  if (grades.length === 0) return ACADEMY_CURRENT_YEAR_GRADE_LEVELS;
  return grades;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve caller's divisions (impersonation-aware), then narrow by
  // the optional ?division=academy|hs|both query param from the
  // multi-division UI toggle. applyDivisionParam validates that the
  // requested subset is a subset of the caller's actual divisions.
  const callerDivisions = await getEffectiveDivisions(session);
  const memberDivisions = applyDivisionParam(
    new URL(request.url).searchParams.get('division'),
    callerDivisions,
  );
  const allowedGrades = getGradeFilterForMember(memberDivisions);
  const allowedGradesSet = new Set(allowedGrades);
  console.log('[admissions] callerDivisions=', callerDivisions, 'effective=', memberDivisions, 'allowedGrades=', allowedGrades, 'user=', session.user.email);

  try {
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);

    const [admissionsToken, studentsToken] = await Promise.all([
      getAdmissionsToken(session.workspaceId),
      getStudentsToken(session.workspaceId),
    ]);

    // Fetch applications
    const allApplications = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/admission/applications`,
      admissionsToken,
      'Applications',
    );

    // Diagnostic: log which family-related fields Veracross actually
    // returns so the isNewFamily resolution below can be tuned without
    // a redeploy. Logged once per fetch since allApplications is the
    // same shape for every row.
    if (allApplications.length > 0) {
      const familyKeys = Object.keys(allApplications[0]).filter(k => {
        const l = k.toLowerCase();
        return l.includes('family') || l.includes('first_year') || l.includes('household') || l.includes('enrollment_status');
      });
      console.log('[Admissions] family-related keys on applicant:', familyKeys);
    }

    const filteredApplications: AdmissionApplication[] = allApplications
      .filter((a: any) => a.year_applying_for === 2026 && allowedGradesSet.has(a.grade_applying_for) && a.application_status !== 0)
      .map((a: any) => ({
        application_id: a.application_id,
        applicant_id: a.applicant_id,
        year_applying_for: a.year_applying_for,
        grade_applying_for: a.grade_applying_for,
        application_status: a.application_status,
        application_decision_response: a.application_decision_response,
        application_date: a.application_date || null,
        application_decision_date: a.application_decision_date || null,
        application_decision_response_date: a.application_decision_response_date || null,
        requesting_financial_aid: a.requesting_financial_aid || false,
        decline_reason: a.decline_reason || null,
        student_group_applying_for: a.student_group_applying_for ?? 0,
        household_id: a.household_id ?? (typeof a.household === 'object' ? a.household?.id : a.household) ?? null,
        // Try every candidate field. Whichever exists and is truthy wins.
        isNewFamily: !!(
          a.new_family_ny ||
          a.new_family_cy ||
          a.first_year ||
          a.family_enrollment_status === 'new' ||
          (a.family && (a.family.is_new || a.family.first_year))
        ),
      }));

    const uniqueStatuses = [...new Set(filteredApplications.map(a => a.application_status))].sort((a, b) => a - b);
    console.log('[Admissions] Unique application_status values:', uniqueStatuses);

    // Fetch students
    const allStudents = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/students`,
      studentsToken,
      'Students',
    );

    if (!allStudents.length) {
      return NextResponse.json({ applications: filteredApplications, reEnrollments: [], currentYearCounts: {} });
    }

    // Fetch households for city + state data
    const householdStart = Date.now();
    const householdIdToCity = new Map<number, string>();
    const householdIdToState = new Map<number, string>();
    try {
      // Collect unique household_ids from students
      const householdIds = new Set<number>();
      allStudents.forEach((s: any) => {
        const hid = s.household_id ?? (typeof s.household === 'object' ? s.household?.id : s.household);
        if (hid) householdIds.add(hid);
      });
      console.log(`[Households] Need city/state for ${householdIds.size} unique households`);

      // Fetch all households (the admission.households:list scope covers this)
      const allHouseholds = await fetchAllPages(
        `https://api.veracross.com/${schoolRoute}/v3/admission/households`,
        admissionsToken,
        'Households',
      );

      allHouseholds.forEach((h: any) => {
        const hid = h.household_id ?? h.id;
        const city = h.city || h.address_city || h.home_city || h.mailing_city || h.postal_city || null;
        const state = h.state || h.address_state || h.home_state || h.mailing_state || h.postal_state || null;
        if (hid && city) householdIdToCity.set(hid, city);
        if (hid && state) householdIdToState.set(hid, state);
      });

      console.log(`[Households] ${householdIdToCity.size} households have city data, ${householdIdToState.size} have state data (${Date.now() - householdStart}ms)`);
    } catch (e) {
      console.error('[Households] Fetch failed (non-fatal):', e);
    }

    // Build student → household_id map
    const studentHouseholdMap = new Map<number, number>();
    allStudents.forEach((s: any) => {
      const hid = s.household_id ?? (typeof s.household === 'object' ? s.household?.id : s.household);
      if (hid) studentHouseholdMap.set(s.id, hid);
    });

    const now = new Date().toISOString().split('T')[0];

    // Division-aware re-enrollment grade list. For Academy+HS users the
    // set is [40-7, 9-11]; Academy-only is [40-7]; HS-only is [9-11].
    // The Veracross /v3/students list endpoint does not accept a
    // grading_period query param — we list all students and filter
    // client-side. (Logged below for diagnostic clarity.)
    const reEnrollmentGrades = reEnrollmentGradesForDivisions(memberDivisions);
    const reEnrollmentGradesSet = new Set(reEnrollmentGrades);
    console.log('[admissions] re-enrollment student fetch:', {
      endpoint: `https://api.veracross.com/${schoolRoute}/v3/students`,
      query: '(no grading_period — Veracross /v3/students returns the full roster; filtered client-side)',
      divisions: memberDivisions,
      reEnrollmentGrades,
      studentCount: allStudents.length,
    });

    const reEnrollments: ReEnrollmentStudent[] = allStudents
      .filter((s: any) =>
        reEnrollmentGradesSet.has(s.grade_level) &&
        VALID_ENROLLMENT_STATUSES.includes(s.enrollment_status) &&
        (!s.exit_date || s.exit_date > now)
      )
      .map((s: any) => {
        const rawGradeApplying = s.grade_applying_for ?? s.next_grade_level ?? s.future_grade_level ?? null;
        const nextGrade = rawGradeApplying != null ? rawGradeApplying : (NEXT_GRADE_MAP[s.grade_level] ?? s.grade_level);
        const hid = studentHouseholdMap.get(s.id);
        const city = hid ? (householdIdToCity.get(hid) || null) : null;
        const state = hid ? (householdIdToState.get(hid) || null) : null;
        return {
          id: s.id,
          first_name: s.first_name || '',
          last_name: s.last_name || '',
          grade_level: s.grade_level,
          next_grade: nextGrade,
          grade_applying_for: rawGradeApplying,
          enrollment_status: s.enrollment_status,
          campus: typeof s.campus === 'object' ? (s.campus?.id ?? 0) : (s.campus || 0),
          student_group: null,
          city,
          state,
        };
      });

    // Current year counts — division-aware so HS users see grades 9-12.
    const currentYearGradesSet = new Set(currentYearGradesForDivisions(memberDivisions));
    const currentYearCounts: Record<number, number> = {};
    allStudents.forEach((s: any) => {
      if (currentYearGradesSet.has(s.grade_level) && (!s.exit_date || s.exit_date > now)) {
        currentYearCounts[s.grade_level] = (currentYearCounts[s.grade_level] || 0) + 1;
      }
    });

    // Diagnostic: per-grade re-enrollment counts so the projection
    // discrepancy ("Grades 10/11/12 show only 2/2/1") can be checked
    // against the raw Veracross response in Cloud Run logs without a
    // redeploy.
    const reEnrollByGrade: Record<number, number> = {};
    reEnrollments.forEach(r => { reEnrollByGrade[r.grade_level] = (reEnrollByGrade[r.grade_level] || 0) + 1; });
    console.log('[admissions] re-enrolling students by current grade_level:', reEnrollByGrade);
    console.log('[admissions] current-year counts by grade_level:', currentYearCounts);

    return NextResponse.json({ applications: filteredApplications, reEnrollments, currentYearCounts });
  } catch (error) {
    console.error('Error fetching admissions:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch admissions', applications: [], reEnrollments: [], currentYearCounts: {} },
      { status: 200 }
    );
  }
}
