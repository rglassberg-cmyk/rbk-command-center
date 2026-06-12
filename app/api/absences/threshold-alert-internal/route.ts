import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendSlackDM } from '@/lib/slackNotifications';
import { getSlackCredentials } from '@/lib/getIntegration';

// POST /api/absences/threshold-alert-internal
//
// Called by the `dailyAbsenceAlert` Cloud Function at 9:30am ET on
// school days. Identifies students whose YTD absence count crossed
// 5 or 10 today (i.e. they were absent today AND their cumulative
// YTD count from 2025-09-03 onward is exactly 5 or exactly 10) and
// DMs RBK with the list.
//
// Auth: X-Internal-Secret header (shared secret, no user session).
// Single-tenant — hardcoded to the SAR workspace.

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RBK_SLACK_USER_ID = 'U04NBR22Y';
const SCHOOL_YEAR_START = '2025-09-03';
const THRESHOLDS = [5, 10] as const;
const ABSENT_CATEGORY = 1;

function getTodayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_SYNC_SECRET || '';
  const header = request.headers.get('x-internal-secret') || '';
  if (!expected || header !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = getTodayET();

  try {
    // 1. Find students absent today. Threshold logic only applies to
    //    students whose count ticked up today — anyone at 5 absences
    //    but NOT absent today has been at 5 for >= 1 day already and
    //    we've handled them on a prior run.
    const { data: todayAbsent, error: todayErr } = await supabaseAdmin
      .from('attendance_cache')
      .select('person_id')
      .eq('workspace_id', SAR_WORKSPACE_ID)
      .eq('attendance_date', today)
      .eq('attendance_category', ABSENT_CATEGORY);
    if (todayErr) {
      console.error('[absence-threshold] today-absent query failed:', todayErr);
      return NextResponse.json({ error: 'Today query failed' }, { status: 500 });
    }
    const absentTodayIds = Array.from(new Set((todayAbsent ?? []).map(r => (r as { person_id: number }).person_id)));
    if (absentTodayIds.length === 0) {
      return NextResponse.json({ ok: true, crossings: 0, note: 'no absences today' });
    }

    // 2. Pull all YTD absence rows for those students.
    //    Paginated chunks of person_ids keep the IN list bounded.
    type AbsenceRow = { person_id: number; name: string | null; grade_level: string | null };
    const ytdRows: AbsenceRow[] = [];
    const personChunkSize = 500;
    for (let i = 0; i < absentTodayIds.length; i += personChunkSize) {
      const chunk = absentTodayIds.slice(i, i + personChunkSize);
      const { data, error } = await supabaseAdmin
        .from('attendance_cache')
        .select('person_id, name, grade_level')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('attendance_category', ABSENT_CATEGORY)
        .gte('attendance_date', SCHOOL_YEAR_START)
        .lte('attendance_date', today)
        .in('person_id', chunk);
      if (error) {
        console.error('[absence-threshold] ytd query failed:', error);
        return NextResponse.json({ error: 'YTD query failed' }, { status: 500 });
      }
      ytdRows.push(...((data ?? []) as AbsenceRow[]));
    }

    // 3. Aggregate per student. Build a map: person_id → { count, name, grade }.
    interface Agg { count: number; name: string; grade: string }
    const byPerson = new Map<number, Agg>();
    for (const r of ytdRows) {
      const prev = byPerson.get(r.person_id);
      if (prev) {
        prev.count += 1;
        if (!prev.name && r.name) prev.name = r.name;
        if (!prev.grade && r.grade_level) prev.grade = r.grade_level;
      } else {
        byPerson.set(r.person_id, { count: 1, name: r.name ?? '', grade: r.grade_level ?? '' });
      }
    }

    // 4. Find threshold crossings.
    const crossings: Array<{ name: string; count: number; grade: string }> = [];
    for (const agg of byPerson.values()) {
      if (THRESHOLDS.includes(agg.count as 5 | 10)) {
        crossings.push({ name: agg.name || '(unknown name)', count: agg.count, grade: agg.grade || '?' });
      }
    }

    if (crossings.length === 0) {
      return NextResponse.json({ ok: true, crossings: 0 });
    }

    // 5. Build message + DM RBK.
    crossings.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
    const lines = crossings
      .map(c => `• ${c.name} — ${c.count} absences (${c.grade})`)
      .join('\n');
    const message = `:warning: Absence alert:\nThe following students crossed a threshold today:\n${lines}`;

    const { botToken } = await getSlackCredentials(SAR_WORKSPACE_ID);
    if (!botToken) {
      return NextResponse.json({ ok: false, error: 'No Slack token', crossings: crossings.length }, { status: 500 });
    }
    await sendSlackDM(RBK_SLACK_USER_ID, message, botToken);

    return NextResponse.json({ ok: true, crossings: crossings.length });
  } catch (err) {
    console.error('[absence-threshold] threw:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
