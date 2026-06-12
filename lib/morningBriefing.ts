// Morning Briefing Phase 1 + Phase 2 onboarding.
//
// `generateAllBriefings({ dryRun })` is the shared entry point called by
// both the admin preview endpoint (`app/api/slack/morning-briefing/preview`)
// and the Cloud Function trigger (`generateMorningBriefings` →
// `app/api/slack/morning-briefing-internal`). The DRY_RUN flag is the
// hard kill switch: while it's true, NOTHING posts to Slack — every
// message path is gated to console-log only.
//
// Default DRY_RUN = true. Becca flips it to false in this file only
// after reviewing preview output and approving live sends.
//
// Phase 2 layered on top: each member is checked against
// `user_briefing_preferences`. If onboarding isn't complete the user
// receives the intro DM instead of a briefing (logged in dry run),
// and the row gets `onboarding_sent_at = now()`. Once onboarding is
// complete, the saved `preferences_summary` is injected into the
// Claude prompt so the briefing respects what the user asked for.

import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';
import { getIntegration } from '@/lib/getIntegration';
import { BOT_EMOJI, BOT_NAME, BUZZ_TEST_MODE, BUZZ_TEST_USERS, ONBOARDING_MESSAGE, firstNameOf } from '@/lib/buzzBot';

// HARD KILL SWITCH — must stay `true` until Becca reviews preview
// output and approves. Cloud Function schedule is also commented out
// in functions/src/index.ts as a second layer of safety.
export const DRY_RUN = false;

// SAR's primary workspace. The briefing run is single-tenant for now —
// when a second workspace adopts Buzz we'll loop here instead.
const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Claude model used for both briefing synthesis and onboarding
// preference summarization.
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const ET_TZ = 'America/New_York';

interface MemberRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  slack_user_id: string | null;
  title: string | null;
  divisions: string[] | null;
  allowed_modules: Record<string, unknown> | null;
}

interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location?: string | null;
}

interface TaskRow {
  title: string;
  due_date: string | null;
  priority: string;
  source: string | null;
  status: string;
}

interface MondayTask {
  id: string;
  name: string;
  dueDate: string | null;     // YYYY-MM-DD when parsable
  status: string | null;
  priority: string | null;
  // Column id of the status column on this item's board. Captured at
  // read time so Buzz can write back ("mark done") without re-querying
  // the board schema. Optional because some boards may not surface a
  // status column at all.
  statusColumnId?: string;
}

interface ModuleData {
  studentAbsencesToday?: number;
  draftsAwaitingReview?: number;
  grantsPendingWire?: { count: number; total: number };
  weeklyGifts?: { count: number; total: number };
  enrollment?: { totalEnrolled: number; totalPending: number };
  // Per-user Monday.com board pulldown — only populated when the user
  // has `monday_board_id` set on their user_briefing_preferences row.
  // Top 5 by overdue → due date → priority. See fetchMondayTasks.
  mondayTasks?: MondayTask[];
}

