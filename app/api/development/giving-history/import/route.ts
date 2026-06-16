import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';
import { parseGivingHistoryCSV } from '@/lib/parseGivingHistoryCSV';

// Imports the nightly Veracross "Operating Gift History Export" CSV from
// Becca's Gmail into giving_history_cache.
//
// Auth: either the X-Internal-Secret shared secret (Cloud Function /
// scheduled trigger) OR an authenticated admin session (manual button).
//
// Gmail: reads rglassberg@saracademy.org's OAuth token (user_google_tokens)
// via getValidGoogleToken, searches for the most recent matching email with
// an attachment, downloads the CSV part, parses it, and upserts in batches.

export const maxDuration = 300;

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ADMIN_EMAIL = 'rglassberg@saracademy.org';
const GMAIL_USER = 'rglassberg@saracademy.org';
const SEARCH_QUERY = 'subject:"Operating Gift History Export" has:attachment';

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

// Walk the MIME tree for the first CSV attachment (by mimeType or .csv name).
function findCsvPart(part: GmailPart | undefined): GmailPart | null {
  if (!part) return null;
  const isCsv =
    (part.mimeType && /csv/i.test(part.mimeType)) ||
    (part.filename && /\.csv$/i.test(part.filename));
  if (isCsv && part.body?.attachmentId) return part;
  for (const child of part.parts ?? []) {
    const found = findCsvPart(child);
    if (found) return found;
  }
  return null;
}

export async function POST(request: NextRequest) {
  // ---- Auth ----
  const secret = request.headers.get('x-internal-secret');
  const accepted = [process.env.INTERNAL_SYNC_SECRET, process.env.SYNC_SECRET].filter(Boolean);
  const hasSecret = !!secret && accepted.includes(secret);
  if (!hasSecret) {
    const session = await getAuthSession();
    if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const token = await getValidGoogleToken(SAR_WORKSPACE_ID, GMAIL_USER);
    if (!token) {
      return NextResponse.json(
        { error: `No Google token for ${GMAIL_USER}. Reconnect Gmail in Admin → Integrations.` },
        { status: 400 },
      );
    }
    const authHeader = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    // 1. Most recent matching email (Gmail returns reverse-chronological).
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(SEARCH_QUERY)}&maxResults=1`,
      { headers: authHeader },
    );
    if (!listRes.ok) {
      const err = await listRes.text();
      console.error('[GIVING-HISTORY] Gmail list failed:', listRes.status, err.slice(0, 300));
      return NextResponse.json({ error: 'Gmail search failed' }, { status: 502 });
    }
    const listJson = await listRes.json();
    const msgId: string | undefined = listJson.messages?.[0]?.id;
    if (!msgId) {
      return NextResponse.json({ error: 'No "Operating Gift History Export" email found.' }, { status: 404 });
    }

    // 2. Full message → subject/date + CSV part.
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
      { headers: authHeader },
    );
    if (!msgRes.ok) {
      const err = await msgRes.text();
      console.error('[GIVING-HISTORY] Gmail message fetch failed:', msgRes.status, err.slice(0, 300));
      return NextResponse.json({ error: 'Gmail message fetch failed' }, { status: 502 });
    }
    const msg = await msgRes.json();
    const headers: { name: string; value: string }[] = msg.payload?.headers ?? [];
    const emailSubject = headers.find(h => h.name.toLowerCase() === 'subject')?.value ?? '';
    const emailDate = headers.find(h => h.name.toLowerCase() === 'date')?.value
      ?? (msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '');

    const csvPart = findCsvPart(msg.payload);
    if (!csvPart?.body?.attachmentId) {
      return NextResponse.json({ error: 'No CSV attachment on the matching email.' }, { status: 404 });
    }

    // 3. Download + decode the attachment (base64url).
    const attRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${csvPart.body.attachmentId}`,
      { headers: authHeader },
    );
    if (!attRes.ok) {
      const err = await attRes.text();
      console.error('[GIVING-HISTORY] attachment fetch failed:', attRes.status, err.slice(0, 300));
      return NextResponse.json({ error: 'Attachment download failed' }, { status: 502 });
    }
    const attJson = await attRes.json();
    const csvText = Buffer.from(attJson.data ?? '', 'base64url').toString('utf-8');

    // 4. Parse, then dedup by gift_record_id (a single upsert batch can't
    // touch the same conflict target twice — keep the last occurrence).
    const parsed = parseGivingHistoryCSV(csvText);
    const byId = new Map<string, ReturnType<typeof parseGivingHistoryCSV>[number]>();
    for (const row of parsed) byId.set(row.gift_record_id, row);
    const rows = Array.from(byId.values());

    // 5. Upsert in batches of 500. Omit id + imported_at so first-import
    // time is preserved on updates.
    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map(r => ({
        workspace_id: SAR_WORKSPACE_ID,
        gift_record_id: r.gift_record_id,
        constituent_id: r.constituent_id,
        constituent_name: r.constituent_name,
        amount: r.amount,
        gift_type: r.gift_type,
        gift_type_text: r.gift_type_text,
        gift_date: r.gift_date || null,
        campaign: r.campaign,
        fundraising_activity: r.fundraising_activity,
        fiscal_year: r.fiscal_year,
        soft_credit_type_text: r.soft_credit_type_text,
        studio_hard_credit_id: r.studio_hard_credit_id,
      }));
      const { error } = await supabaseAdmin
        .from('giving_history_cache')
        .upsert(batch, { onConflict: 'workspace_id,gift_record_id' });
      if (error) {
        console.error('[GIVING-HISTORY] upsert batch failed at', i, error);
        return NextResponse.json(
          { error: 'Upsert failed', detail: error.message, rows_processed: parsed.length, rows_upserted: upserted },
          { status: 500 },
        );
      }
      upserted += batch.length;
    }

    console.log(`[GIVING-HISTORY] imported ${upserted} rows (parsed ${parsed.length}) from "${emailSubject}" (${emailDate})`);
    return NextResponse.json({
      success: true,
      rows_processed: parsed.length,
      rows_upserted: upserted,
      email_subject: emailSubject,
      email_date: emailDate,
    });
  } catch (err) {
    console.error('[GIVING-HISTORY] import failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
