import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

// Public iCal feed for SAR Bar/Bat Mitzvah calendar
const ICAL_URL =
  'https://calendar.google.com/calendar/ical/barbatmitzvah%40saracademy.org/public/basic.ics';

interface ParsedEvent {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string; // ISO string
  end: string | null;
  isAllDay: boolean;
}

/** Parse an iCal date string (YYYYMMDD or YYYYMMDDTHHmmssZ) into a JS Date */
function parseICalDate(raw: string): Date {
  // Remove TZID prefix if present (e.g. "TZID=America/New_York:")
  const val = raw.includes(':') ? raw.split(':').pop()! : raw;
  const cleaned = val.replace(/[^0-9TZ]/g, '');

  if (cleaned.length === 8) {
    // Date only: YYYYMMDD
    const y = parseInt(cleaned.slice(0, 4));
    const m = parseInt(cleaned.slice(4, 6)) - 1;
    const d = parseInt(cleaned.slice(6, 8));
    return new Date(y, m, d);
  }

  // DateTime: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const y = parseInt(cleaned.slice(0, 4));
  const m = parseInt(cleaned.slice(4, 6)) - 1;
  const d = parseInt(cleaned.slice(6, 8));
  const h = parseInt(cleaned.slice(9, 11));
  const min = parseInt(cleaned.slice(11, 13));
  const s = parseInt(cleaned.slice(13, 15)) || 0;

  if (cleaned.endsWith('Z')) {
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
  return new Date(y, m, d, h, min, s);
}

/** Unfold iCal lines (continuation lines start with a space or tab) */
function unfoldLines(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').replace(/\r/g, '').split('\n');
}

/** Parse VEVENT blocks from iCal text */
function parseVEvents(icalText: string): ParsedEvent[] {
  const lines = unfoldLines(icalText);
  const events: ParsedEvent[] = [];
  let inEvent = false;
  let current: Record<string, string> = {};

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      inEvent = false;
      if (current['SUMMARY'] && (current['DTSTART'] || current['DTSTART;VALUE=DATE'])) {
        const dtStartRaw =
          current['DTSTART'] ||
          current['DTSTART;VALUE=DATE'] ||
          Object.entries(current).find(([k]) => k.startsWith('DTSTART'))?.[1] ||
          '';
        const dtEndRaw =
          current['DTEND'] ||
          current['DTEND;VALUE=DATE'] ||
          Object.entries(current).find(([k]) => k.startsWith('DTEND'))?.[1] ||
          '';
        const isAllDay =
          !!current['DTSTART;VALUE=DATE'] ||
          Object.keys(current).some(k => k.startsWith('DTSTART') && k.includes('VALUE=DATE'));

        const startDate = parseICalDate(dtStartRaw);
        events.push({
          uid: current['UID'] || crypto.randomUUID(),
          summary: current['SUMMARY'] || '',
          description: current['DESCRIPTION'] || null,
          location: current['LOCATION'] || null,
          start: startDate.toISOString(),
          end: dtEndRaw ? parseICalDate(dtEndRaw).toISOString() : null,
          isAllDay: isAllDay || dtStartRaw.length <= 8,
        });
      }
      continue;
    }
    if (inEvent) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx);
        const value = line.slice(colonIdx + 1);
        current[key] = value;
      }
    }
  }

  return events;
}

// Substrings that mark a calendar event as a genuine B'nei Mitzvah.
// Matched case-insensitively against the event summary. Added because
// the shared barbatmitzvah@saracademy.org Google Calendar is used as a
// general school-events calendar in practice — Moshava trips, Israel Day
// Parade, and other non-mitzvah entries were showing up in the Simchas
// page's Bar/Bat Mitzvahs section. The substring list intentionally
// covers the four common spellings RBK's staff actually use.
const MITZVAH_TITLE_KEYWORDS = [
  'bar mitzvah',
  'bat mitzvah',
  "b'nei mitzvah",
  'bnei mitzvah',
  'bar/bat mitzvah',
];

function isMitzvahTitle(summary: string): boolean {
  const t = summary.toLowerCase();
  return MITZVAH_TITLE_KEYWORDS.some(k => t.includes(k));
}

/** Get Monday 00:00 and Sunday 23:59 of the current week */
function getCurrentWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.modules?.simchas === false) {
    return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
  }

  try {
    const response = await fetch(ICAL_URL, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!response.ok) {
      console.error('Failed to fetch iCal feed:', response.status);
      return NextResponse.json({ events: [], error: 'Failed to fetch calendar' }, { status: 200 });
    }

    const icalText = await response.text();
    const allEvents = parseVEvents(icalText);

    // Filter to current week + require a B'nei Mitzvah keyword in the
    // event summary. The keyword check is a secondary guard on top of
    // the calendar source (which is supposed to contain only mitzvah
    // events but in practice is reused for other school events).
    const { start: weekStart, end: weekEnd } = getCurrentWeekRange();
    const weekEvents = allEvents.filter((event) => {
      const eventDate = new Date(event.start);
      if (eventDate < weekStart || eventDate > weekEnd) return false;
      return isMitzvahTitle(event.summary);
    });

    // Sort by start date
    weekEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return NextResponse.json({ events: weekEvents });
  } catch (error) {
    console.error('Error fetching simchas calendar:', error);
    return NextResponse.json({ events: [], error: 'Internal error' }, { status: 200 });
  }
}
