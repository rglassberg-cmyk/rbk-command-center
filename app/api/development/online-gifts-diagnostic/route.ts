import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

const ADMIN_EMAIL = 'rglassberg@saracademy.org';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getDevTokenWithOnlineGifts(): Promise<string> {
  const clientId = process.env.VERACROSS_DEVELOPMENT_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_DEVELOPMENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing VERACROSS_DEVELOPMENT_CLIENT_ID or VERACROSS_DEVELOPMENT_CLIENT_SECRET');
  }

  const res = await fetch('https://accounts.veracross.com/sar/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'development.gifts:list development.gifts:read development.constituents:list development.constituents:read development.online_gifts:list development.online_gifts:read',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.log('[ONLINE GIFTS DIAG] Token error:', res.status, err);
    throw new Error(`Token request failed: ${res.status} — ${err}`);
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';

  // Step 1: Get token with online_gifts scopes
  let token: string;
  try {
    token = await getDevTokenWithOnlineGifts();
    console.log('[ONLINE GIFTS DIAG] Token acquired successfully');
  } catch (error) {
    console.error('[ONLINE GIFTS DIAG] Token step failed:', error);
    return NextResponse.json({ error: String(error), step: 'token', suggestion: 'Check if online_gifts scopes are enabled for this client' }, { status: 500 });
  }

  // Step 2: Try fetching online gifts — try multiple endpoint paths
  const paths = [
    `/v3/development/online_gifts`,
    `/v3/development/online-gifts`,
    `/v3/online_gifts`,
  ];

  for (const path of paths) {
    const url = `https://api.veracross.com/${schoolRoute}${path}`;
    console.log('[ONLINE GIFTS DIAG] Trying:', url);

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-Page-Size': '50',
          'X-Page-Number': '1',
        },
      });

      console.log('[ONLINE GIFTS DIAG] Status:', res.status, 'for path:', path);
      console.log('[ONLINE GIFTS DIAG] Headers:', Object.fromEntries(res.headers.entries()));

      if (res.status === 404) {
        console.log('[ONLINE GIFTS DIAG] 404 — path not found, trying next');
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        const errBody = await res.text();
        console.log('[ONLINE GIFTS DIAG] Auth error:', errBody);
        return NextResponse.json({
          error: `Auth error on ${path}: ${res.status}`,
          body: errBody,
          suggestion: 'Need to enable online_gifts scope in Veracross API credentials',
        }, { status: 200 });
      }

      if (!res.ok) {
        const errBody = await res.text();
        console.log('[ONLINE GIFTS DIAG] Error:', res.status, errBody);
        continue;
      }

      const json = await res.json();
      const records: Record<string, unknown>[] = json.data || [];

      console.log('[ONLINE GIFTS DIAG] First record keys:', Object.keys(records[0] || {}));
      console.log('[ONLINE GIFTS DIAG] Total records returned:', records.length);
      console.log('[ONLINE GIFTS DIAG] Sample records (first 3):', JSON.stringify(records.slice(0, 3), null, 2));
      console.log('[ONLINE GIFTS DIAG] Unique status values:', Array.from(new Set(records.map(r => r.status))));
      console.log('[ONLINE GIFTS DIAG] Unique gift_type values:', Array.from(new Set(records.map(r => r.gift_type))));

      return NextResponse.json({
        success: true,
        path,
        count: records.length,
        fields: Object.keys(records[0] || {}),
        uniqueStatuses: Array.from(new Set(records.map(r => r.status))),
        uniqueGiftTypes: Array.from(new Set(records.map(r => r.gift_type))),
      });
    } catch (error) {
      console.error('[ONLINE GIFTS DIAG] Fetch error for', path, ':', error);
      continue;
    }
  }

  return NextResponse.json({
    error: 'All endpoint paths returned errors',
    pathsTried: paths,
    suggestion: 'Check Veracross API documentation for correct online gifts endpoint',
  }, { status: 200 });
}