export interface BriefingResult {
  userId: string;
  name: string;
  email: string;
  slackUserId: string;
  // 'briefing' = a synthesized morning briefing was produced (and sent
  // if not dry-run). 'onboarding' = the user got the intro DM instead
  // because their preference row isn't onboarded yet. 'skipped' = no
  // Slack ID, or an error during generation.
  kind: 'briefing' | 'onboarding' | 'skipped';
  message: string;
  moduleDataSummary: Record<string, unknown>;
  calendarEventCount: number;
  taskCount: number;
  preferencesUsed?: string;
  onboardingJustSent: boolean;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────

// Today's date in ET — start/end ISO timestamps for Calendar query,
// plus a long-form label used in the Claude prompt and greeting.
function todayWindowET(): { startIso: string; endIso: string; label: string; iso: string } {
  const now = new Date();
  // Get today's date in ET as YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year')!.value);
  const month = Number(parts.find(p => p.type === 'month')!.value);
  const day = Number(parts.find(p => p.type === 'day')!.value);
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Build start-of-day and end-of-day in ET as UTC instants.
  // ET is UTC-5 (EST) or UTC-4 (EDT). We'll compute the offset by
  // diffing the same instant under ET vs UTC.
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const etStr = noonUtc.toLocaleString('en-US', { timeZone: ET_TZ, hour12: false });
  // etStr looks like "6/5/2026, 08:00:00" → 8 means UTC-4 (EDT).
  const etHourMatch = etStr.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  const etHour = etHourMatch ? parseInt(etHourMatch[1], 10) : 12;
  const offsetHours = 12 - etHour; // UTC - ET hours
  const startIso = new Date(Date.UTC(year, month - 1, day, offsetHours, 0, 0)).toISOString();
  const endIso = new Date(Date.UTC(year, month - 1, day + 1, offsetHours, 0, 0)).toISOString();

  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(now);

  return { startIso, endIso, label, iso };
}

// Does the member have access to a given module? Owners + assistants
// with `allowed_modules = null` get everything (the SaaS shortcut);
// otherwise check the explicit allowed_modules object.
function memberHasModule(member: MemberRow, moduleKey: string): boolean {
  if (member.allowed_modules == null && (member.role === 'owner' || member.role === 'assistant')) {
    return true;
  }
  const mod = (member.allowed_modules as Record<string, unknown> | null)?.[moduleKey];
  if (mod === true) return true;
  if (typeof mod === 'object' && mod && (mod as Record<string, unknown>).enabled === true) return true;
  return false;
}

async function fetchCalendar(member: MemberRow, startIso: string, endIso: string): Promise<CalendarEvent[]> {
  const token = await getValidGoogleToken(SAR_WORKSPACE_ID, member.email);
  if (!token) return [];
  try {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', startIso);
    url.searchParams.set('timeMax', endIso);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      console.warn('[MORNING BRIEFING] Calendar fetch non-ok for', member.email, r.status);
      return [];
    }
    const j = await r.json() as { items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }> };
    return (j.items || []).map(e => ({
      summary: e.summary || 'No title',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location ?? null,
    }));
  } catch (err) {
    console.warn('[MORNING BRIEFING] Calendar fetch failed for', member.email, err);
    return [];
  }
}

async function fetchTasks(member: MemberRow, todayIso: string): Promise<{ overdue: TaskRow[]; dueToday: TaskRow[] }> {
  // tasks.assigned_to is a free-text string. The dashboard's task
  // routing uses `assignee_key`-style values, but historically the row
  // can carry an email or a display name too. We match the broadest
  // reasonable set: assignee_key, email, or display_name.
  const candidates = [member.email];
  // Look up assignee_key from the members table — cheap second roundtrip
  // is fine here since the briefing runs per-user.
  try {
    const { data: m } = await supabaseAdmin
      .from('workspace_members')
      .select('assignee_key')
      .eq('id', member.id)
      .single();
    if (m?.assignee_key) candidates.push(m.assignee_key);
  } catch { /* non-fatal */ }
  if (member.display_name) candidates.push(member.display_name);

  // Today's ET cutoff in ISO so a midnight-Z due_date for tomorrow
  // doesn't get pulled in. due_date is timestamptz; we compare
  // against end-of-day ET.
  const endOfDayET = `${todayIso}T23:59:59-04:00`;

  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('title, due_date, priority, source, status, assigned_to')
      .eq('workspace_id', SAR_WORKSPACE_ID)
      .in('assigned_to', candidates)
      .not('status', 'in', '(done,archived)')
      .or(`due_date.lte.${endOfDayET},priority.eq.urgent`)
      .order('due_date', { ascending: true })
      .limit(20);
    if (error) {
      console.warn('[MORNING BRIEFING] Tasks query failed for', member.email, error);
      return { overdue: [], dueToday: [] };
    }
    const overdue: TaskRow[] = [];
    const dueToday: TaskRow[] = [];
    const todayCmp = todayIso;
    for (const t of (data || []) as TaskRow[]) {
      if (!t.due_date) {
        if (t.priority === 'urgent') dueToday.push(t);
        continue;
      }
      const dueDay = t.due_date.slice(0, 10);
      if (dueDay < todayCmp) overdue.push(t);
      else if (dueDay === todayCmp) dueToday.push(t);
    }
    return { overdue, dueToday };
  } catch (err) {
    console.warn('[MORNING BRIEFING] Tasks exception for', member.email, err);
    return { overdue: [], dueToday: [] };
  }
}

