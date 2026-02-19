import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import Dashboard from './components/Dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getEmails() {
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching emails:', error);
    return [];
  }

  return data || [];
}

async function getCalendarEvents(accessToken: string) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const rbkCalendarId = 'kraussb@saracademy.org';
  const calendarUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(rbkCalendarId)}/events`);
  calendarUrl.searchParams.set('timeMin', startOfDay.toISOString());
  calendarUrl.searchParams.set('timeMax', endOfDay.toISOString());
  calendarUrl.searchParams.set('singleEvents', 'true');
  calendarUrl.searchParams.set('orderBy', 'startTime');

  try {
    const response = await fetch(calendarUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Calendar API error:', response.status, errorText);
      // Return error info so we can show it in the UI
      return [{ id: 'error', title: `Calendar error: ${response.status}`, startTime: new Date().toISOString(), endTime: new Date().toISOString(), isAllDay: false, location: null, meetingLink: null, calendarLink: null }];
    }

    const data = await response.json();
    return (data.items || []).map((event: {
      id: string;
      summary?: string;
      location?: string;
      description?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType: string; uri: string }>;
      };
    }) => {
      // Find meeting link: check conferenceData first, then hangoutLink, then look in location/description
      let meetingLink: string | null = null;

      // Check Google Meet / conference data
      if (event.conferenceData?.entryPoints) {
        const videoEntry = event.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video');
        if (videoEntry) meetingLink = videoEntry.uri;
      }

      // Check hangoutLink (Google Meet)
      if (!meetingLink && event.hangoutLink) {
        meetingLink = event.hangoutLink;
      }

      // Check location for Zoom/Teams links
      if (!meetingLink && event.location) {
        const zoomMatch = event.location.match(/https:\/\/[^\s]*zoom\.us\/[^\s]*/i);
        const teamsMatch = event.location.match(/https:\/\/teams\.microsoft\.com\/[^\s]*/i);
        if (zoomMatch) meetingLink = zoomMatch[0];
        else if (teamsMatch) meetingLink = teamsMatch[0];
      }

      // Check description for Zoom/Teams links
      if (!meetingLink && event.description) {
        const zoomMatch = event.description.match(/https:\/\/[^\s]*zoom\.us\/[^\s]*/i);
        const teamsMatch = event.description.match(/https:\/\/teams\.microsoft\.com\/[^\s]*/i);
        if (zoomMatch) meetingLink = zoomMatch[0];
        else if (teamsMatch) meetingLink = teamsMatch[0];
      }

      return {
        id: event.id,
        title: event.summary || 'No title',
        location: event.location || null,
        startTime: event.start.dateTime || event.start.date,
        endTime: event.end.dateTime || event.end.date,
        isAllDay: !event.start.dateTime,
        meetingLink,
        calendarLink: event.htmlLink || null,
      };
    });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    return [];
  }
}

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  const [emails, calendarEvents] = await Promise.all([
    getEmails(),
    session.accessToken ? getCalendarEvents(session.accessToken) : Promise.resolve([]),
  ]);

  return <Dashboard emails={emails} calendarEvents={calendarEvents} />;
}
