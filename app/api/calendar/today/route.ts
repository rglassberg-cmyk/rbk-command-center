import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getValidGoogleToken } from '@/lib/googleToken';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { headers } from 'next/headers';

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
}

interface CalendarResponse {
  items?: CalendarEvent[];
  error?: {
    message: string;
  };
}

// SAR is always in Eastern time. Used as a fallback when Google omits
// `start.timeZone` (rare — happens on imported events) and as the
// default for "what is today" when no ?date= query param is supplied.
const DEFAULT_TIMEZONE = 'America/New_York';

// Returns YYYY-MM-DD for the given instant interpreted in `timeZone`.
// en-CA's date format is YYYY-MM-DD, which is the same shape Google
// uses for all-day events' `start.date` — so the same string can be
// compared against either source without further normalization.
function getLocalDateString(input: string | Date, timeZone: string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  // Use impersonated user's email/workspace if admin is impersonating
  let calendarEmail = session.user.email;
  let calendarWorkspace = session.workspaceId;
  if (session.user.email.toLowerCase() === 'rglassberg@saracademy.org') {
    const h = await headers();
    const impEmail = h.get('x-impersonated-email');
    const impWsId = h.get('x-impersonated-workspace-id');
    if (impEmail) calendarEmail = impEmail;
    if (impWsId) calendarWorkspace = impWsId;
  }

  // Per-user token only — no workspace fallback (each user sees their own calendar)
  const accessToken = await getValidGoogleToken(calendarWorkspace, calendarEmail);
  if (!accessToken) {
    return NextResponse.json(
      { events: [], error: 'not_connected', notConnected: true },
      { status: 200 }
    );
  }

  // Target local date — either the explicit ?date=YYYY-MM-DD query
  // param or "today" in DEFAULT_TIMEZONE. Stored as a string so the
  // post-filter below can compare directly against an all-day event's
  // `start.date` (also a YYYY-MM-DD string from Google) and against
  // the timezone-normalized date for timed events.
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');
  const targetLocalDate = dateParam ?? getLocalDateString(new Date(), DEFAULT_TIMEZONE);

  // Send Google a 72-hour UTC window centered on the target local date.
  // Any timezone in the world is within ±14 hours of UTC, so this
  // guarantees that every event whose local date is `targetLocalDate`
  // is returned by Google — the precise per-event filter then runs in
  // memory using start.timeZone (or DEFAULT_TIMEZONE fallback). The
  // wide window also tolerates DST transitions without edge cases.
  const [tYear, tMonth, tDay] = targetLocalDate.split('-').map(Number);
  const windowStart = new Date(Date.UTC(tYear, tMonth - 1, tDay - 1));
  const windowEnd = new Date(Date.UTC(tYear, tMonth - 1, tDay + 2));
  const timeMin = windowStart.toISOString();
  const timeMax = windowEnd.toISOString();

  try {
    // Use 'primary' calendar (the authenticated user's default calendar)
    const calendarUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    calendarUrl.searchParams.set('timeMin', timeMin);
    calendarUrl.searchParams.set('timeMax', timeMax);
    calendarUrl.searchParams.set('singleEvents', 'true');
    calendarUrl.searchParams.set('orderBy', 'startTime');

    const response = await fetch(calendarUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Calendar API error:', errorData);
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          { error: 'Calendar access expired. Please reconnect your Google account.', authError: true },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch calendar' },
        { status: response.status }
      );
    }

    const data: CalendarResponse = await response.json();

    // Timezone-aware filter to `targetLocalDate`. Timed events use
    // start.timeZone (or DEFAULT_TIMEZONE fallback) so an 8pm ET event
    // resolves to the correct local date instead of UTC midnight the
    // next day. All-day events match by string equality against
    // start.date — already YYYY-MM-DD in Google's response. Multi-day
    // all-day events only match their first day; SAR's calendar is
    // single-day events in practice and the spec opts for the simpler
    // equality check.
    const filteredItems = (data.items || []).filter((event) => {
      if (event.start.dateTime) {
        const tz = event.start.timeZone || DEFAULT_TIMEZONE;
        return getLocalDateString(event.start.dateTime, tz) === targetLocalDate;
      }
      if (event.start.date) {
        return event.start.date === targetLocalDate;
      }
      return false;
    });

    // Transform events to a simpler format with meeting links
    const events = filteredItems.map((event) => {
      let meetingLink: string | null = null;

      if (event.conferenceData?.entryPoints) {
        const videoEntry = event.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
        if (videoEntry) meetingLink = videoEntry.uri;
      }

      if (!meetingLink && event.hangoutLink) {
        meetingLink = event.hangoutLink;
      }

      if (!meetingLink && event.location) {
        const zoomMatch = event.location.match(/https:\/\/[^\s]*zoom\.us\/[^\s]*/i);
        const teamsMatch = event.location.match(/https:\/\/teams\.microsoft\.com\/[^\s]*/i);
        if (zoomMatch) meetingLink = zoomMatch[0];
        else if (teamsMatch) meetingLink = teamsMatch[0];
      }

      if (!meetingLink && event.description) {
        const zoomMatch = event.description.match(/https:\/\/[^\s]*zoom\.us\/[^\s]*/i);
        const teamsMatch = event.description.match(/https:\/\/teams\.microsoft\.com\/[^\s]*/i);
        if (zoomMatch) meetingLink = zoomMatch[0];
        else if (teamsMatch) meetingLink = teamsMatch[0];
      }

      return {
        id: event.id,
        title: event.summary || 'No title',
        description: event.description || null,
        location: event.location || null,
        startTime: event.start.dateTime || event.start.date,
        endTime: event.end.dateTime || event.end.date,
        isAllDay: !event.start.dateTime,
        // Surface the IANA timezone so the client can render times
        // accurately for cross-TZ viewers. Null for all-day events
        // (which carry no time-of-day), DEFAULT_TIMEZONE fallback
        // when Google omits it (rare — imported events).
        timeZone: event.start.timeZone || (event.start.dateTime ? DEFAULT_TIMEZONE : null),
        calendarLink: event.htmlLink,
        meetingLink,
      };
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar events' },
      { status: 500 }
    );
  }
}
