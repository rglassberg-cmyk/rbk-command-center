// API discovery probe for the Veracross v3 *programs* API (After School).
// READ-ONLY. Creates nothing — no Supabase tables, no API routes, no UI,
// no deploy. Just authenticates, hits the first page of each programs
// endpoint, and dumps the raw shape so we can design the After School
// page from real field names.
//
// Run (this project uses tsx, NOT ts-node — ts-node isn't installed):
//   npx tsx scripts/discoverProgramsApi.ts
//
// CREDENTIALS — these are NOT yet wired anywhere. Before this script can
// authenticate they must be added in TWO places:
//   1. .env.local  (local dev / running this script):
//        VERACROSS_PROGRAMS_CLIENT_ID=...
//        VERACROSS_PROGRAMS_CLIENT_SECRET=...
//   2. Cloud Run (production), via the `--update-env-vars` list in
//      deploy.sh — same place LEVER_API_KEY / ANTHROPIC_API_KEY live.
// Until step 1 is done, this script will report the creds as MISSING and
// fall back to trying the existing Veracross OAuth clients (main /
// admissions / development) against the programs scopes — those almost
// certainly aren't registered for programs scopes, but it's a free
// best-effort so we might get data shape now rather than after the new
// app's creds are pasted in.

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Source of truth for the slug is VERACROSS_SCHOOL_ROUTE in .env.local.
// Both the OAuth host and the API host use "sar" (NOT "saracademy" —
// that returns 404 "The requested client is unknown"). Confirmed by the
// working integration in scripts/test-households-endpoint.ts.
const SCHOOL_ROUTE = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
const OAUTH_URL = `https://accounts.veracross.com/${SCHOOL_ROUTE}/oauth/token`;
const API_BASE = `https://api.veracross.com/${SCHOOL_ROUTE}`;

// The full programs scope set we want, per the task spec.
const PROGRAMS_SCOPE = [
  'programs.classes:list',
  'programs.classes:read',
  'programs.enrollments:list',
  'programs.enrollments:read',
  'programs.courses:list',
  'programs.courses:read',
  'programs.classes.meeting_times:list',
  'programs.classes.meeting_times:read',
].join(' ');

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ClientCred {
  label: string;
  idEnv: string;
  secretEnv: string;
}

// Primary = the new programs app. Fallbacks = existing apps (best-effort
// only; they likely lack programs scopes, but trying costs nothing).
const CLIENTS: ClientCred[] = [
  { label: 'programs',    idEnv: 'VERACROSS_PROGRAMS_CLIENT_ID',    secretEnv: 'VERACROSS_PROGRAMS_CLIENT_SECRET' },
  { label: 'main',        idEnv: 'VERACROSS_CLIENT_ID',             secretEnv: 'VERACROSS_CLIENT_SECRET' },
  { label: 'admissions',  idEnv: 'VERACROSS_ADMISSIONS_CLIENT_ID',  secretEnv: 'VERACROSS_ADMISSIONS_CLIENT_SECRET' },
  { label: 'development', idEnv: 'VERACROSS_DEVELOPMENT_CLIENT_ID', secretEnv: 'VERACROSS_DEVELOPMENT_CLIENT_SECRET' },
];

async function tryGetToken(client: ClientCred, scope: string): Promise<string | null> {
  const clientId = process.env[client.idEnv];
  const clientSecret = process.env[client.secretEnv];

  if (!clientId || !clientSecret) {
    console.log(`[token] ${client.label}: MISSING ${client.idEnv} / ${client.secretEnv} — skipping`);
    return null;
  }

  try {
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`[token] ${client.label} -> ${res.status} ${res.statusText}: ${err.trim().slice(0, 300)}`);
      return null;
    }

    const data: TokenResponse = await res.json();
    console.log(`[token] ${client.label} -> OK (expires_in=${data.expires_in}s, scope="${scope}")`);
    return data.access_token;
  } catch (err) {
    console.log(`[token] ${client.label} -> network error: ${(err as Error).message}`);
    return null;
  }
}

// Interesting pagination / metadata response headers in Veracross v3.
const PAGINATION_HEADERS = [
  'x-total-count',
  'x-page-number',
  'x-page-size',
  'x-total-pages',
  'x-next-page',
  'x-previous-page',
  'link',
  'content-range',
];

