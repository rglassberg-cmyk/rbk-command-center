// Buzz conversational handler — Phase 2 follow-up to the morning
// briefing. Users DM the bot freely; this module builds a permission-
// scoped context bundle (calendar + tasks + module-specific data
// matching what the user is allowed to see), pulls the last 10 turns
// from buzz_conversation_history, sends everything to Claude with a
// strict no-fabrication prompt, and DMs the answer back.
//
// Permission model: every data field is gated by the user's role and
// allowed_modules. If a user doesn't have access to a module, the
// field is omitted from the context bundle entirely and the system
// prompt instructs Claude to say "I don't have access to that data."
//
// Approach: context snapshot, not tool use. This keeps Phase 2 simple
// and predictable — every reply uses the same context shape regardless
// of question. Phase 2.5 will swap in Claude `tool_use` so the model
// can pull on-demand data (e.g. "what was last Tuesday's absence count?"
// without pre-loading historical attendance).

import { supabaseAdmin } from '@/lib/supabase';
import { getValidGoogleToken } from '@/lib/googleToken';
import { BOT_EMOJI, firstNameOf } from '@/lib/buzzBot';
import { generateAllBriefings } from '@/lib/morningBriefing';
import { markMondayItemDone } from '@/lib/mondayActions';

const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
// 2026-06-11: was 'claude-sonnet-4-20250514'. Aligned to the project's
// canonical Sonnet id ('claude-sonnet-4-6', already used by
// app/api/development/draft-thank-you). A wrong/stale model id makes the
// Anthropic call 404 → callClaude throws → Buzz's error fallback. No
// CLAUDE_MODEL / ANTHROPIC_MODEL env var exists, so the id stays in code.
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ET_TZ = 'America/New_York';
const MAX_HISTORY_TURNS = 10;

export interface ConversationMember {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  title: string | null;
  slack_user_id: string;
  allowed_modules: Record<string, unknown> | null;
}

interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location?: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  source: string | null;
  status: string;
}

interface MondayTask {
  id: string;
  name: string;
  dueDate: string | null;
  status: string | null;
  priority: string | null;
  // Column id of the status column on this item's board. Captured at
  // read time so Buzz can write back ("mark done") without re-querying
  // the board schema.
  statusColumnId?: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ─── Helpers (small duplicates of briefing helpers; kept here so
// morning briefing logic is untouched per spec) ────────────────────

function memberHasModule(member: ConversationMember, moduleKey: string): boolean {
  if (member.allowed_modules == null && (member.role === 'owner' || member.role === 'assistant')) {
    return true;
  }
  const mod = (member.allowed_modules as Record<string, unknown> | null)?.[moduleKey];
  if (mod === true) return true;
  if (typeof mod === 'object' && mod && (mod as Record<string, unknown>).enabled === true) return true;
  return false;
}

function todayInET(): { iso: string; label: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find(p => p.type === 'year')!.value);
  const m = Number(parts.find(p => p.type === 'month')!.value);
  const d = Number(parts.find(p => p.type === 'day')!.value);
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(now);
  return { iso, label };
}

function startOfWeekISO(todayIso: string): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const offsetToMonday = (dow + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - offsetToMonday);
  return dt.toISOString().slice(0, 10);
}

// ─── Context fetchers ─────────────────────────────────────────────

async function fetchCalendarThisWeek(member: ConversationMember): Promise<CalendarEvent[]> {
  const token = await getValidGoogleToken(SAR_WORKSPACE_ID, member.email);
  if (!token) return [];
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', now.toISOString());
    url.searchParams.set('timeMax', end.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '50');
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const j = await r.json() as { items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string }> };
    return (j.items || []).slice(0, 20).map(e => ({
      summary: e.summary || 'No title',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location ?? null,
    }));
  } catch {
    return [];
  }
}

async function fetchAllUserTasks(member: ConversationMember): Promise<TaskRow[]> {
  const candidates = [member.email];
  try {
    const { data: m } = await supabaseAdmin
      .from('workspace_members')
      .select('assignee_key')
      .eq('id', member.id)
      .single();
    if (m?.assignee_key) candidates.push(m.assignee_key);
  } catch { /* non-fatal */ }
  if (member.display_name) candidates.push(member.display_name);

  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('id, title, due_date, priority, source, status, assigned_to')
      .eq('workspace_id', SAR_WORKSPACE_ID)
      .in('assigned_to', candidates)
      .not('status', 'in', '(done,archived)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20);
    if (error) return [];
    return (data || []) as TaskRow[];
  } catch {
    return [];
  }
}

