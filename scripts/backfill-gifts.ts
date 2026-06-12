/**
 * One-time script to backfill historical gifts from Veracross into gifts_cache.
 *
 * Usage:
 *   npx ts-node --skip-project scripts/backfill-gifts.ts
 *
 * Reads credentials from .env.local
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

async function getToken(): Promise<string> {
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
      scope: 'development.gifts:list development.gifts:read development.constituents:list development.constituents:read',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token failed: ${res.status} — ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function supabaseUpsert(rows: any[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gifts_cache`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed: ${res.status} — ${err}`);
  }
}

async function main() {
  console.log('[BACKFILL] Starting historical gift backfill...');
  console.log('[BACKFILL] Date range: 2020-01-01 to 2025-04-27');
  console.log('[BACKFILL] Workspace:', WORKSPACE_ID);

  const startMs = Date.now();
  const token = await getToken();
  console.log('[BACKFILL] Token acquired');

  const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
  const baseUrl = `https://api.veracross.com/${schoolRoute}/v3/development/gifts`;

  let totalFetched = 0;
  let pageNum = 1;

  while (pageNum <= 100) {
    const res = await fetch(baseUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Page-Size': '1000',
        'X-Page-Number': String(pageNum),
      },
    });

    if (!res.ok) {
      console.error(`[BACKFILL] Page ${pageNum} error: ${res.status}`);
      break;
    }

    const json = await res.json();
    const pageData: any[] = json.data || [];

    if (pageData.length === 0) {
      console.log(`[BACKFILL] Page ${pageNum}: empty, done.`);
      break;
    }

    // Filter to date range 2020-01-01 through 2025-04-27
    const filtered = pageData.filter((g: any) => {
      if (!g.date) return false;
      const d = g.date.split('T')[0];
      return d >= '2020-01-01' && d <= '2025-04-27';
    });

    if (filtered.length > 0) {
      const syncedAt = new Date().toISOString();
      const rows = filtered.map((g: any) => ({
        id: g.id,
        workspace_id: WORKSPACE_ID,
        gift_type: g.gift_type,
        constituent_id: g.constituent_id,
        constituent_name: g.constituent_name,
        date: g.date,
        amount: g.amount,
        fund: g.fund,
        event: g.event,
        fundraising_activity: g.fundraising_activity,
        apply_to_pledge: g.apply_to_pledge,
        anonymous: g.anonymous,
        in_kind_gift_description: g.in_kind_gift_description,
        soft_credit_type: g.soft_credit_type,
        hard_credit_gift_id: g.hard_credit_gift_id,
        raw_data: g,
        synced_at: syncedAt,
      }));

      // Upsert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        await supabaseUpsert(batch);
      }
    }

    totalFetched += filtered.length;
    console.log(`[BACKFILL] Page ${pageNum}: ${pageData.length} from API, ${filtered.length} in date range, total: ${totalFetched}`);

    if (pageData.length < 1000) break;
    pageNum++;

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[BACKFILL] Complete in ${Math.round((Date.now() - startMs) / 1000)}s. Total gifts upserted: ${totalFetched}`);
}

main().catch(err => {
  console.error('[BACKFILL] Fatal error:', err);
  process.exit(1);
});
