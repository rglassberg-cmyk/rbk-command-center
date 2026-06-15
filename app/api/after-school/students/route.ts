import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getVeracrossCredentials } from '@/lib/getIntegration';

// Resolve Veracross person_id -> student name for the After School drilldown.
//
// CREDENTIALS NOTE: the task asked to use the *programs* OAuth app, but
// that app is NOT authorized for student data — a programs token gets
// `401 missing scope: students:read` on /v3/students/{id}, and the
// programs app can't even request `students:*` scopes (invalid_scope).
// Verified live before building this. So we use the **admissions** client
// (VERACROSS_ADMISSIONS_CLIENT_ID/SECRET via getVeracrossCredentials),
// which holds `students:list students:read` — the same client the
// admissions module already uses to read student records. /v3/students/{id}
// keys `id` on the person_id (107783 -> Molly Moerdler), confirmed.
//
// Batch lookup by id isn't supported (/v3/students rejects ?person_ids=
// / ?ids=), so we fetch individuals in parallel batches of 20 — same
// pattern as app/api/admissions/applicants/route.ts. Always degrades to
// { students: {} } on failure; never throws.

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface StudentName {
  first_name: string;
  last_name: string;
  display_name: string;
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
    console.error('[AFTER-SCHOOL STUDENTS] token error:', res.status, err.slice(0, 200));
    throw new Error('Failed to get Veracross students token');
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
    const { personIds } = (await request.json()) as { personIds: number[] };
    if (!Array.isArray(personIds) || personIds.length === 0) {
      return NextResponse.json({ students: {} });
    }
    // De-dup.
    const ids = Array.from(new Set(personIds.filter((n) => Number.isFinite(n))));

    const token = await getStudentsToken(session.workspaceId);
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);

    const BATCH_SIZE = 20;
    const students: Record<number, StudentName> = {};

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const res = await fetch(`https://api.veracross.com/${schoolRoute}/v3/students/${id}`, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            });
            if (!res.ok) return null;
            const json = await res.json();
            const d = json.data || json;
            const first = (d.preferred_name || d.first_name || '').trim();
            const last = (d.last_name || '').trim();
            const display = `${first} ${last}`.trim();
            if (!display) return null;
            return { id, name: { first_name: (d.first_name || '').trim(), last_name: last, display_name: display } };
          } catch {
            return null;
          }
        }),
      );
      for (const r of results) {
        if (r) students[r.id] = r.name;
      }
    }

    return NextResponse.json({ students });
  } catch (error) {
    console.error('[AFTER-SCHOOL STUDENTS] failed:', error);
    // Graceful degrade — the UI falls back to "Student #<person_id>".
    return NextResponse.json({ students: {} }, { status: 200 });
  }
}
