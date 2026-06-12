// Attendance backfill — standalone runner.
//
// Replaces the broken Cloud-Run-side backfill path. Runs locally,
// reads creds from .env.local, and writes directly to
// `attendance_cache` via the Supabase service role.
//
// Differences vs `app/api/absences/sync/route.ts`:
//   1. Paginated `master_attendance` fetch — the route only grabbed
//      page 1, which silently truncated days with > 1000 records.
//   2. Writes `workspace_id` on every row. The route omits it,
//      which is why the previous in-cloud backfill produced 42k+
//      orphan rows (see prior session's UPDATE patch).
//   3. Foreground iteration — no Next.js `after()` lifecycle dance.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

// SAR is the only tenant for now. Hardcoded rather than read from
// env to make the row's workspace_id reviewable in PR diffs.
const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Inclusive date range.
const START_DATE = '2026-03-10';
const END_DATE = '2026-06-07';

const DELAY_MS_BETWEEN_DATES = 500;
const PAGE_SIZE = 1000;

interface TokenResponse {
  access_token: string;
}

interface VCAttendanceRecord {
  id: number;
  attendance_date: string;
  person_id: number;
  person: string;
  attendance_category: number;
  student_attendance_status: number;
  excused: boolean;
  late_arrival_time: string | null;
  early_dismissal_time: string | null;
  grading_period: number;
  notes: string | null;
}

interface VCStudent {
  id: number;
  grade_level: number;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function getVeracrossToken(schoolRoute: string): Promise<string> {
  const clientId = process.env.VERACROSS_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing VERACROSS_CLIENT_ID or VERACROSS_CLIENT_SECRET in .env.local');
  }
  const res = await fetch(`https://accounts.veracross.com/${schoolRoute}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'master_attendance:list students:list',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Veracross token error: ${res.status} ${err}`);
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

async function buildGradeMap(token: string, schoolRoute: string): Promise<Map<number, number>> {
  const gradeMap = new Map<number, number>();
  let pageNum = 1;
  while (pageNum <= 10) {
    const res = await fetch(`https://api.veracross.com/${schoolRoute}/v3/students`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Page-Size': String(PAGE_SIZE),
        'X-Page-Number': String(pageNum),
      },
    });
    if (!res.ok) break;
    const json = await res.json();
    const data: VCStudent[] = json.data || [];
    if (data.length === 0) break;
    data.forEach(s => gradeMap.set(s.id, s.grade_level));
    if (data.length < PAGE_SIZE) break;
    pageNum++;
  }
  return gradeMap;
}

// Paginated fetch for one date. Mirrors the main `/api/absences` route
// (NOT the broken sync route which only ever pulled page 1).
async function fetchAttendanceForDate(
  token: string,
  schoolRoute: string,
  date: string,
): Promise<VCAttendanceRecord[]> {
  const all: VCAttendanceRecord[] = [];
  let page = 1;
  while (page <= 10) {
    const res = await fetch(
      `https://api.veracross.com/${schoolRoute}/v3/master_attendance?attendance_date=${date}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-Page-Size': String(PAGE_SIZE),
          'X-Page-Number': String(page),
        },
      },
    );
    if (!res.ok) {
      console.error(`  Veracross ${res.status} on ${date} page ${page}`);
      break;
    }
    const json = await res.json();
    const records: VCAttendanceRecord[] = json.data || [];
    if (records.length === 0) break;
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

async function main() {
  console.log(`=== Attendance Backfill: ${START_DATE} → ${END_DATE} ===\n`);

  const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
  console.log(`Veracross route: ${schoolRoute}`);
  console.log('Fetching Veracross token...');
  let token = await getVeracrossToken(schoolRoute);

  console.log('Building grade map...');
  const gradeMap = await buildGradeMap(token, schoolRoute);
  console.log(`Grade map: ${gradeMap.size} students\n`);

  const startDate = parseIsoLocal(START_DATE);
  const endDate = parseIsoLocal(END_DATE);

  let daysProcessed = 0;
  let totalRecords = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    if (isWeekday(current)) {
      const dateStr = toIso(current);
      const raw = await fetchAttendanceForDate(token, schoolRoute, dateStr);

      const rows = raw.map(r => ({
        workspace_id: SAR_WORKSPACE_ID,
        person_id: r.person_id,
        name: r.person,
        grade_level: null as string | null,
        grade_level_id: gradeMap.get(r.person_id) ?? null,
        attendance_date: dateStr,
        attendance_category: r.attendance_category,
        student_attendance_status: r.student_attendance_status,
        excused: r.excused,
        grading_period: r.grading_period,
        late_arrival_time: r.late_arrival_time || null,
        early_dismissal_time: r.early_dismissal_time || null,
        notes: r.notes || null,
      }));

      let upserted = 0;
      if (rows.length > 0) {
        const { error } = await supabase
          .from('attendance_cache')
          .upsert(rows, { onConflict: 'person_id,attendance_date' });
        if (error) {
          console.error(`${dateStr}: ERROR ${error.message}`);
        } else {
          upserted = rows.length;
        }
      }
      console.log(`${dateStr}: ${upserted} records upserted`);
      daysProcessed++;
      totalRecords += upserted;

      // Refresh the token every 50 dates so it doesn't expire mid-run.
      if (daysProcessed % 50 === 0) {
        console.log('  (refreshing Veracross token)');
        token = await getVeracrossToken(schoolRoute);
      }

      await new Promise(r => setTimeout(r, DELAY_MS_BETWEEN_DATES));
    }
    current.setDate(current.getDate() + 1);
  }

  console.log(`\n=== Done ===`);
  console.log(`Days processed: ${daysProcessed}`);
  console.log(`Total records upserted: ${totalRecords}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
