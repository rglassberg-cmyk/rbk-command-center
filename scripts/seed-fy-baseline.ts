/**
 * One-time seed script — imports the FY25 + FY26 "Constituents (No ORGS)
 * who Gave (D+SC)" Veracross exports (query 918871) into the
 * `fy_baseline_donors` Supabase table.
 *
 * These two donor lists are the authoritative baseline for
 * lapsed / new / retained donor calculations on the Development
 * Overview. Amounts INCLUDE soft credits (D+SC), so they are a donor
 * roster, not a money-of-record source — use the constituent_id lists
 * for set math (lapsed = FY25 \ FY26, new = FY26 \ FY25, retained =
 * FY25 ∩ FY26), not the amounts.
 *
 * Usage:
 *   npm run seed:fy-baseline
 *
 * Safe to re-run — upserts on (workspace_id, constituent_id,
 * fiscal_year).
 *
 * The two CSVs have DIFFERENT column orders (the FY25 export has a
 * leading "HOUSEHOLD: Household ID" column; FY26 leads with
 * "Constituent ID"), so columns are resolved by HEADER NAME, not index:
 *   "Constituent ID"                              → constituent_id
 *   "Constituent"                                 → constituent_name
 *   "Adult Member Roles"                          → adult_member_roles
 *   "Donations +SC for Funds listed in 918871"    → amount (strip commas)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BATCH_SIZE = 200;

// Files to seed: { fiscal_year, filename-substring matchers }. The real
// filenames have spaces + parentheses, so we match on substrings rather
// than hardcode the exact path.
const SOURCES = [
  { fiscalYear: 'FY25', match: (n: string) => /fy25/i.test(n) && n.includes('918871') && n.toLowerCase().endsWith('.csv') },
  { fiscalYear: 'FY26', match: (n: string) => /fy26/i.test(n) && n.includes('918871') && n.toLowerCase().endsWith('.csv') },
] as const;

const SEARCH_DIRS = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Desktop'),
  path.resolve(__dirname, '..'),
];

// Header names to resolve to column indices.
const COL_CONSTITUENT_ID = 'Constituent ID';
const COL_CONSTITUENT = 'Constituent';
const COL_ROLES = 'Adult Member Roles';
const COL_AMOUNT = 'Donations +SC for Funds listed in 918871';

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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Minimal CSV row parser — handles quoted fields, embedded commas,
// embedded newlines, and "" escapes.
function parseCsvRow(input: string, pos: number): { cells: string[]; next: number } | null {
  if (pos >= input.length) return null;
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = pos;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cells.push(cur); cur = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { cells.push(cur); return { cells, next: i + 1 }; }
    cur += ch; i++;
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

function parseAmount(raw: string): number {
  const s = (raw ?? '').trim();
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// First exact-match (trimmed) index for a header name, or -1.
function headerIndex(header: string[], name: string): number {
  return header.findIndex(h => h.trim() === name);
}

function findCsv(matcher: (name: string) => boolean): string | null {
  for (const dir of SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    const hit = entries.find(matcher);
    if (hit) return path.join(dir, hit);
  }
  return null;
}

interface BaselineRow {
  workspace_id: string;
  constituent_id: string;
  constituent_name: string | null;
  fiscal_year: string;
  adult_member_roles: string | null;
  amount: number;
  includes_soft_credits: boolean;
}

function buildRows(csvPath: string, fiscalYear: string): BaselineRow[] {
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseAllRows(csv);
  if (rows.length === 0) throw new Error(`${csvPath} is empty`);
  const header = rows[0];
  const idxId = headerIndex(header, COL_CONSTITUENT_ID);
  const idxName = headerIndex(header, COL_CONSTITUENT);
  const idxRoles = headerIndex(header, COL_ROLES);
  const idxAmount = headerIndex(header, COL_AMOUNT);
  if (idxId < 0 || idxName < 0 || idxAmount < 0) {
    throw new Error(`${path.basename(csvPath)}: missing expected columns (id=${idxId}, name=${idxName}, roles=${idxRoles}, amount=${idxAmount})`);
  }

  // Dedup within the file by constituent_id (last wins) so a single
  // upsert batch never references the same conflict key twice.
  const byId = new Map<string, BaselineRow>();
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const cid = (row[idxId] ?? '').trim();
    // Skip blank rows + any non-numeric id (trailing totals/footers).
    if (!cid || !/^\d+$/.test(cid)) { skipped++; continue; }
    const name = (row[idxName] ?? '').trim() || null;
    const roles = idxRoles >= 0 ? ((row[idxRoles] ?? '').trim() || null) : null;
    const amount = parseAmount(row[idxAmount] ?? '');
    byId.set(cid, {
      workspace_id: SAR_WORKSPACE_ID,
      constituent_id: cid,
      constituent_name: name,
      fiscal_year: fiscalYear,
      adult_member_roles: roles,
      amount,
      includes_soft_credits: true,
    });
  }
  const out = Array.from(byId.values());
  const dupes = (rows.length - 1 - skipped) - out.length;
  console.log(`[seed] ${fiscalYear}: ${out.length} unique donors from ${path.basename(csvPath)} (skipped ${skipped} blank/non-numeric, ${dupes} duplicate id${dupes === 1 ? '' : 's'} collapsed)`);
  return out;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const allRows: BaselineRow[] = [];
  for (const src of SOURCES) {
    const csvPath = findCsv(src.match);
    if (!csvPath) {
      console.error(`[seed] Could not find the ${src.fiscalYear} CSV (918871) in: ${SEARCH_DIRS.join(', ')}`);
      process.exit(1);
    }
    allRows.push(...buildRows(csvPath, src.fiscalYear));
  }

  let upserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('fy_baseline_donors')
      .upsert(batch, { onConflict: 'workspace_id,constituent_id,fiscal_year' });
    if (error) {
      console.error(`[seed] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
      process.exit(1);
    }
    upserted += batch.length;
    console.log(`[seed] Batch ${Math.floor(i / BATCH_SIZE) + 1}: upserted ${batch.length}, running total ${upserted}/${allRows.length}`);
  }

  // Verify per fiscal year. Paginate explicitly — PostgREST caps a
  // single select at 1000 rows, which would under-report the totals.
  const summary = new Map<string, { count: number; sum: number }>();
  {
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const { data: page, error: vErr } = await supabase
        .from('fy_baseline_donors')
        .select('fiscal_year, amount')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .range(offset, offset + pageSize - 1);
      if (vErr) {
        console.error('[seed] Verify query failed:', vErr.message);
        process.exit(1);
      }
      if (!page || page.length === 0) break;
      for (const r of page) {
        const s = summary.get(r.fiscal_year) ?? { count: 0, sum: 0 };
        s.count += 1;
        s.sum += Number(r.amount || 0);
        summary.set(r.fiscal_year, s);
      }
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }
  console.log('\n[seed] Verification (fy_baseline_donors, SAR workspace):');
  for (const fy of Array.from(summary.keys()).sort()) {
    const s = summary.get(fy)!;
    console.log(`  ${fy}: ${s.count.toLocaleString()} rows, $${s.sum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  }
  console.log('\n[seed] Done.');
}

main().catch(err => {
  console.error('[seed] Fatal:', err);
  process.exit(1);
});
