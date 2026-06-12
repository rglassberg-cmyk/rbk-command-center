import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getValidGoogleToken } from '@/lib/googleToken';
import { headers } from 'next/headers';

export async function GET() {
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
    return NextResponse.json({ events: [], error: 'not_connected', notConnected: true }, { status: 200 });
  }

  // Calculate Monday through Sunday of current week
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 7); // exclusive end

  try {
    const calendarUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    calendarUrl.searchParams.set('timeMin', monday.toISOString());
    calendarUrl.searchParams.set('timeMax', sunday.toISOString());
    calendarUrl.searchParams.set('singleEvents', 'true');
    calendarUrl.searchParams.set('orderBy', 'startTime');

    const response = await fetch(calendarUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Calendar week API error:', errorData);
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch calendar' },
        { status: response.status }
      );
    }

    const data = await response.json();

    const events = (data.items || []).map((event: {
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType: string; uri: string }>;
      };
    }) => {
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

      return {
        id: event.id,
        title: event.summary || 'No title',
        description: event.description || null,
        location: event.location || null,
        startTime: event.start.dateTime || event.start.date,
        endTime: event.end.dateTime || event.end.date,
        isAllDay: !event.start.dateTime,
        calendarLink: event.htmlLink || null,
        meetingLink,
      };
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching calendar week:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar events' },
      { status: 500 }
    );
  }
}
