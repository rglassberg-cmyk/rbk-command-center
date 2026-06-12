/**
 * One-time seed script — imports Emily Gray's Israel Grants tracker CSV
 * into the `israel_fund_grants` Supabase table.
 *
 * Usage:
 *   1. Export the "Master EG" tab to CSV and place it at:
 *        ~/DevProjects/RBK_Command_Center/data/master-eg.csv
 *   2. Run:
 *        npm run seed:israel-grants
 *
 * Safe to re-run — deletes existing rows for the SAR workspace before
 * inserting fresh ones (the table has no natural unique key on grant
 * number so a true upsert isn't possible).
 *
 * Column mapping (0-indexed columns in the CSV — see CLAUDE_CONTEXT.md):
 *    0 grant_number              (#N/A → null)
 *    1 confirmed_payment
 *    2 date_received             (M/D/YY or M/D/YYYY → YYYY-MM-DD or null)
 *    3 initiative
 *    4 category
 *    5 organization_person
 *    6 link
 *    7 what_funding
 *    8 wire_status
 *    9 submitted_by
 *   10 contact_info
 *   11 funding_amount            (strip $/commas, parseFloat; 0 on NaN)
 *   12 grant_not_given           (true if non-empty)
 *   13 notes
 *   14 submitted_to_procurify
 *   15 date_wire_sent            (same date parser as col 2)
 *   16 wire_was_sent             (true iff === 'Yes')
 */

import * as fs from 'fs';
import * as path from 'path';

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BATCH_SIZE = 100;
const CSV_PATH = path.resolve(__dirname, '..', 'data', 'master-eg.csv');

// Load .env.local (same pattern as scripts/backfill-gifts.ts).
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx);
      let val = trimmed.slice(eqIdx + 1);
      // Strip optional surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Minimal CSV row parser — handles quoted fields, embedded commas, and
// "" escapes. Each call consumes exactly one logical row from the input
// starting at `pos` and returns the parsed cells + the new position.
// Returns null if pos is at EOF.
function parseCsvRow(input: string, pos: number): { cells: string[]; next: number } | null {
  if (pos >= input.length) return null;
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = pos;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      cells.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      cells.push(cur);
      return { cells, next: i + 1 };
    }
    cur += ch;
    i++;
  }
  cells.push(cur);
  return { cells, next: i };
}

function parseAllRows(input: string): string[][] {
  const rows: string[][] = [];
  let pos = 0;
  while (true) {
    const r = parseCsvRow(input, pos);
    if (!r) break;
    rows.push(r.cells);
    pos = r.next;
  }
  return rows;
}

// M/D/YY or M/D/YYYY → YYYY-MM-DD. Returns null on anything else.
function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (m[3].length === 2) year = year < 50 ? 2000 + year : 1900 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseAmount(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function nonEmpty(raw: string): boolean {
  return raw.trim().length > 0;
}

function nullableTrim(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === '#N/A') return null;
  return s;
}

function cell(row: string[], idx: number): string {
  return idx < row.length ? row[idx] : '';
}

interface InsertRow {
  workspace_id: string;
  grant_number: string | null;
  confirmed_payment: string | null;
  date_received: string | null;
  initiative: string | null;
  category: string | null;
  organization_person: string | null;
  link: string | null;
  what_funding: string | null;
  wire_status: string | null;
  submitted_by: string | null;
  contact_info: string | null;
  funding_amount: number;
  grant_not_given: boolean;
  notes: string | null;
  submitted_to_procurify: string | null;
  date_wire_sent: string | null;
  wire_was_sent: boolean;
  is_visible: boolean;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}. Place the Master EG export there and re-run.`);
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const csv = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseAllRows(csv);
  console.log(`[seed] Parsed ${rows.length} CSV rows`);

  const insertRows: InsertRow[] = [];
  let skippedHeader = 0;
  let skippedBlank = 0;
  for (const row of rows) {
    const c0 = cell(row, 0).trim();
    const c1 = cell(row, 1).trim();
    if (c0 === '' && c1.toLowerCase() === 'confirmed payment') {
      skippedHeader++;
      continue;
    }
    const c3 = cell(row, 3).trim();
    const c5 = cell(row, 5).trim();
    const c11 = cell(row, 11).trim();
    const fundingNum = parseAmount(c11);
    if (!c3 && !c5 && fundingNum === 0) {
      skippedBlank++;
      continue;
    }
    insertRows.push({
      workspace_id: SAR_WORKSPACE_ID,
      grant_number: nullableTrim(c0),
      confirmed_payment: nullableTrim(c1),
      date_received: parseDate(cell(row, 2)),
      initiative: nullableTrim(c3),
      category: nullableTrim(cell(row, 4)),
      organization_person: nullableTrim(c5),
      link: nullableTrim(cell(row, 6)),
      what_funding: nullableTrim(cell(row, 7)),
      wire_status: nullableTrim(cell(row, 8)),
      submitted_by: nullableTrim(cell(row, 9)),
      contact_info: nullableTrim(cell(row, 10)),
      funding_amount: fundingNum,
      grant_not_given: nonEmpty(cell(row, 12)),
      notes: nullableTrim(cell(row, 13)),
      submitted_to_procurify: nullableTrim(cell(row, 14)),
      date_wire_sent: parseDate(cell(row, 15)),
      wire_was_sent: cell(row, 16).trim() === 'Yes',
      is_visible: true,
    });
  }
  console.log(`[seed] ${insertRows.length} rows to insert (skipped ${skippedHeader} header, ${skippedBlank} blank)`);

  // Reset the workspace's rows before inserting so re-runs are
  // idempotent. The table has no natural unique key on grant_number
  // so a true upsert isn't possible.
  console.log('[seed] Deleting existing rows for SAR workspace...');
  const { error: delError } = await supabase
    .from('israel_fund_grants')
    .delete()
    .eq('workspace_id', SAR_WORKSPACE_ID);
  if (delError) {
    console.error('[seed] Delete failed:', delError.message);
    process.exit(1);
  }

  let inserted = 0;
  for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
    const batch = insertRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('israel_fund_grants')
      .insert(batch);
    if (error) {
      console.error(`[seed] Batch ${i / BATCH_SIZE + 1} failed:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`[seed] Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${batch.length}, running total ${inserted}/${insertRows.length}`);
  }

  console.log(`[seed] Done. Inserted ${inserted} grants into israel_fund_grants for workspace ${SAR_WORKSPACE_ID}.`);
}

main().catch(err => {
  console.error('[seed] Fatal:', err);
  process.exit(1);
});
