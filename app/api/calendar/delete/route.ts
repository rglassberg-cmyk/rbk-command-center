import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getValidGoogleToken } from '@/lib/googleToken';
import { headers } from 'next/headers';

export async function DELETE(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');

  if (!eventId) {
    return NextResponse.json(
      { error: 'Event ID is required' },
      { status: 400 }
    );
  }

  try {
    const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;

    const response = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 204) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Calendar API error:', errorData);
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to delete event' },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    return NextResponse.json(
      { error: 'Failed to delete calendar event' },
      { status: 500 }
    );
  }
}