interface ProbeResult {
  ok: boolean;
  status: number;
  path: string;
}

async function probePath(url: string, token: string): Promise<{ status: number; statusText: string; headers: Headers; text: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      // v3 paginates via headers, not ?limit=. Ask for 2 records so the
      // "first 2 full records" requirement is satisfied in one call.
      'X-Page-Size': '2',
      'X-Page-Number': '1',
    },
  });
  const text = await res.text();
  return { status: res.status, statusText: res.statusText, headers: res.headers, text };
}

// Probe an endpoint, trying each candidate path until one is not a 404.
async function probeEndpoint(
  label: string,
  candidatePaths: string[],
  token: string,
): Promise<ProbeResult> {
  console.log(`\n\n############################################################`);
  console.log(`# ENDPOINT: ${label}`);
  console.log(`############################################################`);

  let lastResult: ProbeResult = { ok: false, status: 0, path: '' };

  for (const path of candidatePaths) {
    const url = `${API_BASE}${path}`;
    console.log(`\n--- GET ${url}`);

    let r: Awaited<ReturnType<typeof probePath>>;
    try {
      r = await probePath(url, token);
    } catch (err) {
      console.log(`    network error: ${(err as Error).message}`);
      lastResult = { ok: false, status: 0, path };
      continue;
    }

    console.log(`    [status] ${r.status} ${r.statusText}`);

    // Pagination / total-count headers.
    const present: string[] = [];
    for (const h of PAGINATION_HEADERS) {
      const v = r.headers.get(h);
      if (v != null) present.push(`${h}: ${v}`);
    }
    console.log(`    [pagination headers] ${present.length ? present.join(' | ') : '(none present)'}`);
    const totalCount = r.headers.get('x-total-count');
    console.log(`    [total record count] ${totalCount != null ? totalCount : '(no X-Total-Count header)'}`);

    if (r.status === 404) {
      console.log(`    -> 404 NOT FOUND. Trying next path variation (if any).`);
      lastResult = { ok: false, status: 404, path };
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      console.log(`    -> ${r.status} AUTH/SCOPE ISSUE. The token lacks the required scope, the OAuth app`);
      console.log(`       isn't authorized for this endpoint, or (most likely right now) the programs`);
      console.log(`       credentials aren't set yet. Body: ${r.text.trim().slice(0, 300)}`);
      lastResult = { ok: false, status: r.status, path };
      continue;
    }

    // 2xx (or some other non-404) — parse and dump.
    let json: unknown;
    try {
      json = JSON.parse(r.text);
    } catch {
      console.log(`    [body — raw, not JSON]`);
      console.log(r.text.slice(0, 2000));
      lastResult = { ok: r.status >= 200 && r.status < 300, status: r.status, path };
      continue;
    }

    // Veracross v3 wraps rows in { data: [...] }; some endpoints differ,
    // so fall back to treating the payload itself as an array.
    const records: unknown[] = Array.isArray(json)
      ? (json as unknown[])
      : (((json as { data?: unknown[] }).data) ?? []);

    console.log(`    [records in this page] ${records.length}`);

    console.log(`\n    [FULL RAW JSON RESPONSE]`);
    console.log(indent(JSON.stringify(json, null, 2), 4));

    const firstTwo = records.slice(0, 2);
    if (firstTwo.length) {
      console.log(`\n    [FIRST ${firstTwo.length} RECORD(S) — pretty-printed]`);
      firstTwo.forEach((rec, i) => {
        console.log(`\n    --- record[${i}] ---`);
        console.log(indent(JSON.stringify(rec, null, 2), 4));
      });
      const first = firstTwo[0] as Record<string, unknown>;
      console.log(`\n    [all top-level field names on record[0]]`);
      console.log(indent(Object.keys(first).sort().join(', '), 4));
    } else {
      console.log(`\n    [no records returned — empty 'data' array. Endpoint exists but has no rows,`);
      console.log(`     or the shape isn't { data: [...] }. Raw JSON above shows the actual shape.]`);
    }

    lastResult = { ok: r.status >= 200 && r.status < 300, status: r.status, path };
    if (lastResult.ok) {
      console.log(`\n    => SUCCESS on ${path}. Not trying further variations for ${label}.`);
      return lastResult;
    }
  }

  return lastResult;
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map((line) => pad + line).join('\n');
}