async function fetchMondayTasksIfSet(boardId: string | null, todayIso: string): Promise<MondayTask[]> {
  if (!boardId || !boardId.trim()) return [];
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) return [];
  const query = `query {
    boards(ids: [${boardId}]) {
      items_page(limit: 20) {
        items { id name state column_values { id text type } }
      }
    }
  }`;
  try {
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return [];
    const j = await res.json() as {
      data?: { boards?: Array<{ items_page?: { items?: Array<{
        id: string; name: string; state: string;
        column_values?: Array<{ id: string; text: string | null; type?: string }>;
      }> } }> };
      errors?: unknown;
    };
    if (j.errors) return [];
    const items = j.data?.boards?.[0]?.items_page?.items ?? [];
    const parsed: MondayTask[] = [];
    for (const it of items) {
      const state = (it.state || '').toLowerCase();
      if (state === 'done' || state === 'archived' || state === 'deleted') continue;
      const colById: Record<string, string | null> = {};
      let statusColumnId: string | undefined;
      let statusText: string | null = null;
      for (const c of (it.column_values || [])) {
        colById[c.id] = c.text;
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
    parsed.sort((a, b) => {
      const aOver = a.dueDate != null && a.dueDate < todayIso ? 0 : 1;
      const bOver = b.dueDate != null && b.dueDate < todayIso ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      if (a.dueDate !== b.dueDate) {
        if (a.dueDate == null) return 1;
        if (b.dueDate == null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      return 0;
    });
    return parsed.slice(0, 10);
  } catch {
    return [];
  }
}

// ─── Context bundle ───────────────────────────────────────────────

interface ContextBundle {
  name: string;
  role: string;
  title: string;
  todayDate: string;
  myTasks: TaskRow[];
  calendarThisWeek: CalendarEvent[];
  studentAbsencesToday?: number;
  draftsAwaitingReview?: number;
  grantsPendingWire?: { count: number; total: number };
  weeklyGifts?: { total: number; count: number };
  israelFundBalance?: number;
  cooperFundBalance?: number;
  mondayTasks?: MondayTask[];
  // Board id is carried through so the write-back path can target the
  // right Monday board without re-querying the preferences row.
  mondayBoardId?: string;
  preferencesSummary?: string;
}

async function buildContextBundle(member: ConversationMember): Promise<ContextBundle> {
  const { iso, label } = todayInET();

  // Pref row carries monday_board_id + preferences_summary.
  const { data: prefRow } = await supabaseAdmin
    .from('user_briefing_preferences')
    .select('preferences_summary, monday_board_id')
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .eq('email', member.email)
    .maybeSingle();

  const [myTasks, calendarThisWeek, mondayTasks] = await Promise.all([
    fetchAllUserTasks(member),
    fetchCalendarThisWeek(member),
    fetchMondayTasksIfSet(prefRow?.monday_board_id ?? null, iso),
  ]);

  const ctx: ContextBundle = {
    name: member.display_name || member.email,
    role: member.role,
    title: member.title || member.role,
    todayDate: label,
    myTasks,
    calendarThisWeek,
    preferencesSummary: prefRow?.preferences_summary ?? undefined,
  };
  if (mondayTasks.length > 0) ctx.mondayTasks = mondayTasks;
  if (prefRow?.monday_board_id && String(prefRow.monday_board_id).trim()) {
    ctx.mondayBoardId = String(prefRow.monday_board_id).trim();
  }

  // Attendance — owner / assistant
  if (member.role === 'owner' || member.role === 'assistant') {
    try {
      const { count } = await supabaseAdmin
        .from('attendance_cache')
        .select('person_id', { count: 'exact', head: true })
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('attendance_category', 1)
        .eq('date', iso);
      if (count != null) ctx.studentAbsencesToday = count;
    } catch { /* non-fatal */ }
  }

  // Drafts + grants pending wire — assistant (Emily)
  if (member.role === 'assistant') {
    try {
      const { count } = await supabaseAdmin
        .from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .eq('draft_status', 'draft_ready');
      if (count != null) ctx.draftsAwaitingReview = count;
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
        ctx.grantsPendingWire = {
          count: data.length,
          total: data.reduce((s, r: { funding_amount: number }) => s + Number(r.funding_amount || 0), 0),
        };
      }
    } catch { /* non-fatal */ }
  }

  // Development module — weekly gifts + Israel Fund balance + Cooper Fund balance
  if (memberHasModule(member, 'development')) {
    try {
      const weekStart = startOfWeekISO(iso);
      const { data } = await supabaseAdmin
        .from('gifts_cache')
        .select('amount')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .gte('date', weekStart)
        .eq('fundraising_activity', 'Operating 2025-2026')
        .in('gift_type', [1, 3]);
      if (data) {
        ctx.weeklyGifts = {
          count: data.length,
          total: data.reduce((s, r: { amount: number }) => s + Number(r.amount || 0), 0),
        };
      }
    } catch { /* non-fatal */ }

    // Israel Fund balance — raised (External Funds, cash gift types) minus
    // disbursed (israel_fund_grants visible + wire_sent + not denied).
    try {
      const [raisedRes, disbursedRes] = await Promise.all([
        supabaseAdmin
          .from('gifts_cache')
          .select('amount')
          .eq('workspace_id', SAR_WORKSPACE_ID)
          .ilike('fundraising_activity', '%External Funds%')
          .in('gift_type', [1, 3, 5])
          .gt('amount', 0)
          .limit(5000),
        supabaseAdmin
          .from('israel_fund_grants')
          .select('funding_amount')
          .eq('workspace_id', SAR_WORKSPACE_ID)
          .eq('is_visible', true)
          .eq('wire_was_sent', true)
          .eq('grant_not_given', false),
      ]);
      const raised = (raisedRes.data || []).reduce((s, r: { amount: number }) => s + Number(r.amount || 0), 0);
      const disbursed = (disbursedRes.data || []).reduce((s, r: { funding_amount: number }) => s + Number(r.funding_amount || 0), 0);
      ctx.israelFundBalance = raised - disbursed;
    } catch { /* non-fatal */ }

    // Cooper Fund balance — most recent snapshot row's current_balance.
    try {
      const { data } = await supabaseAdmin
        .from('cooper_fund_categories')
        .select('current_balance')
        .eq('workspace_id', SAR_WORKSPACE_ID)
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) ctx.cooperFundBalance = Number(data.current_balance || 0);
    } catch { /* non-fatal */ }
  }

  return ctx;
}

// ─── Prompt builder ───────────────────────────────────────────────

function buildSystemPrompt(name: string, title: string, todayDate: string, ctx: ContextBundle): string {
  // Render the context as a labeled block so Claude can reference it
  // directly. Sections that don't apply (user lacks that module) are
  // simply absent — the model is told explicitly not to fabricate.
  const lines: string[] = [];
  lines.push(`User: ${name} (${title}) · role: ${ctx.role}`);
  lines.push(`Today: ${todayDate}`);

  lines.push('\n# My tasks (open, top 20)');
  if (ctx.myTasks.length === 0) {
    lines.push('(none)');
  } else {
    for (const t of ctx.myTasks) {
      const due = t.due_date ? ` (due ${t.due_date.slice(0, 10)})` : '';
      const pri = t.priority && t.priority !== 'normal' ? ` [${t.priority}]` : '';
      const src = t.source ? ` — ${t.source}` : '';
      // task_id is only used by Buzz's CC write-back marker — never
      // spoken back to the user.
      lines.push(`- ${t.title}${due}${pri}${src} (task_id: ${t.id})`);
    }
  }

  lines.push('\n# Calendar (next 5 days)');
  if (ctx.calendarThisWeek.length === 0) {
    lines.push('(no events)');
  } else {
    for (const e of ctx.calendarThisWeek) {
      lines.push(`- ${e.start} — ${e.summary}${e.location ? ` (${e.location})` : ''}`);
    }
  }

  if (ctx.mondayTasks && ctx.mondayTasks.length > 0) {
    lines.push('\n# Monday.com board (top items)');
    for (const t of ctx.mondayTasks) {
      const due = t.dueDate ? ` (due ${t.dueDate})` : '';
      const pri = t.priority ? ` [${t.priority}]` : '';
      const st = t.status ? ` — ${t.status}` : '';
      // item_id + status_column_id are only used by the write-back
      // marker — Claude must not speak these back to the user.
      const meta = t.statusColumnId
        ? ` (item_id: ${t.id}, status_column_id: ${t.statusColumnId})`
        : ` (item_id: ${t.id})`;
      lines.push(`- ${t.name}${due}${pri}${st}${meta}`);
    }
  }

  if (ctx.studentAbsencesToday != null) {
    lines.push(`\n# Today's student absences: ${ctx.studentAbsencesToday}`);
  }
  if (ctx.draftsAwaitingReview != null) {
    lines.push(`# Drafts waiting for Rabbi Krauss to review: ${ctx.draftsAwaitingReview}`);
  }
  if (ctx.grantsPendingWire) {
    lines.push(`# Israel Fund grants pending wire: ${ctx.grantsPendingWire.count}, total $${ctx.grantsPendingWire.total.toLocaleString()}`);
  }
  if (ctx.weeklyGifts) {
    lines.push(`# Operating gifts this week: ${ctx.weeklyGifts.count}, total $${ctx.weeklyGifts.total.toLocaleString()}`);
  }
  if (ctx.israelFundBalance != null) {
    lines.push(`# Israel Fund balance (raised − disbursed): $${ctx.israelFundBalance.toLocaleString()}`);
  }
  if (ctx.cooperFundBalance != null) {
    lines.push(`# Cooper Fund current balance: $${ctx.cooperFundBalance.toLocaleString()}`);
  }

  lines.push(`\nUser preferences: ${ctx.preferencesSummary || 'Not set'}`);

  return `You are Buzz ${BOT_EMOJI}, the SAR Academy Command Center AI assistant. You help ${name} (${title}) by answering questions about their school data and workflow.

Today is ${todayDate}.

IMPORTANT RULES:
- Only answer questions about data in the context provided. Never make up numbers.
- If you don't have the data to answer, say so clearly and suggest they check the Command Center directly.
- Keep answers concise and actionable.
- Use Slack markdown (*bold*, bullet points).
- Never share data the user shouldn't see — your context already contains only their permitted data.
- If asked about something outside your context (e.g. a module they don't have), say you don't have access to that data.
- Never speak ids (task_id, item_id, status_column_id) back to the user — they're only for the write-back markers below.

MONDAY WRITE-BACK:
If the user asks to mark a Monday item as done, complete, or finished, identify which item they mean from the Monday tasks in context. Respond naturally AND include this exact marker at the very end of your response (nothing after it):
<monday_action>{"action":"mark_done","item_id":"ITEM_ID","item_name":"ITEM_NAME","status_column_id":"COLUMN_ID"}</monday_action>

Only include the marker when you are confident which item the user means and you have its item_id from context. If you cannot identify the specific item, ask the user to clarify instead of guessing.

COMMAND CENTER TASK WRITE-BACK:
If the user asks to mark one of their Command Center tasks (from "# My tasks" above) as done, complete, or finished, include this exact marker at the very end of your response (nothing after it):
<cc_action>{"action":"mark_done","task_id":"UUID","task_name":"NAME"}</cc_action>

Use the task_id from the context. Only include one marker per response. If the user names something that could match either a Monday item or a CC task, ask which they mean.

Current data context:
${lines.join('\n')}`;
}

async function callClaude(args: {
  apiKey: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system: args.system,
      messages: args.messages,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const j = await res.json() as { content?: Array<{ text?: string }> };
  return (j.content || []).map(b => b.text || '').join('').trim();
}

async function sendSlackDM(args: { botToken: string; channel: string; text: string }): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${args.botToken}` },
    body: JSON.stringify({ channel: args.channel, text: args.text, mrkdwn: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as { ok?: boolean }).ok !== true) {
    console.warn('[BUZZ CONVO] Slack postMessage non-ok:', res.status, JSON.stringify(body).slice(0, 300));
  }
}

// ─── Conversation history ─────────────────────────────────────────

async function loadHistory(email: string): Promise<ConversationMessage[]> {
  const { data } = await supabaseAdmin
    .from('buzz_conversation_history')
    .select('messages')
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .eq('email', email)
    .maybeSingle();
  const raw = (data?.messages ?? []) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ConversationMessage => {
    if (!m || typeof m !== 'object') return false;
    const r = (m as { role?: unknown }).role;
    return r === 'user' || r === 'assistant';
  });
}

async function saveHistory(email: string, newMessages: ConversationMessage[]): Promise<void> {
  // Upsert pattern — try update first, insert if no row.
  const now = new Date().toISOString();
  const trimmed = newMessages.slice(-MAX_HISTORY_TURNS);
  const { data: existing } = await supabaseAdmin
    .from('buzz_conversation_history')
    .select('email')
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .eq('email', email)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from('buzz_conversation_history')
      .update({ messages: trimmed, last_message_at: now, updated_at: now })
      .eq('workspace_id', SAR_WORKSPACE_ID)
      .eq('email', email);
  } else {
    await supabaseAdmin
      .from('buzz_conversation_history')
      .insert({ workspace_id: SAR_WORKSPACE_ID, email, messages: trimmed, last_message_at: now });
  }
}

async function deleteHistory(email: string): Promise<void> {
  await supabaseAdmin
    .from('buzz_conversation_history')
    .delete()
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .eq('email', email);
}

// ─── Write-back markers ───────────────────────────────────────────
//
// Phase 2.5: Claude can emit two marker shapes at the end of a reply
// to perform actions. `applyWriteBacks` parses them, executes the
// action, strips the marker from the user-visible reply, and appends
// a status line.
//
// Why a marker pattern rather than Claude `tool_use`? Phase 2 is still
// the single-shot prompt → reply pattern; tool_use would require a
// multi-turn agent loop. Markers let us land write-back without
// rewriting the conversation loop, and they degrade safely — if
// Claude emits an unknown action or malformed JSON, the action is
// skipped and the rest of the reply is preserved.

interface MondayActionPayload {
  action: string;
  item_id: string;
  item_name: string;
  status_column_id: string;
}

interface CCActionPayload {
  action: string;
  task_id: string;
  task_name: string;
}

function parseMarker<T>(reply: string, tag: 'monday_action' | 'cc_action'): { stripped: string; payload: T | null } {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = reply.match(re);
  if (!match) return { stripped: reply, payload: null };
  let payload: T | null = null;
  try {
    payload = JSON.parse(match[1].trim()) as T;
  } catch {
    payload = null;
  }
  const stripped = reply.replace(re, '').trimEnd();
  return { stripped, payload };
}

async function markCommandCenterTaskDone(taskId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('tasks')
      .update({ status: 'done', completed_at: nowIso, updated_at: nowIso })
      .eq('id', taskId)
      .eq('workspace_id', SAR_WORKSPACE_ID);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function applyWriteBacks(reply: string, ctx: ContextBundle): Promise<string> {
  let current = reply;

  // ── Monday write-back ──────────────────────────────────────────
  const monday = parseMarker<MondayActionPayload>(current, 'monday_action');
  current = monday.stripped;
  if (monday.payload && monday.payload.action === 'mark_done') {
    const apiKey = process.env.MONDAY_API_KEY || '';
    const boardId = ctx.mondayBoardId || '';
    const { item_id, item_name, status_column_id } = monday.payload;
    if (!boardId || !item_id || !status_column_id) {
      current += `\n⚠️ Couldn't update Monday automatically — please mark it done there directly.`;
    } else {
      const result = await markMondayItemDone(boardId, item_id, status_column_id, apiKey);
      if (result.success) {
        current += `\n✅ Marked *${item_name}* as done in Monday.com.`;
        // Filter the marked item out of the context's mondayTasks so
        // follow-up logic in this turn doesn't see it.
        if (ctx.mondayTasks) {
          ctx.mondayTasks = ctx.mondayTasks.filter(t => t.id !== item_id);
        }
      } else {
        console.warn('[BUZZ CONVO] Monday mark_done failed:', result.error);
        current += `\n⚠️ Couldn't update Monday automatically — please mark it done there directly.`;
      }
    }
  }

  // ── Command Center task write-back ─────────────────────────────
  const cc = parseMarker<CCActionPayload>(current, 'cc_action');
  current = cc.stripped;
  if (cc.payload && cc.payload.action === 'mark_done' && cc.payload.task_id) {
    const result = await markCommandCenterTaskDone(cc.payload.task_id);
    if (result.success) {
      current += `\n✅ Marked *${cc.payload.task_name}* as done.`;
      ctx.myTasks = ctx.myTasks.filter(t => t.id !== cc.payload!.task_id);
    } else {
      console.warn('[BUZZ CONVO] CC task mark_done failed:', result.error);
      current += `\n⚠️ Couldn't update that task automatically — please mark it done in the Command Center.`;
    }
  }

  return current;
}

