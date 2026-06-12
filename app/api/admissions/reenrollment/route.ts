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

export interface ReEnrollment {
  person_id: number;
  first_name: string;
  last_name: string;
  grade_level: number;
  enrollment_status: number;
  school_year: string | null;
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
      scope: 'academics.enrollments:list',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Veracross reenrollment token error:', res.status, err);
    throw new Error('Failed to get Veracross reenrollment token');
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Phase D hotfix: impersonation-aware + division-toggle param.
  const callerDivisions = await getEffectiveDivisions(session);
  const memberDivisions = applyDivisionParam(
    new URL(request.url).searchParams.get('division'),
    callerDivisions,
  );
  const allowedGrades = getGradeFilterForMember(memberDivisions);
  const allowedGradesSet = new Set(allowedGrades);
  console.log('[reenrollment] callerDivisions=', callerDivisions, 'effective=', memberDivisions, 'allowedGrades=', allowedGrades, 'user=', session.user.email);

  try {
    const token = await getAdmissionsToken(session.workspaceId);
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);

    // Fetch all enrollments, paginating through all pages
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allEnrollments: any[] = [];
    let pageNum = 1;
    while (pageNum <= 20) {
      const res = await fetch(
        `https://api.veracross.com/${schoolRoute}/v3/academics/enrollments`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'X-Page-Size': '1000',
            'X-Page-Number': String(pageNum),
          },
        }
      );

      if (!res.ok) {
        const err = await res.text();
        console.error('Veracross enrollments error:', res.status, err);
        throw new Error(`Veracross API error: ${res.status}`);
      }

      const json = await res.json();
      const pageData = json.data || [];
      if (pageData.length === 0) break;
      allEnrollments.push(...pageData);
      if (pageData.length < 1000) break;
      pageNum++;
    }

    // Filter to 2026 school year — try school_year, year_id, or school_year_id fields
    const filtered: ReEnrollment[] = allEnrollments
      .filter(e => {
        const year = e.school_year || e.year_id || e.school_year_id;
        const yearMatch = year === 2026 || year === '2025-2026' || year === '2026' || String(year).includes('2026');
        const gradeLevel = e.grade_level ?? e.future_grade_level ?? 0;
        return yearMatch && allowedGradesSet.has(gradeLevel);
      })
      .map(e => ({
        person_id: e.person_id ?? e.student_id ?? 0,
        first_name: e.first_name ?? e.person_first_name ?? '',
        last_name: e.last_name ?? e.person_last_name ?? '',
        grade_level: e.grade_level ?? e.future_grade_level ?? 0,
        enrollment_status: e.enrollment_status ?? e.status ?? 0,
        school_year: e.school_year ? String(e.school_year) : null,
      }));

    return NextResponse.json({ enrollments: filtered });
  } catch (error) {
    console.error('Error fetching reenrollments:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch re-enrollments', enrollments: [] },
      { status: 200 }
    );
  }
}