async function fetchModuleData(member: MemberRow, todayIso: string): Promise<ModuleData> {
  const out: ModuleData = {};

  // Owners + assistants get attendance + draft + grants color.
  if (member.role === 'owner' || member.role === 'assistant') {
    try {
      // attendance_category is INT (1=absent) — schema-verified.
      const { count } = await supabaseAdmin
        .from('attendance_cache')
        .select('person_id', { count: 'exact', head: true })
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('attendance_category', 1)
        .eq('date', todayIso);
      if (count != null) out.studentAbsencesToday = count;
    } catch { /* non-fatal */ }
  }

  if (member.role === 'assistant') {
    try {
      const { count } = await supabaseAdmin
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('draft_status', 'draft_ready');
      if (count != null) out.draftsAwaitingReview = count;
    } catch { /* non-fatal */ }

    try {
      const { data } = await supabaseAdmin
        .from('israel_fund_grants')
        .select('funding_amount')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('wire_was_sent', false)
        .eq('grant_not_given', false)
        .eq('is_visible', true)
        .gt('funding_amount', 0);
      if (data) {
        out.grantsPendingWire = {
          count: data.length,
          total: data.reduce((s, r: { funding_amount: number }) => s + Number(r.funding_amount || 0), 0),
        };
      }
    } catch { /* non-fatal */ }
  }

  if (memberHasModule(member, 'development')) {
    // This week's operating gifts. Use a paginated select since the
    // `count: 'exact', head: true` pattern can't return SUM.
    try {
      const [yy, mm, dd] = todayIso.split('-').map(Number);
      const sevenDaysAgo = new Date(Date.UTC(yy, mm - 1, dd - 7)).toISOString().slice(0, 10);
      const { data } = await supabaseAdmin
        .from('gifts_cache')
        .select('amount')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .gte('date', sevenDaysAgo);
      if (data) {
        out.weeklyGifts = {
          count: data.length,
          total: data.reduce((s, r: { amount: number }) => s + Number(r.amount || 0), 0),
        };
      }
    } catch { /* non-fatal */ }
  }

  // Admissions stat is intentionally not duplicated here — the
  // existing /api/admissions route does heavy paginated Veracross
  // pulls. For Phase 1, we omit live enrollment numbers to keep
  // briefing latency under control. Add it later when there's a
  // cached snapshot to pull from.

  return out;
}