// ─── Entry point ──────────────────────────────────────────────────

export async function handleConversationalMessage(
  member: ConversationMember,
  messageText: string,
  workspaceId: string,
  anthropicApiKey: string,
  slackBotToken: string,
  dryRun: boolean,
): Promise<void> {
  void workspaceId; // single-tenant for now; signature reserved for SaaS expansion
  const firstName = firstNameOf(member.display_name, member.email);
  const lowered = messageText.trim().toLowerCase();

  // ── Special commands ──────────────────────────────────────────
  if (lowered === 'reset') {
    await deleteHistory(member.email);
    const text = `Conversation cleared. Fresh start! ${BOT_EMOJI}`;
    if (dryRun) {
      console.log('[BUZZ CONVO RESET - DRY RUN] To:', member.email, '\n', text);
    } else if (slackBotToken) {
      await sendSlackDM({ botToken: slackBotToken, channel: member.slack_user_id, text });
    }
    return;
  }

  if (lowered === 'briefing') {
    // On-demand briefing for this single user. forceWeekend so the
    // request works any day; dryRun: false so the briefing actually
    // sends; singleUserEmail to bypass the test-mode allowlist + scope
    // the run to just this user.
    try {
      await generateAllBriefings({
        dryRun: false,
        forceWeekend: true,
        singleUserEmail: member.email,
      });
    } catch (err) {
      console.error('[BUZZ CONVO BRIEFING] failed:', err);
      if (!dryRun && slackBotToken) {
        await sendSlackDM({
          botToken: slackBotToken,
          channel: member.slack_user_id,
          text: `Hmm, I couldn't pull your briefing just now. Try again in a minute? ${BOT_EMOJI}`,
        });
      }
    }
    return;
  }

  // ── Regular Q&A path ──────────────────────────────────────────
  // Per-stage logging (2026-06-11): the single catch below collapses
  // every failure mode into one opaque user message, which made prod
  // failures undiagnosable. The stage labels around each major await let
  // us see in Cloud Run logs exactly where a failing turn died.
  try {
    console.log('[BUZZ CONVO] building context...');
    console.log('[BUZZ CONVO] loading history...');
    const [ctx, history] = await Promise.all([
      buildContextBundle(member).then(c => { console.log('[BUZZ CONVO] context built'); return c; }),
      loadHistory(member.email).then(h => { console.log('[BUZZ CONVO] history loaded'); return h; }),
    ]);
    const system = buildSystemPrompt(firstName, ctx.title, ctx.todayDate, ctx);
    const claudeMessages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: messageText },
    ];
    console.log('[BUZZ CONVO] calling Claude...');
    const rawReply = await callClaude({ apiKey: anthropicApiKey, system, messages: claudeMessages });
    console.log('[BUZZ CONVO] Claude responded');

    // Parse write-back markers, execute the action, strip the marker
    // from the user-visible reply, and append a confirmation line.
    const finalReply = await applyWriteBacks(rawReply, ctx);

    if (dryRun) {
      console.log('[BUZZ CONVO - DRY RUN] From:', member.email, '\nUser:', messageText, '\nReply:', finalReply, '\n---');
    } else if (slackBotToken) {
      await sendSlackDM({ botToken: slackBotToken, channel: member.slack_user_id, text: finalReply });
    }

    // Persist history regardless of dryRun so previewing builds up
    // realistic transcripts. Store the user-visible reply (markers
    // already stripped) so future turns don't re-trigger actions.
    //
    // saveHistory runs AFTER the DM is already sent — wrap it in its own
    // try/catch so a persistence failure can't bubble to the main catch
    // and send the user a SECOND "Something's off" message on top of the
    // answer they already received. History loss is non-fatal.
    const nowIso = new Date().toISOString();
    const updated: ConversationMessage[] = [
      ...history,
      { role: 'user', content: messageText, timestamp: nowIso },
      { role: 'assistant', content: finalReply, timestamp: nowIso },
    ];
    try {
      console.log('[BUZZ CONVO] saving history...');
      await saveHistory(member.email, updated);
    } catch (saveErr) {
      console.error('[BUZZ CONVO] saveHistory failed (non-fatal):', saveErr);
      // do not rethrow — user already received their answer
    }
  } catch (err) {
    console.error('[BUZZ CONVO] handler failed at unknown stage:', err instanceof Error ? err.message : String(err), err);
    if (!dryRun && slackBotToken) {
      await sendSlackDM({
        botToken: slackBotToken,
        channel: member.slack_user_id,
        text: `Something's off on my end — give me a moment and try again. ${BOT_EMOJI}`,
      });
    }
  }
}
