import type { CalendarEvent, EventData, Doc } from '@/types';

const API_BASE = '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Request failed with status ${response.status}`);
  }
  return response.json();
}

// Email operations
export async function updateEmailStatus(id: string, status: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/emails/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to update email status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function updateDraft(id: string, editedDraft: string, draftStatus: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/emails/draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, edited_draft: editedDraft, draft_status: draftStatus }),
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to update draft: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function flagForMeeting(id: string, flagged: boolean): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/emails/${id}/flag`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged_for_meeting: flagged }),
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to update meeting flag: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function archiveEmail(id: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/emails/${id}/archive`, {
      method: 'POST',
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to archive email: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function sendEmail(id: string): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${API_BASE}/emails/${id}/send`, {
      method: 'POST',
    });
    return handleResponse<{ success: boolean }>(response);
  } catch (error) {
    throw new Error(`Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function sendBatchEmails(ids: string[]): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    const results = await Promise.allSettled(
      ids.map((id) => sendEmail(id))
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.success) {
        sent++;
      } else {
        failed++;
      }
    });

    return { sent, failed };
  } catch (error) {
    throw new Error(`Failed to send batch emails: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Calendar operations
export async function fetchCalendarEvents(date: Date, accessToken: string): Promise<CalendarEvent[]> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    const response = await fetch(`${API_BASE}/calendar/today?date=${dateStr}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    const data = await handleResponse<{ events: CalendarEvent[] }>(response);
    return data.events;
  } catch (error) {
    throw new Error(`Failed to fetch calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function createCalendarEvent(event: EventData, accessToken: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/calendar/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(event),
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to create calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function deleteCalendarEvent(eventId: string, accessToken: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/calendar/${eventId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to delete calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Important Docs operations
export async function fetchImportantDocs(): Promise<Doc[]> {
  try {
    const response = await fetch(`${API_BASE}/important-docs`);
    return handleResponse<Doc[]>(response);
  } catch (error) {
    throw new Error(`Failed to fetch important docs: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function addImportantDoc(title: string, url: string): Promise<Doc> {
  try {
    const response = await fetch(`${API_BASE}/important-docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url }),
    });
    return handleResponse<Doc>(response);
  } catch (error) {
    throw new Error(`Failed to add important doc: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function deleteImportantDoc(id: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/important-docs/${id}`, {
      method: 'DELETE',
    });
    await handleResponse(response);
  } catch (error) {
    throw new Error(`Failed to delete important doc: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
