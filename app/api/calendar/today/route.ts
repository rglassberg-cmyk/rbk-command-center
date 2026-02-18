import { NextResponse } from 'next/server';
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
}

interface CalendarResponse {
  items?: CalendarEvent[];
  error?: {
    message: string;
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: 'Not authenticated or missing calendar access' },
      { status: 401 }
    );
  }

  // Get today's date range in ISO format
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

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

    // Transform events to a simpler format
    const events = (data.items || []).map((event) => ({
      id: event.id,
      title: event.summary || 'No title',
      description: event.description || null,
      location: event.location || null,
      startTime: event.start.dateTime || event.start.date,
      endTime: event.end.dateTime || event.end.date,
      isAllDay: !event.start.dateTime,
      link: event.htmlLink,
    }));

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar events' },
      { status: 500 }
    );
  }
}
