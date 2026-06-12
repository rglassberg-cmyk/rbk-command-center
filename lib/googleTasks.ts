// Helpers for pushing items to a workspace member's Google Tasks list.
// Each member who completes the OAuth flow at /api/google-tasks-auth
// has a `workspace_members.google_tasks_refresh_token` value; this
// module exchanges that for a short-lived access token and POSTs a
// new task to their @default list.
//
// All entry points are best-effort: a failure here must never block
// the caller (donor-notes route, etc.) because Google Tasks is an
// optional enhancement layer, not a critical write path.

interface CreateTaskInput {
  refreshToken: string;
  title: string;
  notes?: string;
  // ISO 8601 timestamp. Defaults to tomorrow at midnight UTC so the
  // item surfaces in the user's Google Tasks "due tomorrow" bucket.
  dueIso?: string;
}

async function getAccessTokenFromRefresh(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[googleTasks] refresh token exchange failed:', res.status, errText);
      return null;
    }
    const json = await res.json();
    return json.access_token ?? null;
  } catch (err) {
    console.warn('[googleTasks] refresh token exchange threw:', err);
    return null;
  }
}

function tomorrowMidnightUtcIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// Creates a task in the user's @default Google Tasks list. Returns true
// on success, false on any failure (logged, never thrown).
export async function createGoogleTaskForMember(input: CreateTaskInput): Promise<boolean> {
  const accessToken = await getAccessTokenFromRefresh(input.refreshToken);
  if (!accessToken) return false;
  try {
    const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        notes: input.notes,
        due: input.dueIso ?? tomorrowMidnightUtcIso(),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[googleTasks] task create failed:', res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[googleTasks] task create threw:', err);
    return false;
  }
}
