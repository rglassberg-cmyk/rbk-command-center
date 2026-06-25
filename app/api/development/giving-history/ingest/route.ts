import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@google-cloud/storage';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { parseGivingHistoryCSV } from '@/lib/parseGivingHistoryCSV';

// Ingests the nightly Veracross Operating gift-history CSV that Veracross
// drops via SFTP into gs://rbk-cmd-center-sftp/veracross/giving-history/.
// Picks the most-recently-modified .csv, parses it, and upserts into
// giving_history_cache.
//
// Auth: X-Internal-Secret (Cloud Function) OR an admin session (manual
// "Import History" button). GCS auth uses Application Default Credentials —
// the Cloud Run service account already has read access to the bucket
// (same project).

export const maxDuration = 300;

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ADMIN_EMAIL = 'rglassberg@saracademy.org';
const BUCKET = 'rbk-cmd-center-sftp';
const PREFIX = 'veracross/giving-history/';

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
    const storage = new Storage({ projectId: 'rbk-cmd-center' });
    const bucket = storage.bucket(BUCKET);

    // 1. List CSVs under the prefix; pick the most recently modified.
    const [files] = await bucket.getFiles({ prefix: PREFIX });
    const csvFiles = files.filter(
      f => /\.csv$/i.test(f.name) && !f.name.endsWith('/'),
    );
    if (csvFiles.length === 0) {
      return NextResponse.json(
        { error: `No CSV files found in gs://${BUCKET}/${PREFIX}` },
        { status: 404 },
      );
    }
    csvFiles.sort((a, b) => {
      const ua = String(a.metadata?.updated ?? a.metadata?.timeCreated ?? '');
      const ub = String(b.metadata?.updated ?? b.metadata?.timeCreated ?? '');
      if (ua !== ub) return ub.localeCompare(ua); // newest first
      return b.name.localeCompare(a.name);          // tie-break by name desc
    });
    const target = csvFiles[0];
    // GCS last-modified timestamp of the file we're processing (ISO string),
    // surfaced in the response so the UI can show how fresh the CSV is.
    const fileModified = target.metadata?.updated
      ? new Date(String(target.metadata.updated)).toISOString()
      : null;

    // 2. Download + decode.
    const [buf] = await target.download();
    const csvText = buf.toString('utf-8');

    // 3. Parse, then dedup by gift_record_id (a single upsert batch can't
    // touch the same conflict target twice — keep the last occurrence).
    const parsed = parseGivingHistoryCSV(csvText);
    const byId = new Map<string, ReturnType<typeof parseGivingHistoryCSV>[number]>();
    for (const row of parsed) byId.set(row.gift_record_id, row);
    const rows = Array.from(byId.values());
    const skipped = parsed.length - rows.length; // duplicate gift ids collapsed

    // 4. Upsert in batches of 500. Omit id + imported_at so first-import
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
        gift_date: r.gift_date, // null when unparseable
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
        console.error('[GIVING-HISTORY INGEST] upsert batch failed at', i, error);
        return NextResponse.json(
          { error: 'Upsert failed', detail: error.message, file: target.name, file_modified: fileModified, rows_parsed: parsed.length, rows_upserted: upserted, skipped },
          { status: 500 },
        );
      }
      upserted += batch.length;
    }

    console.log(`[GIVING-HISTORY INGEST] file=${target.name} parsed=${parsed.length} upserted=${upserted} skipped=${skipped}`);
    return NextResponse.json({
      success: true,
      file: target.name,
      file_modified: fileModified,
      rows_parsed: parsed.length,
      rows_upserted: upserted,
      skipped,
    });
  } catch (err) {
    console.error('[GIVING-HISTORY INGEST] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
