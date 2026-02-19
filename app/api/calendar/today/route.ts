import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: 'Not authenticated or missing calendar access' },
      { status: 401 }
    );
  }

  // Get date from query param or use today
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date');

  let targetDate: Date;
  if (dateParam) {
    targetDate = new Date(dateParam + 'T00:00:00');
  } else {
    targetDate = new Date();
  }

  const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);

  const timeMin = startOfDay.toISOString();
  const timeMax = endOfDay.toISOString();

  try {
    // Always fetch RBK's calendar, regardless of who is logged in
    const rbkCalendarId = 'kraussb@saracademy.org';
    const calendarUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(rbkCalendarId)}/events`);
    calendarUrl.searchParams.set('timeMin', timeMin);
    calendarUrl.searchParams.set('timeMax', timeMax);
    calendarUrl.searchParams.set('singleEvents', 'true');
    calendarUrl.searchParams.set('orderBy', 'startTime');

    const response = await fetch(calendarUrl.toString(), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Calendar API error:', errorData);
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch calendar' },
        { status: response.status }
      );
    }

    const data: CalendarResponse = await response.json();

    // Transform events to a simpler format with meeting links
    const events = (data.items || []).map((event) => {
      // Find meeting link: check conferenceData first, then hangoutLink, then location/description
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