async function main() {
  console.log('============================================================');
  console.log('Veracross PROGRAMS API discovery (read-only)');
  console.log('============================================================');
  console.log(`OAuth URL: ${OAUTH_URL}`);
  console.log(`API base:  ${API_BASE}`);
  console.log(`Scope:     ${PROGRAMS_SCOPE}`);

  // Credential presence report.
  console.log(`\n[credential presence]`);
  for (const c of CLIENTS) {
    const has = !!process.env[c.idEnv] && !!process.env[c.secretEnv];
    console.log(`  ${c.label.padEnd(12)} ${c.idEnv} / ${c.secretEnv}: ${has ? 'PRESENT' : 'MISSING'}`);
  }
  if (!process.env.VERACROSS_PROGRAMS_CLIENT_ID || !process.env.VERACROSS_PROGRAMS_CLIENT_SECRET) {
    console.log(`\n  ⚠️  VERACROSS_PROGRAMS_CLIENT_ID / VERACROSS_PROGRAMS_CLIENT_SECRET are not set.`);
    console.log(`     Add them to .env.local to authenticate as the programs app (and to`);
    console.log(`     deploy.sh's --update-env-vars list for Cloud Run when going to prod).`);
    console.log(`     Falling back to existing clients as a best-effort discovery attempt.`);
  }

  // Acquire a token. Try each client with the full programs scope, in
  // priority order. First success wins and is used for every endpoint.
  console.log(`\n[acquiring token — trying clients in priority order with the full programs scope]`);
  let token: string | null = null;
  let tokenClient = '';
  for (const c of CLIENTS) {
    token = await tryGetToken(c, PROGRAMS_SCOPE);
    if (token) {
      tokenClient = c.label;
      break;
    }
  }

  if (!token) {
    console.log(`\n============================================================`);
    console.log(`NO TOKEN OBTAINED. Cannot probe endpoints.`);
    console.log(`This is expected until VERACROSS_PROGRAMS_CLIENT_ID /`);
    console.log(`VERACROSS_PROGRAMS_CLIENT_SECRET are added to .env.local.`);
    console.log(`The script, scopes, and endpoint paths are ready — re-run`);
    console.log(`once the credentials are in place.`);
    console.log(`============================================================`);
    process.exit(0); // not an error condition — discovery simply can't proceed yet
  }

  console.log(`\n>>> Using token from client "${tokenClient}" for all endpoint probes.`);

  // Endpoint path variations. Veracross paths aren't always predictable,
  // so each endpoint lists the most-likely path first, then variants.
  const COURSES = ['/v3/programs/courses', '/v3/activities/courses', '/v3/program/courses'];
  const CLASSES = ['/v3/programs/classes', '/v3/activities/classes', '/v3/program/classes'];
  const ENROLLMENTS = ['/v3/programs/enrollments', '/v3/activities/enrollments', '/v3/program/enrollments'];
  const MEETING_TIMES = [
    '/v3/programs/classes/meeting_times',
    '/v3/programs/meeting_times',
    '/v3/activities/classes/meeting_times',
    '/v3/program/classes/meeting_times',
  ];

  const results: Array<{ label: string; r: ProbeResult }> = [];
  results.push({ label: 'courses',       r: await probeEndpoint('programs/courses', COURSES, token) });
  results.push({ label: 'classes',       r: await probeEndpoint('programs/classes', CLASSES, token) });
  results.push({ label: 'enrollments',   r: await probeEndpoint('programs/enrollments', ENROLLMENTS, token) });
  results.push({ label: 'meeting_times', r: await probeEndpoint('programs/classes/meeting_times', MEETING_TIMES, token) });

  // Summary.
  console.log(`\n\n============================================================`);
  console.log(`SUMMARY`);
  console.log(`============================================================`);
  console.log(`Token client: ${tokenClient}`);
  for (const { label, r } of results) {
    const verdict = r.ok ? `OK (${r.status}) via ${r.path}` : `FAILED (last status ${r.status})`;
    console.log(`  ${label.padEnd(14)} ${verdict}`);
  }
  console.log(`============================================================`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
