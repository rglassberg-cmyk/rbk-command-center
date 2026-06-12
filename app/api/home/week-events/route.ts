import { NextResponse } from 'next/server';

const ICAL_URL =
  'https://calendar.google.com/calendar/ical/accalendars%40saracademy.org/public/basic.ics';

function parseICalDate(raw: string): Date {
  const val = raw.includes(':') ? raw.split(':').pop()! : raw;
  const cleaned = val.replace(/[^0-9TZ]/g, '');

  if (cleaned.length === 8) {
    const y = parseInt(cleaned.slice(0, 4));
    const m = parseInt(cleaned.slice(4, 6)) - 1;
    const d = parseInt(cleaned.slice(6, 8));
    return new Date(y, m, d);
  }

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

function unfoldLines(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').replace(/\r/g, '').split('\n');
}

interface ParsedEvent {
  id: string;
  title: string;
  startTime: string;
  isAllDay: boolean;
  location?: string;
}

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
      if (current['SUMMARY'] && (current['DTSTART'] || current['DTSTART;VALUE=DATE'] || Object.keys(current).some(k => k.startsWith('DTSTART')))) {
        const dtStartRaw =
          current['DTSTART'] ||
          current['DTSTART;VALUE=DATE'] ||
          Object.entries(current).find(([k]) => k.startsWith('DTSTART'))?.[1] ||
          '';
        const isAllDay =
          !!current['DTSTART;VALUE=DATE'] ||
          Object.keys(current).some(k => k.startsWith('DTSTART') && k.includes('VALUE=DATE'));

        const startDate = parseICalDate(dtStartRaw);
        events.push({
          id: current['UID'] || crypto.randomUUID(),
          title: current['SUMMARY'] || '',
          startTime: startDate.toISOString(),
          isAllDay: isAllDay || dtStartRaw.length <= 8,
          location: current['LOCATION'] || undefined,
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

function getCurrentWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

export async function GET() {
  try {
    const response = await fetch(ICAL_URL, {
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      console.error('Home week-events: iCal fetch failed:', response.status);
      return NextResponse.json({ events: [] });
    }

    const icalText = await response.text();
    const allEvents = parseVEvents(icalText);

    const { start: weekStart, end: weekEnd } = getCurrentWeekRange();
    console.log('[WEEK-EVENTS] Total parsed events:', allEvents.length, 'week range:', weekStart.toISOString(), 'to', weekEnd.toISOString());
    if (allEvents.length > 0) {
      const dates = allEvents.map(e => e.startTime).sort();
      console.log('[WEEK-EVENTS] Date range of all events:', dates[0], 'to', dates[dates.length - 1]);
    }

    const weekEvents = allEvents
      .filter((event) => {
        const eventDate = new Date(event.startTime);
        return eventDate >= weekStart && eventDate <= weekEnd;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 8);

    console.log('[WEEK-EVENTS] Events in current week:', weekEvents.length);

    return NextResponse.json({ events: weekEvents });
  } catch (error) {
    console.error('Home week-events error:', error);
    return NextResponse.json({ events: [] });
  }
}
