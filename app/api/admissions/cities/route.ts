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
      scope: 'admission.applicants:list admission.applicants:read admission.households:list',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[Cities] Token error:', res.status, err);
    throw new Error('Failed to get token');
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

// Fetch all pages from a paginated Veracross list endpoint
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages(url: string, token: string): Promise<any[]> {
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
      console.error(`[Cities] List fetch failed: ${res.status} for ${url}`);
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

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const idsParam = request.nextUrl.searchParams.get('applicantIds');
    if (!idsParam) {
      return NextResponse.json({ cities: {} });
    }

    const requestedIds = new Set(idsParam.split(',').map(Number).filter(n => !isNaN(n)));
    if (requestedIds.size === 0) {
      return NextResponse.json({ cities: {} });
    }

    const token = await getAdmissionsToken(session.workspaceId);
    const { schoolCode: schoolRoute } = await getVeracrossCredentials(session.workspaceId);

    // Step 1: Fetch ALL applicants (paginated list) to get household_id per applicant
    console.log('[Cities] Fetching all applicants list...');
    const allApplicants = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/admission/applicants`,
      token
    );
    console.log(`[Cities] Got ${allApplicants.length} total applicants`);

    if (allApplicants.length > 0) {
      console.log('[Cities] First applicant fields:', JSON.stringify(Object.keys(allApplicants[0])));
    }

    // Build applicant → household_id map (only for requested IDs)
    const applicantToHousehold = new Map<number, number>();
    for (const a of allApplicants) {
      const id = a.applicant_id ?? a.id;
      if (requestedIds.has(id)) {
        const hid = a.household_id ?? a.household_fk ?? a.admission_household_id;
        if (hid) applicantToHousehold.set(id, hid);
      }
    }
    console.log(`[Cities] Matched ${applicantToHousehold.size} applicants with household IDs`);

    // Step 2: Fetch ALL households (paginated list) to get city
    console.log('[Cities] Fetching all households list...');
    const allHouseholds = await fetchAllPages(
      `https://api.veracross.com/${schoolRoute}/v3/admission/households`,
      token
    );
    console.log(`[Cities] Got ${allHouseholds.length} total households`);

    if (allHouseholds.length > 0) {
      console.log('[Cities] First household record:', JSON.stringify(allHouseholds[0]).slice(0, 500));
    }

    // Build household → city + state maps. State is needed for the
    // region-view grouping in the geography donut so that NJ/CT entries
    // bucket correctly even when the city name itself isn't on the
    // CITY_TO_REGION whitelist.
    const householdToCity = new Map<number, string>();
    const householdToState = new Map<number, string>();
    for (const h of allHouseholds) {
      const hid = h.household_id ?? h.id;
      const city = h.city || h.postal_city || h.home_city || h.mailing_city || null;
      const state = h.state || h.address_state || h.home_state || h.mailing_state || h.postal_state || null;
      if (hid && city) householdToCity.set(hid, city);
      if (hid && state) householdToState.set(hid, state);
    }
    console.log(`[Cities] ${householdToCity.size} households have city data, ${householdToState.size} have state data`);

    // Step 3: Join — applicant → household → city + state
    const cities: Record<number, string> = {};
    const states: Record<number, string> = {};
    for (const [applicantId, householdId] of applicantToHousehold) {
      const city = householdToCity.get(householdId);
      const state = householdToState.get(householdId);
      if (city) cities[applicantId] = city;
      if (state) states[applicantId] = state;
    }

    console.log(`[Cities] Returning ${Object.keys(cities).length} cities, ${Object.keys(states).length} states for ${requestedIds.size} requested applicants`);
    return NextResponse.json({ cities, states });
  } catch (error) {
    console.error('[Cities] Failed:', error);
    return NextResponse.json({ cities: {} });
  }
}
