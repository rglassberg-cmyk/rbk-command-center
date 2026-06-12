import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getVeracrossCredentials } from '@/lib/getIntegration';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
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

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { applicantIds } = await request.json() as { applicantIds: number[] };
    if (!Array.isArray(applicantIds) || applicantIds.length === 0) {
      return NextResponse.json({ applicantNames: {} });
    }

    const token = await getAdmissionsToken(session.workspaceId);
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);

    // Fetch applicants in parallel, batched to avoid overwhelming the API
    const BATCH_SIZE = 20;
    const applicantNames: Record<number, string> = {};

    for (let i = 0; i < applicantIds.length; i += BATCH_SIZE) {
      const batch = applicantIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const res = await fetch(
              `https://api.veracross.com/${schoolRoute}/v3/admission/applicants/${id}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: 'application/json',
                },
              }
            );
            if (res.ok) {
              const json = await res.json();
              const data = json.data || json;
              return { id, name: `${data.first_name || ''} ${data.last_name || ''}`.trim() };
            }
            return { id, name: '' };
          } catch {
            return { id, name: '' };
          }
        })
      );
      results.forEach(({ id, name }) => {
        if (name) applicantNames[id] = name;
      });
    }

    return NextResponse.json({ applicantNames });
  } catch (error) {
    console.error('Error fetching applicant names:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch applicant names', applicantNames: {} },
      { status: 200 }
    );
  }
}