// Per-user Monday.com board pull. Returns the top 5 not-done items
// sorted by overdue → due date asc → priority. Returns [] on any
// failure (missing API key, GraphQL error, parse error) — Monday
// should never break the rest of the briefing. Skipped entirely
// (caller doesn't invoke us) when the user has no `monday_board_id`.
//
// Column ids checked: `date4` and `due_date` for due date (Monday
// boards inconsistently use one or the other); `status` for status
// text; `priority` for priority text. We tolerate whichever shape
// the board uses without configuration per board.
async function fetchMondayTasks(boardId: string, todayIso: string): Promise<MondayTask[]> {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) {
    console.warn('[BUZZ MONDAY] MONDAY_API_KEY not set — skipping board', boardId);
    return [];
  }
  // `type` on column_values lets us identify status columns by type
  // (legacy boards use `color`, newer ones use `status`). Combined with
  // an id-includes-'status' check it covers the common variants without
  // needing per-board configuration. Captured as statusColumnId on each
  // task so the conversational write-back can target the right column.
  const query = `query {
    boards(ids: [${boardId}]) {
      items_page(limit: 20) {
        items {
          id
          name
          state
          column_values { id text type }
        }
      }
    }
  }`;
  try {
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      console.warn('[BUZZ MONDAY] non-ok', res.status, 'for board', boardId);
      return [];
    }
    const j = await res.json() as {
      data?: { boards?: Array<{ items_page?: { items?: Array<{
        id: string;
        name: string;
        state: string;
        column_values?: Array<{ id: string; text: string | null; type?: string }>;
      }> } }> };
      errors?: unknown;
    };
    if (j.errors) {
      console.warn('[BUZZ MONDAY] GraphQL errors:', JSON.stringify(j.errors).slice(0, 300));
      return [];
    }
    const items = j.data?.boards?.[0]?.items_page?.items ?? [];

    const parsed: MondayTask[] = [];
    for (const it of items) {
      const state = (it.state || '').toLowerCase();
      if (state === 'done' || state === 'archived' || state === 'deleted') continue;
      const cols = it.column_values || [];
      const colById: Record<string, string | null> = {};
      let statusColumnId: string | undefined;
      let statusText: string | null = null;
      for (const c of cols) {
        colById[c.id] = c.text;
        // First column matching status-by-id or status-by-type wins. `color`
        // is the legacy Monday type; `status` is the modern one.
        if (!statusColumnId && (c.id.includes('status') || c.type === 'color' || c.type === 'status')) {
          statusColumnId = c.id;
          statusText = c.text;
        }
      }

      const dueRaw = colById['date4'] || colById['due_date'] || null;
      const due = dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw.slice(0, 10)) ? dueRaw.slice(0, 10) : null;
      parsed.push({
        id: it.id,
        name: it.name,
        dueDate: due,
        status: statusText ?? colById['status'] ?? null,
        priority: colById['priority'] ?? null,
        statusColumnId,
      });
    }

    // Sort: overdue first, then due date asc (nulls last), then by
    // priority text (High → Medium → Low → other).
    const priorityRank = (p: string | null): number => {
      const s = (p || '').toLowerCase();
      if (s.startsWith('high') || s.includes('critical') || s.includes('urgent')) return 0;
      if (s.startsWith('med') || s.startsWith('mid')) return 1;
      if (s.startsWith('low')) return 2;
      return 3;
    };
    parsed.sort((a, b) => {
      const aOverdue = a.dueDate != null && a.dueDate < todayIso ? 0 : 1;
      const bOverdue = b.dueDate != null && b.dueDate < todayIso ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      if (a.dueDate !== b.dueDate) {
        if (a.dueDate == null) return 1;
        if (b.dueDate == null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return priorityRank(a.priority) - priorityRank(b.priority);
    });

    return parsed.slice(0, 5);
  } catch (err) {
    console.warn('[BUZZ MONDAY] fetch failed for board', boardId, err);
    return [];
  }
}

function startOfWeekISO(todayIso: string): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sun
  const offsetToMonday = (dow + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - offsetToMonday);
  return dt.toISOString().slice(0, 10);
}

// ─── Claude prompt builder ────────────────────────────────────────

