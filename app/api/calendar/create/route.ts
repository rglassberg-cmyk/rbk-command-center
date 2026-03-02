import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

interface CreateEventRequest {
  summary: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();

  if (!session?.accessToken) {
    return NextResponse.json(
      { error: 'Not authenticated or missing calendar access' },
      { status: 401 }
    );
  }

  try {
    const body: CreateEventRequest = await request.json();

    // Validate required fields
    if (!body.summary || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: 'Missing required fields: summary, startTime, endTime' },
        { status: 400 }
      );
    }

    // Create event via Google Calendar API
    const calendarId = 'kraussb@saracademy.org';
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const eventData = {
      summary: body.summary,
      description: body.description || undefined,
      location: body.location || undefined,
      start: {
        dateTime: body.startTime,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: body.endTime,
        timeZone: 'America/New_York',
      },
    };

    const response = await fetch(calendarUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Calendar API error:', errorData);
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to create event' },
        { status: response.status }
      );
    }

    const createdEvent = await response.json();

    return NextResponse.json({
      success: true,
      event: {
        id: createdEvent.id,
        title: createdEvent.summary,
        startTime: createdEvent.start.dateTime || createdEvent.start.date,
        endTime: createdEvent.end.dateTime || createdEvent.end.date,
        link: createdEvent.htmlLink,
      },
    });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return NextResponse.json(
      { error: 'Failed to create calendar event' },
      { status: 500 }
    );
  }
}
