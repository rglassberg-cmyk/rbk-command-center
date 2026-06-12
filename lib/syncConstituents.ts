import { supabaseAdmin } from '@/lib/supabase';

// Sprint 4 follow-up: enrich Guardian Circle constituents with a coarse
// role tag + child grade list pulled from Veracross's
// /v3/development/constituents and /v3/students endpoints. Results land
// in `constituents_cache` and are overlaid by
// app/api/development/guardian-circle/route.ts at request time.
//
// Two separate Veracross OAuth clients are used:
//   - DEVELOPMENT (gifts + constituents): same env vars as syncGifts.ts.
//   - ADMISSIONS  (students endpoint):    same env vars as admissions.
// The role parser lives here too — see parseRoleFromTags below.

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface VcConstituent {
  id: number;
  record_type: number | null;
  person?: {
    roles?: string | null;
    graduation_year?: number | null;
  } | null;
  household?: { id?: number | null } | null;
  [key: string]: unknown;
}

interface VcStudent {
  id: number;
  household_id: number | null;
  grade_level: number | null;
  exit_date: string | null;
  [key: string]: unknown;
}

// Parse Veracross's `person.roles` comma-separated string into one of
// the canonical role tags shown in the Guardian Circle sidebar. The
// priority order matters — "Prnt of Alum" must be checked BEFORE
// "Prnt" so we don't classify a parent of an alum as a current parent.
//
// Vocabulary observed in production data (2026-06-03 diagnostic):
//   Prnt, Prnt of Alum, Prnt of Frmr Stud,
//   Grndprnt, Gprnt, Gprnt of Alum,
//   Alum 'YY, HS 'YY, AC 'YY,
//   Staff/Fac, Staff/Fac - Frmr,
//   Donor, Trustee, Trustee - Former, DECEASED, …
export function parseRoleFromTags(rolesRaw: string | null | undefined): string {
  if (!rolesRaw) return 'Other';
  const tags = rolesRaw.split(',').map(t => t.trim());

  // Current Parent — the full-word "Parent" or short "Prnt" without an
  // "of" qualifier. We DO NOT exclude rows that also have
  // "Prnt of Alum"; priority is Parent > Parents of Alumni, so an
  // active parent who also has alumni kids stays a Parent.
  const hasParent = tags.some(t => t === 'Parent' || t === 'Prnt');

  // Current Grandparent — full word or "Grndprnt"/"Gprnt" abbreviation,
  // plus "Gprnt of ..." (grandparent of an alum is still a grandparent
  // today).
  const hasGrandparent = tags.some(t =>
    t === 'Grandparent' || t === 'Grndprnt' || t === 'Gprnt' ||
    t.startsWith('Grndprnt ') || t.startsWith('Gprnt ') ||
    t.startsWith('Grndprnt of ') || t.startsWith('Gprnt of ')
  );

  // Parents of Alumni — children no longer enrolled. Only reached when
  // hasParent is false (current parent takes priority).
  const hasPrntOfAlum = tags.some(t =>
    t.startsWith('Prnt of Alum') ||
    t.startsWith('Prnt of Frmr')
  );

  // Alumni — the constituent themselves graduated (year-suffix tag).
  const hasAlum = tags.some(t => /^(Alum|HS|AC)\s*'/.test(t));

  // Faculty — current staff/faculty. "Staff/Fac - Frmr" excluded.
  const hasFaculty = tags.some(t =>
    (t === 'Faculty' || t === 'Staff/Fac' || t.startsWith('Staff/Fac ')) &&
    !t.includes('Frmr')
  );

  if (hasParent) return 'Parent';
  if (hasGrandparent) return 'Grandparent';
  if (hasPrntOfAlum) return 'Parents of Alumni';
  if (hasAlum) return 'Alumni';
  if (hasFaculty) return 'Faculty';
  return 'Other';
}

async function getDevelopmentToken(): Promise<string> {
  const clientId = process.env.VERACROSS_DEVELOPMENT_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_DEVELOPMENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing VERACROSS_DEVELOPMENT_CLIENT_ID/SECRET');
  }
  const res = await fetch('https://accounts.veracross.com/sar/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'development.constituents:list development.constituents:read',
    }),
  });
  if (!res.ok) throw new Error(`Dev token request failed: ${res.status}`);
  const data: TokenResponse = await res.json();
  return data.access_token;
}

async function getAdmissionsToken(): Promise<string> {
  const clientId = process.env.VERACROSS_ADMISSIONS_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_ADMISSIONS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing VERACROSS_ADMISSIONS_CLIENT_ID/SECRET');
  }
  const res = await fetch('https://accounts.veracross.com/sar/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'students:list students:read',
    }),
  });
  if (!res.ok) throw new Error(`Admissions token request failed: ${res.status}`);
  const data: TokenResponse = await res.json();
  return data.access_token;
}

