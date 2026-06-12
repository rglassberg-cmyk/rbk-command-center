import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAuthSession } from '@/lib/auth';

// Phase D: removed HS_GRADING_PERIOD exclusion. The cache now contains
// every grading_period; read-time per-user division filter (driven by
// workspace_members.divisions) scopes what each user sees. Note that
// the prior `29` constant was actually incorrect — HS records carry
// grading_period 24 in live data — so the exclusion never worked
// anyway, which explains the ~14k HS rows already in the cache.

// Single-tenant for now. Stamped onto every upsert so workspace-scoped
// queries (e.g. /api/absences/historical) actually see the rows. The
// route used to omit this field, which produced ~42k NULL-workspace_id
// rows that had to be patched by hand on 2026-06-08.
const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
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

async function getVeracrossToken(): Promise<string> {
  const clientId = process.env.VERACROSS_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing Veracross credentials');
  }

  const res = await fetch('https://accounts.veracross.com/sar/oauth/token', {
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
    throw new Error('Failed to get Veracross token');
  }

  const data: TokenResponse = await res.json();
  return data.access_token;
}

async function buildGradeMap(token: string, schoolRoute: string): Promise<Map<number, number>> {
  const gradeMap = new Map<number, number>();
  let pageNum = 1;
  while (pageNum <= 10) {
    const res = await fetch(
      `https://api.veracross.com/${schoolRoute}/v3/students`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-Page-Size': '1000',
          'X-Page-Number': String(pageNum),
        },
      }
    );
    if (!res.ok) break;
    const json = await res.json();
    const data: VCStudent[] = json.data || [];
    if (data.length === 0) break;
    data.forEach(s => gradeMap.set(s.id, s.grade_level));
    if (data.length < 1000) break;
    pageNum++;
  }
  return gradeMap;
}

interface AttendanceCacheRow {
  workspace_id: string;
  person_id: number;
  attendance_date: string;
  name: string;
  attendance_category: number;
  student_attendance_status: number;
  excused: boolean;
  late_arrival_time: string | null;
  early_dismissal_time: string | null;
  grading_period: number;
  notes: string | null;
  grade_level_id: number | null;
}

async function fetchAttendanceForDate(
  token: string,
  schoolRoute: string,
  date: string,
  gradeMap: Map<number, number>
): Promise<AttendanceCacheRow[]> {
  const res = await fetch(
    `https://api.veracross.com/${schoolRoute}/v3/master_attendance?attendance_date=${date}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Page-Size': '1000',
      },
    }
  );

  if (!res.ok) return [];

  const json = await res.json();
  const records: VCAttendanceRecord[] = json.data || [];

  // Explicitly map to attendance_cache columns only — strip any extra Veracross fields
  return records
    .map(r => ({
      workspace_id: SAR_WORKSPACE_ID,
      person_id: r.person_id,
      attendance_date: date,
      name: r.person,
      attendance_category: r.attendance_category,
      student_attendance_status: r.student_attendance_status,
      excused: r.excused,
      late_arrival_time: r.late_arrival_time || null,
      early_dismissal_time: r.early_dismissal_time || null,
      grading_period: r.grading_period,
      notes: r.notes || null,
      grade_level_id: gradeMap.get(r.person_id) ?? null,
    }));
}

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

export async function GET(request: NextRequest) {
  // Auth: Bearer token first (Cloud Function calls), session fallback (Becca in browser)
  const authHeader = request.headers.get('authorization');
  const syncSecret = process.env.SYNC_SECRET;
  let isAuthed = false;

  if (authHeader && syncSecret && authHeader === `Bearer ${syncSecret}`) {
    isAuthed = true;
  }

  if (!isAuthed) {
    // Fallback: check session (Becca-only)
    const session = await getAuthSession();
    if (session?.user?.email?.toLowerCase() === 'rglassberg@saracademy.org') {
      isAuthed = true;
    }
  }

  if (!isAuthed) {
    console.log('[ATTENDANCE SYNC] Auth failed. authHeader present:', !!authHeader, 'syncSecret set:', !!syncSecret);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get('mode') || 'daily';
  const daysParam = parseInt(request.nextUrl.searchParams.get('days') || '0');

  // ?days=N mode: return immediately, run backfill in background
  if (daysParam > 0) {
    console.log('[ABSENCES BACKFILL] Starting backfill for', daysParam, 'days');

    after(async () => {
      try {
        const token = await getVeracrossToken();
        const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
        const gradeMap = await buildGradeMap(token, schoolRoute);

        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - daysParam);
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);

        let daysProcessed = 0;
        let totalRecords = 0;
        const current = new Date(startDate);

        while (current <= yesterday) {
          if (isWeekday(current)) {
            const dateStr = current.toISOString().split('T')[0];
            const records = await fetchAttendanceForDate(token, schoolRoute, dateStr, gradeMap);

            if (records.length > 0) {
              const { error } = await supabaseAdmin
                .from('attendance_cache')
                .upsert(records, { onConflict: 'person_id,attendance_date' });

              if (error) {
                console.error(`[ABSENCES BACKFILL] Upsert error for ${dateStr}:`, error.message);
              } else {
                totalRecords += records.length;
              }
            }

            daysProcessed++;
            console.log('[ABSENCES BACKFILL] Date', dateStr, 'rows:', records.length);
            await new Promise(r => setTimeout(r, 300));
          }
          current.setDate(current.getDate() + 1);
        }

        console.log('[ABSENCES BACKFILL] Complete. Total days processed:', daysProcessed, 'records:', totalRecords);
      } catch (err) {
        console.error('[ABSENCES BACKFILL] Failed:', err);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Backfill started in background for past ${daysParam} days`,
      days: daysParam,
    }, { status: 202 });
  }

  try {
    const token = await getVeracrossToken();
    const schoolRoute = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
    const gradeMap = await buildGradeMap(token, schoolRoute);

    if (mode === 'backfill') {
      const startDate = new Date('2025-09-02');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      let daysProcessed = 0;
      let totalRecords = 0;
      const current = new Date(startDate);

      while (current <= yesterday) {
        if (isWeekday(current)) {
          const dateStr = current.toISOString().split('T')[0];
          const records = await fetchAttendanceForDate(token, schoolRoute, dateStr, gradeMap);

          if (records.length > 0) {
            const { error } = await supabaseAdmin
              .from('attendance_cache')
              .upsert(records, { onConflict: 'person_id,attendance_date' });

            if (error) {
              console.error(`[ATTENDANCE SYNC] Upsert error for ${dateStr}:`, error.message);
            } else {
              totalRecords += records.length;
            }
          }

          daysProcessed++;
          await new Promise(r => setTimeout(r, 300));
        }
        current.setDate(current.getDate() + 1);
      }

      return NextResponse.json({
        mode: 'backfill',
        days_processed: daysProcessed,
        total_records_upserted: totalRecords,
      });
    }

    // Default: daily mode
    const today = getTodayET();
    const records = await fetchAttendanceForDate(token, schoolRoute, today, gradeMap);

    let recordsUpserted = 0;
    if (records.length > 0) {
      const { error } = await supabaseAdmin
        .from('attendance_cache')
        .upsert(records, { onConflict: 'person_id,attendance_date' });

      if (error) {
        console.error('[ATTENDANCE SYNC] Daily upsert error:', error.message);
      } else {
        recordsUpserted = records.length;
      }
    }

    return NextResponse.json({
      mode: 'daily',
      date: today,
      records_upserted: recordsUpserted,
    });
  } catch (error) {
    console.error('[ATTENDANCE SYNC] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