function formatTime(iso: string): string {
  if (!iso) return '';
  if (!iso.includes('T')) return iso; // all-day
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { timeZone: ET_TZ, hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

function buildClaudePrompt(args: {
  member: MemberRow;
  firstName: string;
  todayLabel: string;
  calendar: CalendarEvent[];
  tasks: { overdue: TaskRow[]; dueToday: TaskRow[] };
  modules: ModuleData;
  preferences?: string;
}): { system: string; user: string } {
  const { member, firstName, todayLabel, calendar, tasks, modules, preferences } = args;

  const system = `You are ${BOT_NAME}, the SAR Academy AI assistant. Generate a warm, concise morning briefing for a staff member. Be friendly but efficient. Use their first name. Format for Slack: use *bold* for section headers, plain text for content. Emoji sparingly — one per section max. Keep the whole message under 300 words. Do not include a subject line or greeting beyond their name. Today is ${todayLabel}.`;

  const calBlock = calendar.length === 0
    ? 'No events scheduled.'
    : calendar.map(e => `• ${formatTime(e.start)} — ${e.summary}${e.location ? ` (${e.location})` : ''}`).join('\n');

  const taskLines: string[] = [];
  if (tasks.overdue.length === 0 && tasks.dueToday.length === 0) {
    taskLines.push('All clear on tasks.');
  } else {
    for (const t of tasks.overdue) taskLines.push(`• OVERDUE — ${t.title}${t.priority === 'urgent' ? ' (urgent)' : ''}`);
    for (const t of tasks.dueToday) taskLines.push(`• ${t.title}${t.priority === 'urgent' ? ' (urgent)' : ''}`);
  }

  const moduleLines: string[] = [];
  if (modules.studentAbsencesToday != null) moduleLines.push(`Student attendance: ${modules.studentAbsencesToday} absences recorded so far today.`);
  if (modules.draftsAwaitingReview && modules.draftsAwaitingReview > 0) moduleLines.push(`${modules.draftsAwaitingReview} email draft(s) waiting for Rabbi Krauss to review.`);
  if (modules.grantsPendingWire && modules.grantsPendingWire.count > 0) {
    moduleLines.push(`${modules.grantsPendingWire.count} Israel Fund grant(s) pending wire, totaling $${modules.grantsPendingWire.total.toLocaleString()}.`);
  }
  if (modules.weeklyGifts && modules.weeklyGifts.total > 0) {
    moduleLines.push(`This week: ${modules.weeklyGifts.count} gift(s) totaling $${modules.weeklyGifts.total.toLocaleString()} in operating gifts.`);
  }

  const mondayBlock = (modules.mondayTasks && modules.mondayTasks.length > 0)
    ? `Monday.com to-do board (top items):\n${modules.mondayTasks.map(t => {
        const due = t.dueDate ? ` (due ${t.dueDate})` : '';
        const pri = t.priority ? ` [${t.priority}]` : '';
        return `• ${t.name}${due}${pri}`;
      }).join('\n')}\n(Per user preference: focus on the top 3 most timely and important)`
    : '';

  const user = `Generate a morning briefing for ${firstName}, ${member.title || member.role} at SAR Academy.

Today's calendar:
${calBlock}

Tasks needing attention:
${taskLines.join('\n')}

${mondayBlock ? mondayBlock + '\n\n' : ''}${moduleLines.length > 0 ? moduleLines.join('\n') + '\n' : ''}${preferences ? `User's stated preferences: ${preferences}\nKeep these preferences in mind when structuring the briefing.\n` : ''}
Keep the tone warm and practical. This is their first look at the day.`;

  return { system, user };
}

// ─── Claude call ──────────────────────────────────────────────────

async function callClaude(args: { apiKey: string; system: string; user: string; maxTokens?: number }): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: args.maxTokens ?? 500,
      system: args.system,
      messages: [{ role: 'user', content: args.user }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const j = await res.json() as { content?: Array<{ text?: string }> };
  const blocks = j.content || [];
  return blocks.map(b => b.text || '').join('').trim();
}

// ─── Slack DM helper ──────────────────────────────────────────────

async function sendSlackDM(args: { botToken: string; channel: string; text: string }): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${args.botToken}`,
    },
    body: JSON.stringify({ channel: args.channel, text: args.text, mrkdwn: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok !== true) {
    throw new Error(`Slack postMessage failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
}

// Claude-based summarizer for onboarding free-text replies. Used by
// the Slack events webhook too — exported so the route can call it
// without re-implementing the prompt.
export async function summarizeOnboardingReply(apiKey: string, raw: string): Promise<string> {
  const system = "You are summarizing a user's stated preference for how they want to receive morning briefings at work. Extract 1-2 sentences capturing: what they want to know, in what format, and any priorities they mentioned. Be concise and factual.";
  return callClaude({ apiKey, system, user: raw, maxTokens: 200 });
}

// ─── Entry point ──────────────────────────────────────────────────

export async function generateAllBriefings(
  // `singleUserEmail` lets the conversational handler trigger an
  // on-demand briefing for one user without changing any other
  // behavior — when set, the member query is narrowed and the
  // BUZZ_TEST_MODE allowlist is bypassed so a user with a Slack ID
  // can always ask for their own briefing.
  opts: { dryRun: boolean; forceWeekend?: boolean; singleUserEmail?: string },
): Promise<BriefingResult[]> {
  // Weekend skip — preview endpoint passes forceWeekend so Becca can
  // see what the run looks like any day. The Cloud Function trigger
  // and internal endpoint do NOT pass it, so the scheduled job
  // silently no-ops on Sat/Sun.
  const dayOfWeek = new Date().getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend && !opts.forceWeekend) {
    console.log('[BUZZ] Weekend — skipping briefings. Pass forceWeekend: true to override.');
    return [];
  }

  const effectiveDryRun = opts.dryRun || DRY_RUN; // preview always forces dryRun

  // Test mode — log loudly so it's impossible to miss in the run logs.
  if (BUZZ_TEST_MODE) {
    console.log('[BUZZ] Test mode active — sending to:', BUZZ_TEST_USERS.join(', '));
  }

  // Pull credentials. Anthropic is required (briefing won't generate
  // without it); Slack only matters when we'd actually send.
  const anthropic = await getIntegration(SAR_WORKSPACE_ID, 'anthropic');
  const anthropicKey = anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const slack = await getIntegration(SAR_WORKSPACE_ID, 'slack');
  const slackToken = slack?.botToken || process.env.SLACK_BOT_TOKEN || '';

  if (!anthropicKey) {
    throw new Error('Missing Anthropic API key — set in workspace_integrations.anthropic or ANTHROPIC_API_KEY env');
  }

  // Load members with a Slack ID set.
  let memberQuery = supabaseAdmin
    .from('workspace_members')
    .select('id, email, display_name, role, slack_user_id, title, divisions, allowed_modules')
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .not('slack_user_id', 'is', null);
  if (opts.singleUserEmail) {
    memberQuery = memberQuery.eq('email', opts.singleUserEmail);
  }
  const { data: members, error: membersError } = await memberQuery;

  if (membersError) {
    throw new Error(`Failed to load members: ${membersError.message}`);
  }

  // Apply BUZZ_TEST_MODE allowlist after the DB filter so the test
  // gate is the last thing that runs — easier to flip off without
  // touching the query. Single-user mode bypasses the allowlist so
  // a user can always trigger their own briefing on demand.
  const eligibleMembers = (BUZZ_TEST_MODE && !opts.singleUserEmail)
    ? (members || []).filter(m => BUZZ_TEST_USERS.includes(m.email))
    : (members || []);

  const window = todayWindowET();
  const results: BriefingResult[] = [];

  for (const member of eligibleMembers as MemberRow[]) {
    const firstName = firstNameOf(member.display_name, member.email);
    try {
      // Phase 2: check onboarding status. Missing row OR
      // onboarding_complete=false → send intro instead of briefing.
      const { data: prefRow } = await supabaseAdmin
        .from('user_briefing_preferences')
        .select('email, onboarding_complete, preferences_summary, onboarding_sent_at, monday_board_id')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('email', member.email)
        .maybeSingle();

      if (!prefRow || !prefRow.onboarding_complete) {
        const introText = ONBOARDING_MESSAGE(firstName);

        // Upsert pref row marking onboarding_sent_at so we don't spam.
        if (!prefRow) {
          await supabaseAdmin
            .from('user_briefing_preferences')
            .insert({
              workspace_id: SAR_WORKSPACE_ID,
              email: member.email,
              onboarding_sent_at: new Date().toISOString(),
              onboarding_complete: false,
            });
        } else {
          await supabaseAdmin
            .from('user_briefing_preferences')
            .update({
              onboarding_sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('workspace_id', SAR_WORKSPACE_ID)
            .eq('email', member.email);
        }

        if (effectiveDryRun) {
          console.log('[BUZZ ONBOARDING - DRY RUN]');
          console.log('To:', member.display_name, '(', member.slack_user_id, ')');
          console.log('Message:\n', introText);
          console.log('---');
        } else {
          if (!slackToken) throw new Error('Missing Slack bot token');
          await sendSlackDM({ botToken: slackToken, channel: member.slack_user_id!, text: introText });
        }

        results.push({
          userId: member.id,
          name: member.display_name || member.email,
          email: member.email,
          slackUserId: member.slack_user_id!,
          kind: 'onboarding',
          message: introText,
          moduleDataSummary: {},
          calendarEventCount: 0,
          taskCount: 0,
          onboardingJustSent: true,
        });
        continue;
      }

      // Onboarding complete — generate the real briefing.
      const calendar = await fetchCalendar(member, window.startIso, window.endIso);
      const tasks = await fetchTasks(member, window.iso);
      const modules = await fetchModuleData(member, window.iso);

      // Per-user Monday board pulldown — only if a board ID is set on
      // the pref row. Failures are swallowed by fetchMondayTasks so a
      // Monday outage never breaks the briefing.
      if (prefRow.monday_board_id && String(prefRow.monday_board_id).trim()) {
        modules.mondayTasks = await fetchMondayTasks(String(prefRow.monday_board_id).trim(), window.iso);
      }

      const prompt = buildClaudePrompt({
        member,
        firstName,
        todayLabel: window.label,
        calendar,
        tasks,
        modules,
        preferences: prefRow.preferences_summary ?? undefined,
      });
      const messageText = await callClaude({ apiKey: anthropicKey, system: prompt.system, user: prompt.user });

      if (effectiveDryRun) {
        console.log('[MORNING BRIEFING - DRY RUN]');
        console.log('To:', member.display_name, '(', member.slack_user_id, ')');
        console.log('Message:\n' + messageText);
        console.log('---');
      } else {
        if (!slackToken) throw new Error('Missing Slack bot token');
        await sendSlackDM({ botToken: slackToken, channel: member.slack_user_id!, text: messageText });
      }

      results.push({
        userId: member.id,
        name: member.display_name || member.email,
        email: member.email,
        slackUserId: member.slack_user_id!,
        kind: 'briefing',
        message: messageText,
        moduleDataSummary: {
          studentAbsencesToday: modules.studentAbsencesToday,
          draftsAwaitingReview: modules.draftsAwaitingReview,
          grantsPendingWire: modules.grantsPendingWire,
          weeklyGifts: modules.weeklyGifts,
          mondayTasksCount: modules.mondayTasks?.length ?? 0,
        },
        calendarEventCount: calendar.length,
        taskCount: tasks.overdue.length + tasks.dueToday.length,
        preferencesUsed: prefRow.preferences_summary ?? undefined,
        onboardingJustSent: false,
      });
    } catch (err) {
      console.error('[MORNING BRIEFING] Failed for', member.email, err);
      results.push({
        userId: member.id,
        name: member.display_name || member.email,
        email: member.email,
        slackUserId: member.slack_user_id || '',
        kind: 'skipped',
        message: '',
        moduleDataSummary: {},
        calendarEventCount: 0,
        taskCount: 0,
        onboardingJustSent: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`[MORNING BRIEFING] Done. ${results.length} results — dryRun=${effectiveDryRun}, botName=${BOT_NAME} ${BOT_EMOJI}`);
  return results;
}