async function fetchAllPages<T>(baseUrl: string, token: string, label: string): Promise<T[]> {
  const all: T[] = [];
  // First page sequentially so we can read X-Total-Count, then parallel
  // batches of 5 for the rest. Same shape as syncGifts.ts.
  const headers = (page: number): HeadersInit => ({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'X-Page-Size': '1000',
    'X-Page-Number': String(page),
  });
  const page1Res = await fetch(baseUrl, { headers: headers(1) });
  if (!page1Res.ok) {
    const errBody = await page1Res.text();
    throw new Error(`${label} page 1 failed: ${page1Res.status} ${errBody.slice(0, 200)}`);
  }
  const page1Json = await page1Res.json();
  const page1Data: T[] = page1Json.data || [];
  all.push(...page1Data);
  if (page1Data.length < 1000) return all;

  const totalCountHeader = page1Res.headers.get('x-total-count');
  if (totalCountHeader) {
    const totalPages = Math.ceil(parseInt(totalCountHeader) / 1000);
    for (let batchStart = 2; batchStart <= totalPages; batchStart += 5) {
      const batchEnd = Math.min(batchStart + 4, totalPages);
      const batch: Promise<T[]>[] = [];
      for (let p = batchStart; p <= batchEnd; p++) {
        batch.push(
          fetch(baseUrl, { headers: headers(p) }).then(async r => {
            if (!r.ok) return [];
            const j = await r.json();
            return (j.data || []) as T[];
          })
        );
      }
      const results = await Promise.all(batch);
      for (const pageData of results) all.push(...pageData);
    }
  } else {
    // Sequential fallback if no total-count header is returned
    let p = 2;
    while (p <= 20) {
      const r = await fetch(baseUrl, { headers: headers(p) });
      if (!r.ok) break;
      const j = await r.json();
      const pd: T[] = j.data || [];
      if (pd.length === 0) break;
      all.push(...pd);
      if (pd.length < 1000) break;
      p++;
    }
  }
  return all;
}

export async function syncConstituentsForWorkspace(
  workspaceId: string,
): Promise<{ count: number; constituentCount: number; studentCount: number }> {
  const startMs = Date.now();
  console.log('[SYNC CONSTITUENTS] Starting for workspace', workspaceId);

  // 1. Tokens in parallel
  const [devToken, admToken] = await Promise.all([
    getDevelopmentToken(),
    getAdmissionsToken(),
  ]);

  // 2. Constituents + students in parallel
  const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
  const [constituents, students] = await Promise.all([
    fetchAllPages<VcConstituent>(
      `https://api.veracross.com/${schoolRoute}/v3/development/constituents`,
      devToken,
      'Constituents',
    ),
    fetchAllPages<VcStudent>(
      `https://api.veracross.com/${schoolRoute}/v3/students`,
      admToken,
      'Students',
    ),
  ]);
  console.log('[SYNC CONSTITUENTS] Fetched constituents=', constituents.length, 'students=', students.length);

  // 3. household_id → grade_level[] (skip students who've exited)
  const todayIso = new Date().toISOString().slice(0, 10);
  const householdToGrades = new Map<number, number[]>();
  for (const s of students) {
    if (s.household_id == null || s.grade_level == null) continue;
    if (s.exit_date && s.exit_date <= todayIso) continue;
    const arr = householdToGrades.get(s.household_id) ?? [];
    arr.push(s.grade_level);
    householdToGrades.set(s.household_id, arr);
  }

  // 4. Build upsert rows
  const syncedAt = new Date().toISOString();
  const rows = constituents.map(c => {
    const householdId = c.household?.id ?? null;
    const rolesRaw = c.person?.roles ?? null;
    const grades = (householdId != null ? householdToGrades.get(householdId) : null) ?? [];
    return {
      workspace_id: workspaceId,
      constituent_id: c.id,
      role: parseRoleFromTags(rolesRaw),
      grades,
      household_id: householdId,
      roles_raw: rolesRaw,
      synced_at: syncedAt,
    };
  });

  // 5. Upsert in batches of 500
  const batchSize = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabaseAdmin
      .from('constituents_cache')
      .upsert(batch, { onConflict: 'workspace_id,constituent_id' });
    if (error) {
      console.error('[SYNC CONSTITUENTS] Upsert batch failed:', error);
      throw new Error(`Upsert failed: ${error.message}`);
    }
    upserted += batch.length;
  }

  console.log('[SYNC CONSTITUENTS] Done in', Date.now() - startMs, 'ms, upserted=', upserted);
  return {
    count: upserted,
    constituentCount: constituents.length,
    studentCount: students.length,
  };
}
