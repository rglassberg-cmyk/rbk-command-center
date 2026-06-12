// One-time read-only probe of the Veracross v3 /households endpoint.
// Goal: dump a single household record so we can see which fields the
// API returns (specifically: first_year, new_family, new_family_cy,
// new_family_ny).
//
// Run from /Users/rebeccaglassberg/DevProjects/RBK_Command_Center:
//   npx tsx scripts/test-households-endpoint.ts

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// NOTE: the prompt said "saracademy" but the working integration in
// this repo uses the slug "sar" for BOTH the OAuth host and the API
// host. Using `saracademy` returns 404 "The requested client is
// unknown". Source of truth: VERACROSS_SCHOOL_ROUTE in .env.local.
const SCHOOL_API_ROUTE = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
const SCHOOL_AUTH_ROUTE = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';

// Candidate (clientLabel, clientId, clientSecret, scope) combos to try
// — Veracross requires a scope that the OAuth app is registered for,
// and only certain apps are authorized for /v3/households.
const CLIENTS: Array<{ label: string; idEnv: string; secretEnv: string }> = [
  { label: 'main',         idEnv: 'VERACROSS_CLIENT_ID',             secretEnv: 'VERACROSS_CLIENT_SECRET' },
  { label: 'admissions',   idEnv: 'VERACROSS_ADMISSIONS_CLIENT_ID',  secretEnv: 'VERACROSS_ADMISSIONS_CLIENT_SECRET' },
  { label: 'development',  idEnv: 'VERACROSS_DEVELOPMENT_CLIENT_ID', secretEnv: 'VERACROSS_DEVELOPMENT_CLIENT_SECRET' },
];

const CANDIDATE_SCOPES = [
  'households:list households:read',
  'households:list',
  'school.households:list',
  'school.households:list school.households:read',
  'development.households:list',
  'development.households:list development.households:read',
  'admission.households:list',
  'admission.households:list admission.households:read',
];

async function tryGetToken(
  client: { label: string; idEnv: string; secretEnv: string },
  scope: string,
): Promise<string | null> {
  const clientId = process.env[client.idEnv];
  const clientSecret = process.env[client.secretEnv];

  if (!clientId || !clientSecret) {
    console.error(`[token] ${client.label}: missing ${client.idEnv} or ${client.secretEnv}`);
    return null;
  }

  const res = await fetch(`https://accounts.veracross.com/${SCHOOL_AUTH_ROUTE}/oauth/token`, {
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
    console.error(`[token] ${client.label} scope="${scope}" -> ${res.status}: ${err.trim()}`);
    return null;
  }

  const data: TokenResponse = await res.json();
  console.log(`[token] ${client.label} scope="${scope}" -> OK (expires_in=${data.expires_in})`);
  return data.access_token;
}

async function probeEndpoint(label: string, url: string, token: string, scope: string, clientLabel: string) {
  console.log(`\n=========================================================`);
  console.log(`[GET] ${url}`);
  console.log(`[client] ${clientLabel}  [scope] ${scope}`);
  console.log(`=========================================================`);

  // Veracross v3 does not accept ?limit=; pagination is via headers.
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'X-Page-Size': '1',
      'X-Page-Number': '1',
    },
  });

  const text = await res.text();
  console.log(`[status] ${res.status} ${res.statusText}`);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`[body — raw text (${label})]`);
    console.log(text);
    return;
  }

  console.log(`\n[body — full JSON (${label})]`);
  console.log(JSON.stringify(json, null, 2));

  const records = (json as { data?: unknown[] }).data ?? [];
  const first = records[0] as Record<string, unknown> | undefined;
  if (first) {
    const probe = ['first_year', 'new_family', 'new_family_cy', 'new_family_ny'];
    console.log(`\n[field probe — does the ${label} record contain these keys?]`);
    for (const key of probe) {
      const present = Object.prototype.hasOwnProperty.call(first, key);
      console.log(`  ${key}: ${present ? `PRESENT (value=${JSON.stringify(first[key])})` : 'MISSING'}`);
    }
    console.log(`\n[all top-level keys on the first ${label} record]`);
    console.log(Object.keys(first).sort().join(', '));
  } else {
    console.log(`\n[no records returned in \`data\` array for ${label}]`);
  }
}

async function main() {
  // Try every client × scope combo, collecting any successful tokens.
  const successes: Array<{ clientLabel: string; scope: string; token: string }> = [];
  for (const client of CLIENTS) {
    for (const scope of CANDIDATE_SCOPES) {
      const token = await tryGetToken(client, scope);
      if (token) successes.push({ clientLabel: client.label, scope, token });
    }
  }

  if (successes.length === 0) {
    console.error('No client/scope combo produced a token. Cannot call API.');
    process.exit(1);
  }

  console.log(`\nObtained ${successes.length} token(s). Picking one per endpoint.\n`);

  // /v3/households — use the broadest scope we have; prefer development
  // client + households scope since that's the apparent natural fit.
  const hhPick =
    successes.find((s) => s.clientLabel === 'development' && s.scope.startsWith('households:list')) ??
    successes[0];
  await probeEndpoint(
    'households',
    `https://api.veracross.com/${SCHOOL_API_ROUTE}/v3/households`,
    hhPick.token,
    hhPick.scope,
    hhPick.clientLabel,
  );

  // /v3/admission/households — the field names asked about
  // (first_year, new_family, new_family_cy, new_family_ny) read like
  // admission attributes, so probe this endpoint too for comparison.
  const admPick = successes.find((s) => s.scope.includes('admission.households'));
  if (admPick) {
    await probeEndpoint(
      'admission/households',
      `https://api.veracross.com/${SCHOOL_API_ROUTE}/v3/admission/households`,
      admPick.token,
      admPick.scope,
      admPick.clientLabel,
    );
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
