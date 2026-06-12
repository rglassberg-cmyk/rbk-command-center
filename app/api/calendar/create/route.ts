import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getValidGoogleToken } from '@/lib/googleToken';
import { headers } from 'next/headers';

interface CreateEventRequest {
  summary: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let calendarEmail = session.user.email;
  let calendarWorkspace = session.workspaceId;
  if (session.user.email.toLowerCase() === 'rglassberg@saracademy.org') {
    const h = await headers();
    const impEmail = h.get('x-impersonated-email');
    const impWsId = h.get('x-impersonated-workspace-id');
    if (impEmail) calendarEmail = impEmail;
    if (impWsId) calendarWorkspace = impWsId;
  }
  const accessToken = await getValidGoogleToken(calendarWorkspace, calendarEmail);
  if (!accessToken) {
    return NextResponse.json({ error: 'not_connected', notConnected: true }, { status: 200 });
  }

  try {
    const body: CreateEventRequest = await request.json();

    if (!body.summary || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: 'Missing required fields: summary, startTime, endTime' },
        { status: 400 }
      );
    }

    const calendarUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

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
        'Authorization': `Bearer ${accessToken}`,
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
