import { redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';
import Dashboard from './components/Dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getEmails(workspaceId: string | null | undefined) {
  // Never fetch emails without a workspace_id — prevents cross-workspace data leaks
  if (!workspaceId) {
    return [];
  }
  const { data, error } = await supabase
    .from('emails')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('received_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Error fetching emails:', error);
    return [];
  }

  return data || [];
}

// SSR-fetch today's calendar events for the authenticated user. Uses
// 'primary' (the user's default calendar) instead of the legacy
// hardcoded RBK calendar ID. Token comes from user_google_tokens via
// getValidGoogleToken (auto-refresh) instead of the short-lived
// session.accessToken popup token. Returns [] for users without a
// connected Google account — the client-side TodayScheduleCard
// already handles the not-connected case via /api/calendar/today.
async function getCalendarEvents(workspaceId: string, userEmail: string) {
  const accessToken = await getValidGoogleToken(workspaceId, userEmail);
  if (!accessToken) return [];

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const calendarUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
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
      console.error('Calendar API error:', response.status, await response.text());
      return [];
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

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAuthSession();

  if (!session) {
    redirect('/login');
  }

  // All users land on /home by default — UNLESS they have ?nav= or ?projectPanel= params
  // (those come from sidebar/tile clicks and need Dashboard to process them)
  const params = await searchParams;
  if (!params.nav && !params.projectPanel) {
    redirect('/home');
  }

  const [emails, calendarEvents] = await Promise.all([
    getEmails(session.workspaceId),
    session.workspaceId && session.user?.email
      ? getCalendarEvents(session.workspaceId, session.user.email)
      : Promise.resolve([]),
  ]);

  return <Dashboard emails={emails} calendarEvents={calendarEvents} />;
}
