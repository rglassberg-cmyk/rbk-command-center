// Parser for the Veracross "Operating Gift History Export" CSV.
//
// CSV column order (1-indexed):
//   1 Constituent (full name, e.g. "Adler, Sue" — contains a comma, so
//     it is quoted in the file)
//   2 Record ID (gift record internal numeric id — stored as string)
//   3 Gift Type (text: Donation / Pledge / Donation Soft-Credit /
//     Plg Installment / Plg Soft-Credit)
//   4 Date (MM/DD/YY)
//   5 Amount (may carry $ and commas)
//   6 Campaign (e.g. "Operating 2004-2005")
//   7 Soft Credit Type (text: <None> / Household / Matching / Organization / Other)
//   8 Studio Hard Credit Record ID (string; dedup key for soft credits)
//   9 Fiscal Year (e.g. "FY 05" — normalized to "FY05")
//  10 Fundraising Activity (e.g. "Operating 2004-2005")
//  11 Constituent ID (numeric)

export interface GivingHistoryRow {
  gift_record_id: string;
  constituent_id: number;
  constituent_name: string;
  amount: number;
  gift_type: number;
  gift_type_text: string;
  gift_date: string; // ISO date YYYY-MM-DD ('' when unparseable)
  campaign: string;
  fundraising_activity: string;
  fiscal_year: string;
  soft_credit_type_text: string;
  studio_hard_credit_id: string;
}

const GIFT_TYPE_MAP: Record<string, number> = {
  'donation': 1,
  'pledge': 2,
  'donation soft-credit': 3,
  'plg installment': 4,
  'plg soft-credit': 5,
};

function mapGiftType(text: string): number {
  return GIFT_TYPE_MAP[text.trim().toLowerCase()] ?? 0;
}

// MM/DD/YY (or MM/DD/YYYY) → YYYY-MM-DD. 2-digit year: <50 → 20xx, >=50 → 19xx.
function parseDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  let yyyy = Number(m[3]);
  if (m[3].length <= 2) yyyy = yyyy < 50 ? 2000 + yyyy : 1900 + yyyy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${yyyy}-${pad(mm)}-${pad(dd)}`;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// "FY 05" → "FY05" (strip internal whitespace, uppercase).
function normalizeFiscalYear(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

// Minimal RFC-4180 CSV reader: handles quoted fields, embedded commas,
// embedded newlines, and "" escaped quotes. Returns rows of string cells.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  // Flush trailing field/row (no terminating newline).
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function parseGivingHistoryCSV(csvText: string): GivingHistoryRow[] {
  const rows = parseCsvRows(csvText);
  const out: GivingHistoryRow[] = [];
  // Skip the header row (index 0).
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (!cols || cols.length < 11) continue; // malformed / blank line
    const giftRecordId = (cols[1] ?? '').trim();
    const constituentId = parseInt((cols[10] ?? '').trim(), 10);
    if (!giftRecordId) continue;                 // skip rows with no gift id
    if (!Number.isFinite(constituentId) || constituentId === 0) continue; // skip missing constituent
    const giftTypeText = (cols[2] ?? '').trim();
    out.push({
      gift_record_id: giftRecordId,
      constituent_id: constituentId,
      constituent_name: (cols[0] ?? '').trim(),
      amount: parseAmount(cols[4] ?? ''),
      gift_type: mapGiftType(giftTypeText),
      gift_type_text: giftTypeText,
      gift_date: parseDate(cols[3] ?? ''),
      campaign: (cols[5] ?? '').trim(),
      fundraising_activity: (cols[9] ?? '').trim(),
      fiscal_year: normalizeFiscalYear(cols[8] ?? ''),
      soft_credit_type_text: (cols[6] ?? '').trim(),
      studio_hard_credit_id: (cols[7] ?? '').trim(),
    });
  }
  return out;
}
