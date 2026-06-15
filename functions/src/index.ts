import * as functions from 'firebase-functions';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { PubSub } from '@google-cloud/pubsub';

// ---------------------------------------------------------------------------
// Manual triage trigger — HTTP endpoint called by the Sync Gmail button
// ---------------------------------------------------------------------------
exports.manualTriage = functions.https.onRequest(async (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const pubsub = new PubSub();
    await pubsub.topic('firebase-schedule-triageGmail-us-central1').publishMessage({ data: Buffer.from('manual') });
    res.json({ success: true });
  } catch (err: any) {
    console.error('manualTriage error:', err);
    res.status(500).json({ success: false, error: err.message || 'Unknown error' });
  }
});

// ---------------------------------------------------------------------------
// Manual sync drafts trigger — HTTP endpoint for on-demand draft sync
// ---------------------------------------------------------------------------
exports.manualSyncDrafts = functions.https.onRequest(async (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const pubsub = new PubSub();
    await pubsub.topic('firebase-schedule-syncDraftsReady-us-central1').publishMessage({ data: Buffer.from('manual') });
    res.json({ success: true });
  } catch (err: any) {
    console.error('manualSyncDrafts error:', err);
    res.status(500).json({ success: false, error: err.message || 'Unknown error' });
  }
});

// ---------------------------------------------------------------------------
// Buzz — Morning Briefings (Slack AI Assistant Phase 1)
// ---------------------------------------------------------------------------
// HTTP-callable Cloud Function. The scheduler is DELIBERATELY commented
// out until Becca reviews preview output via /api/slack/morning-briefing/preview
// and flips DRY_RUN to false in lib/morningBriefing.ts. While DRY_RUN is
// true, this function calls the internal endpoint which short-circuits
// all Slack sends to console logs — so the function is safe to invoke
// manually for end-to-end smoke testing.
//
// To enable scheduled sends after approval:
//   1. Confirm DRY_RUN = false in lib/morningBriefing.ts
//   2. Uncomment the scheduler block below
//   3. Redeploy: `firebase deploy --only functions:scheduledMorningBriefings`
exports.generateMorningBriefings = functions.https.onRequest(async (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-internal-secret');
  if (_req.method === 'OPTIONS') { res.status(204).send(''); return; }
  try {
    const response = await fetch(
      'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/morning-briefing-internal',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
        },
      },
    );
    const data = await response.json();
    console.log('[BUZZ FN] generateMorningBriefings result:', JSON.stringify(data).slice(0, 1000));
    res.json(data);
  } catch (err: any) {
    console.error('[BUZZ FN] failed:', err);
    res.status(500).json({ success: false, error: err.message || 'Unknown error' });
  }
});

// Scheduled morning briefing — 7:30am ET on school days.
// DRY_RUN flipped to false 2026-06-05 (rev 00604-48l follow-up) after
// preview review by Becca; BUZZ_TEST_MODE in lib/buzzBot.ts still
// restricts deliveries to Becca + Emily until full rollout is approved.
exports.scheduledMorningBriefings = functions.pubsub
  .schedule('30 7 * * 1-5') // 7:30am ET school days
  .timeZone('America/New_York')
  .onRun(async () => {
    const response = await fetch(
      'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/morning-briefing-internal',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
        },
      },
    );
    console.log('[BUZZ SCHEDULED] status:', response.status);
    return null;
  });

// ---------------------------------------------------------------------------
// Existing: Daily attendance sync
// ---------------------------------------------------------------------------
exports.syncDailyAttendance = functions.pubsub
  .schedule('0 23 * * 1-5')
  .timeZone('America/New_York')
  .onRun(async () => {
    const res = await fetch('https://rbk-cmd-center.web.app/api/absences/sync?mode=daily', {
      headers: { Authorization: 'Bearer rbk-sync-2026' },
    });
    const data = await res.json();
    console.log('Daily attendance sync:', data);
    return null;
  });

// ---------------------------------------------------------------------------
// After School Programs sync — daily at 7am ET. Pulls Veracross programs
// courses/classes/enrollments into the after_school_*_cache tables.
// ---------------------------------------------------------------------------
exports.syncAfterSchoolPrograms = functions.pubsub
  .schedule('0 7 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    const res = await fetch(
      'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/after-school/sync',
      {
        method: 'POST',
        headers: {
          'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
          'X-Workspace-Id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          'Content-Type': 'application/json',
        },
      }
    );
    const data = await res.json();
    console.log('After School sync:', data);
    return null;
  });

// ---------------------------------------------------------------------------
// Gifts sync — hourly on weekdays, daily on weekends
// ---------------------------------------------------------------------------

async function runGiftsSyncForAllWorkspaces() {
  console.log('[GIFTS SYNC] Starting scheduled sync');

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, modules');

  const targetWorkspaces = (workspaces || []).filter(
    (w: { modules?: Record<string, boolean> | null }) => w.modules?.development === true
  );

  console.log('[GIFTS SYNC] Found', targetWorkspaces.length, 'workspaces with development module');

  for (const workspace of targetWorkspaces) {
    try {
      const response = await fetch(
        'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/development/sync-gifts-internal',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
            'X-Workspace-Id': workspace.id,
          },
        }
      );

      const result = await response.json();
      console.log('[GIFTS SYNC] Workspace', workspace.name, 'result:', JSON.stringify(result));
    } catch (error) {
      console.error('[GIFTS SYNC] Failed for workspace', workspace.id, error);
    }

    // Chain constituents sync after gifts. Independent failure mode —
    // a gifts success + constituents failure still leaves the page
    // working from the prior constituents_cache rows.
    try {
      const response = await fetch(
        'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/development/sync-constituents-internal',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
            'X-Workspace-Id': workspace.id,
          },
        }
      );
      const result = await response.json();
      console.log('[CONSTITUENTS SYNC] Workspace', workspace.name, 'result:', JSON.stringify(result));
    } catch (error) {
      console.error('[CONSTITUENTS SYNC] Failed for workspace', workspace.id, error);
    }
  }

  console.log('[GIFTS SYNC] Complete');
}

exports.syncGiftsHourlyWeekdays = functions.pubsub
  .schedule('0 * * * 1-5')
  .timeZone('America/New_York')
  .onRun(async () => {
    await runGiftsSyncForAllWorkspaces();
    return null;
  });

exports.syncGiftsDailyWeekends = functions.pubsub
  .schedule('0 6 * * 0,6')
  .timeZone('America/New_York')
  .onRun(async () => {
    await runGiftsSyncForAllWorkspaces();
    return null;
  });

// ---------------------------------------------------------------------------
// Daily task due-date reminder — 8am America/New_York every day.
// Scheduler-only; the Next.js endpoint /api/tasks/due-today does the
// Supabase query and Slack DM fan-out (same shape as syncGiftsHourlyWeekdays).
// ---------------------------------------------------------------------------
exports.dailyTaskDueReminder = functions.pubsub
  .schedule('0 8 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    try {
      const response = await fetch(
        'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/tasks/due-today',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
          },
        },
      );
      const result = await response.json();
      console.log('[DUE REMINDER] Result:', JSON.stringify(result));
    } catch (error) {
      console.error('[DUE REMINDER] Failed:', error);
    }
    return null;
  });

// ---------------------------------------------------------------------------
// Daily absence threshold alert — 9:30am America/New_York on weekdays.
// Fires after morning attendance is typically entered. The route checks
// for students who crossed 5 or 10 YTD absences today and DMs RBK if so.
// Silent if nothing crossed.
// ---------------------------------------------------------------------------
exports.dailyAbsenceAlert = functions.pubsub
  .schedule('30 9 * * 1-5')
  .timeZone('America/New_York')
  .onRun(async () => {
    try {
      const response = await fetch(
        'https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/absences/threshold-alert-internal',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': process.env.INTERNAL_SYNC_SECRET || '',
          },
        },
      );
      const result = await response.json();
      console.log('[ABSENCE THRESHOLD] Result:', JSON.stringify(result));
    } catch (error) {
      console.error('[ABSENCE THRESHOLD] Failed:', error);
    }
    return null;
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode base64url-encoded Gmail data */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Strip HTML tags to plain text */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Forwarding header patterns — if plain text contains only these, it's a stub */
const FORWARDING_HEADERS = [
  'begin forwarded message:',
  '---------- forwarded message',
  '-------- original message',
];

function isForwardingStub(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.length < 100 || FORWARDING_HEADERS.some(h => trimmed.startsWith(h) || trimmed === h);
}

/**
 * Recursively collect ALL text/plain parts from a MIME tree.
 * Also collects text/html as fallback.
 */
function collectParts(payload: any, plains: string[], htmls: string[]): void {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    plains.push(decodeBase64Url(payload.body.data));
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    htmls.push(decodeBase64Url(payload.body.data));
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      collectParts(part, plains, htmls);
    }
  }
}

/**
 * Recursively walk a Gmail message payload and extract body text.
 * Concatenates ALL text/plain parts (separated by \n\n).
 * Falls back to text/html (stripped) if plain text is a forwarding stub.
 */
function parseEmailBody(payload: any): string {
  // Single-part message with no sub-parts
  if (!payload.parts && payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') return stripHtmlTags(decoded);
    return decoded;
  }

  const plains: string[] = [];
  const htmls: string[] = [];
  collectParts(payload, plains, htmls);

  const plainText = plains.join('\n\n').trim();

  // If plain text is substantial, use it
  if (plainText && !isForwardingStub(plainText)) {
    return plainText;
  }

  // Plain text is just a forwarding stub — try HTML for full content
  if (htmls.length > 0) {
    const htmlText = htmls.map(h => stripHtmlTags(h)).join('\n\n').trim();
    if (htmlText.length > plainText.length) {
      return htmlText;
    }
  }

  // Return whatever we have
  return plainText;
}

/** Parse "First Last <email@domain.com>" or bare email */
function parseFrom(fromHeader: string): { name: string; email: string } {
  const match = fromHeader.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].replace(/^["']|["']$/g, '').trim(), email: match[2].trim() };
  }
  return { name: '', email: fromHeader.trim() };
}

/** Get header value from Gmail message headers array */
function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

// ---------------------------------------------------------------------------
// Valid priorities (must match emails_priority_check constraint in Supabase)
// ---------------------------------------------------------------------------
const VALID_PRIORITIES = ['owner_action', 'assistant_action', 'important_no_action', 'review', 'invitation', 'fyi'];

// ---------------------------------------------------------------------------
// Priority → Gmail label mapping
// ---------------------------------------------------------------------------
const PRIORITY_LABEL_MAP: Record<string, string> = {
  owner_action: 'RBK',
  assistant_action: 'Emily',
  important_no_action: 'Important No Action',
  review: 'Review',
  invitation: 'Invitations',
  fyi: 'FYI',
  shiva: 'Shivas',
};

// Priority → assigned_to mapping
const PRIORITY_ASSIGNEE: Record<string, string> = {
  owner_action: 'rbk',
  assistant_action: 'emily',
  important_no_action: 'rbk',
  review: 'rbk',
  invitation: 'emily',
  fyi: 'rbk',
  shiva: 'emily',
};

// ---------------------------------------------------------------------------
// triageGmail — Scheduled Cloud Function (every 15 min, weekdays)
// ---------------------------------------------------------------------------
exports.triageGmail = functions.pubsub
  .schedule('*/15 * * * 1-5')
  .timeZone('America/New_York')
  .onRun(async () => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const OPENAI_KEY = process.env.OPENAI_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY || !CLIENT_ID || !CLIENT_SECRET || !OPENAI_KEY) {
      console.error('Missing required environment variables');
      return null;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const openai = new OpenAI({ apiKey: OPENAI_KEY });

    // Fetch all workspaces with a Gmail refresh token
    const { data: workspaceRows, error: wsListError } = await supabase
      .from('workspaces')
      .select('id, owner_email, gmail_refresh_token')
      .not('gmail_refresh_token', 'is', null);

    if (wsListError) {
      console.error('Failed to fetch workspaces:', wsListError.message);
      return null;
    }

    if (!workspaceRows || workspaceRows.length === 0) {
      console.log('No workspaces with Gmail refresh tokens found');
      return null;
    }

    console.log(`triageGmail: Processing ${workspaceRows.length} workspace(s)`);

    for (const ws of workspaceRows) {
      const WORKSPACE_ID = ws.id;
      const owner_email = ws.owner_email;
      const gmail_refresh_token = ws.gmail_refresh_token;

      try {
        console.log(`[${owner_email}] Starting triage`);

        // Get fresh access token
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: gmail_refresh_token,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }).toString(),
        });

        const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
        if (!tokenData.access_token) {
          console.error(`[${owner_email}] Failed to get access token:`, tokenData.error || 'no access_token');
          continue;
        }

        const accessToken = tokenData.access_token;

        // Fetch unprocessed emails
        const gmailQuery = 'in:inbox -label:RBK/Done -label:RBK -label:Emily -label:FYI -label:Review -label:Invitations -label:Shivas newer_than:1d';
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/messages?q=${encodeURIComponent(gmailQuery)}&labelIds=INBOX&maxResults=20`;

        const listRes = await fetch(listUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const listData = await listRes.json() as { messages?: Array<{ id: string }>; error?: any };

        if (listData.error) {
          console.error(`[${owner_email}] Gmail list error:`, listData.error);
          continue;
        }

        const messageIds = listData.messages || [];
        if (messageIds.length === 0) {
          console.log(`[${owner_email}] No new messages to process`);
          continue;
        }

        console.log(`[${owner_email}] Found ${messageIds.length} messages to check`);

        // Label ID cache per workspace
        const labelCache: Record<string, string> = {};

        let processed = 0;
        let skipped = 0;

        for (const { id: msgId } of messageIds) {
          try {
            // Fetch full message
            const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/messages/${msgId}?format=full`;
            const msgRes = await fetch(msgUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const msg = await msgRes.json() as any;

            if (msg.error) {
              console.error(`[${owner_email}] Error fetching message ${msgId}:`, msg.error);
              continue;
            }

            // Skip drafts
            const labelIds: string[] = msg.labelIds || [];
            if (labelIds.includes('DRAFT')) {
              skipped++;
              continue;
            }

            const headers = msg.payload?.headers || [];
            const subject = getHeader(headers, 'Subject');
            const fromRaw = getHeader(headers, 'From');
            const dateStr = getHeader(headers, 'Date');
            const gmailMessageId = msg.id;
            const gmailThreadId = msg.threadId;

            const { name: fromName, email: fromEmail } = parseFrom(fromRaw);

            // Skip emails sent by the workspace owner
            if (fromEmail && owner_email && fromEmail.toLowerCase() === owner_email.toLowerCase()) {
              skipped++;
              continue;
            }

            // Skip emails with no subject
            if (!subject || !subject.trim()) {
              skipped++;
              continue;
            }

            const bodyText = parseEmailBody(msg.payload);

            // Check for duplicates
            const { data: existing } = await supabase
              .from('emails')
              .select('id')
              .eq('message_id', gmailMessageId)
              .eq('workspace_id', WORKSPACE_ID)
              .limit(1);

            if (existing && existing.length > 0) {
              skipped++;
              continue;
            }

            // OpenAI triage
            const triageResponse = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              temperature: 0.1,
              messages: [
                {
                  role: 'system',
                  content: `You are an email triage assistant for a school principal. Categorize and summarize each email.
Return JSON only, no other text:
{
  "priority": "owner_action" | "assistant_action" | "important_no_action" | "review" | "invitation" | "fyi" | "shiva",
  "summary": "2-3 sentence summary of the email",
  "action_needed": "what specifically needs to happen, or null if no action",
  "draft_reply": "a draft reply if owner_action or assistant_action, otherwise null"
}
Priority guide:
- owner_action: ONLY use when the principal personally needs to reply, make a decision, or take a specific action on this email
- assistant_action: the principal's assistant can handle without involving the principal
- important_no_action: important to be aware of, no response needed
- review: needs review but not urgent
- invitation: event invitation
- fyi: informational only — includes newsletters, automated notifications, receipts, delivery confirmations, system-generated messages, and announcements with no required response
- shiva: condolence / bereavement related

If the email content clearly requires no reply or action, use fyi or review — never owner_action.
IMPORTANT: If you set action_needed to any variation of "no reply needed", "no action required", "no response needed", or similar, you MUST set priority to "fyi", not "owner_action".`,
                },
                {
                  role: 'user',
                  content: `From: ${fromName} <${fromEmail}>\nSubject: ${subject}\nDate: ${dateStr}\n\n${bodyText.slice(0, 8000)}`,
                },
              ],
            });

            const triageText = triageResponse.choices[0]?.message?.content || '';
            let triage: {
              priority: string;
              summary: string;
              action_needed: string | null;
              draft_reply: string | null;
            };

            try {
              const cleaned = triageText.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
              triage = JSON.parse(cleaned);
            } catch {
              console.error(`[${owner_email}] Failed to parse triage for "${subject}":`, triageText);
              triage = { priority: 'fyi', summary: 'Unable to triage', action_needed: null, draft_reply: null };
            }

            // Validate priority
            const isShiva = triage.priority === 'shiva';
            if (isShiva) {
              triage.priority = 'fyi';
            } else if (!VALID_PRIORITIES.includes(triage.priority)) {
              triage.priority = 'fyi';
            }

            // Guard: downgrade owner_action if action_needed says no action needed
            const noActionPhrases = ['no reply needed', 'no action required', 'no response needed', 'no reply necessary', 'no action needed'];
            const actionLower = (triage.action_needed || '').toLowerCase();
            if (noActionPhrases.some(phrase => actionLower.includes(phrase)) && triage.priority === 'owner_action') {
              triage.priority = 'fyi';
            }

            // Write to Supabase
            const assignedTo = PRIORITY_ASSIGNEE[triage.priority] || 'rbk';

            const { error: insertError } = await supabase
              .from('emails')
              .insert({
                workspace_id: WORKSPACE_ID,
                message_id: gmailMessageId,
                thread_id: gmailThreadId,
                from_name: fromName || null,
                from_email: fromEmail,
                subject,
                received_at: new Date(dateStr).toISOString(),
                body_text: bodyText,
                summary: triage.summary,
                action_needed: triage.action_needed || null,
                draft_reply: triage.draft_reply || null,
                priority: triage.priority,
                assigned_to: assignedTo,
                status: 'pending',
                is_unread: true,
                ...(isShiva ? { action_status: 'shiva' } : {}),
              });

            if (insertError) {
              console.error(`[${owner_email}] Insert error for "${subject}":`, insertError.message);
              continue;
            }

            // Apply Gmail label
            const labelName = isShiva ? 'Shivas' : PRIORITY_LABEL_MAP[triage.priority];
            if (labelName) {
              try {
                const labelId = await getOrCreateLabel(accessToken, owner_email, labelName, labelCache);
                if (labelId) {
                  await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/messages/${msgId}/modify`,
                    {
                      method: 'POST',
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ addLabelIds: [labelId] }),
                    }
                  );
                }
              } catch (labelErr) {
                console.error(`[${owner_email}] Failed to label "${subject}":`, labelErr);
              }
            }

            processed++;
            console.log(`[${owner_email}] Triaged: "${subject}" → ${triage.priority}`);
          } catch (msgErr) {
            console.error(`[${owner_email}] Error processing message ${msgId}:`, msgErr);
          }
        }

        console.log(`[${owner_email}] Done: ${processed} processed, ${skipped} skipped`);
      } catch (wsErr) {
        console.error(`[${owner_email}] Workspace triage failed:`, wsErr);
      }
    }

    return null;
  });

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

async function getOrCreateLabel(
  accessToken: string,
  userEmail: string,
  labelName: string,
  cache: Record<string, string>
): Promise<string | null> {
  if (cache[labelName]) return cache[labelName];

  // List existing labels
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/labels`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json() as { labels?: Array<{ id: string; name: string }> };

  if (listData.labels) {
    for (const label of listData.labels) {
      cache[label.name] = label.id;
    }
    if (cache[labelName]) return cache[labelName];
  }

  // Create label if not found
  const createRes = await fetch(listUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  const created = await createRes.json() as { id?: string; name?: string };

  if (created.id) {
    cache[created.name || labelName] = created.id;
    return created.id;
  }

  console.error(`Failed to create label "${labelName}"`);
  return null;
}

// ---------------------------------------------------------------------------
// syncDraftsReady — Syncs Emily's Gmail drafts labeled "Drafts Ready" to Supabase
// ---------------------------------------------------------------------------
exports.syncDraftsReady = functions.pubsub
  .schedule('*/15 * * * 1-5')
  .timeZone('America/New_York')
  .onRun(async () => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    if (!SUPABASE_URL || !SUPABASE_KEY || !CLIENT_ID || !CLIENT_SECRET) {
      console.error('syncDraftsReady: Missing required environment variables');
      return null;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Fetch all workspaces with a Gmail refresh token
    const { data: workspaceRows, error: wsListError } = await supabase
      .from('workspaces')
      .select('id, owner_email, gmail_refresh_token')
      .not('gmail_refresh_token', 'is', null);

    if (wsListError) {
      console.error('syncDraftsReady: Failed to fetch workspaces:', wsListError.message);
      return null;
    }

    if (!workspaceRows || workspaceRows.length === 0) {
      console.log('syncDraftsReady: No workspaces with Gmail refresh tokens found');
      return null;
    }

    console.log(`syncDraftsReady: Processing ${workspaceRows.length} workspace(s)`);

    for (const ws of workspaceRows) {
      const WORKSPACE_ID = ws.id;
      const owner_email = ws.owner_email;
      const gmail_refresh_token = ws.gmail_refresh_token;

      try {
        // Get fresh access token
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: gmail_refresh_token,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }).toString(),
        });

        const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
        if (!tokenData.access_token) {
          console.error(`syncDraftsReady [${owner_email}]: Failed to get access token:`, tokenData.error || 'no access_token');
          continue;
        }

        const accessToken = tokenData.access_token;
        const labelCache: Record<string, string> = {};

        // Resolve "Drafts Ready" label ID
        const draftsReadyLabelId = await getOrCreateLabel(accessToken, owner_email, 'Drafts Ready', labelCache);
        if (!draftsReadyLabelId) {
          console.log(`syncDraftsReady [${owner_email}]: No "Drafts Ready" label, skipping`);
          continue;
        }

        // List messages with "Drafts Ready" label
        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/messages?labelIds=${draftsReadyLabelId}&maxResults=20`;
        const listRes = await fetch(listUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const listData = await listRes.json() as { messages?: Array<{ id: string; threadId: string }>; error?: any };

        if (listData.error) {
          console.error(`syncDraftsReady [${owner_email}]: Gmail list error:`, listData.error);
          continue;
        }

        const labeledMessages = listData.messages || [];
        if (labeledMessages.length === 0) {
          console.log(`syncDraftsReady [${owner_email}]: No messages with "Drafts Ready" label`);
          continue;
        }

        console.log(`syncDraftsReady [${owner_email}]: Found ${labeledMessages.length} messages`);

        // Deduplicate by threadId
        const threadMap = new Map<string, string[]>();
        for (const msg of labeledMessages) {
          if (!threadMap.has(msg.threadId)) {
            threadMap.set(msg.threadId, []);
          }
          threadMap.get(msg.threadId)!.push(msg.id);
        }

        // List all drafts and build threadId → draftId map
        const draftsUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/drafts?maxResults=100`;
        const draftsRes = await fetch(draftsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const draftsData = await draftsRes.json() as { drafts?: Array<{ id: string; message: { id: string; threadId: string } }>; error?: any };

        if (draftsData.error) {
          console.error(`syncDraftsReady [${owner_email}]: Drafts list error:`, draftsData.error);
          continue;
        }

        const draftByThread = new Map<string, string>();
        for (const draft of (draftsData.drafts || [])) {
          draftByThread.set(draft.message.threadId, draft.id);
        }

        let synced = 0;
        let skippedNoDraft = 0;
        let skippedNotInDb = 0;
        let skippedAlreadySent = 0;

        // Process each thread
        for (const [threadId, msgIds] of threadMap) {
          try {
            // Check if the thread already has a SENT message
            const threadUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/threads/${threadId}?format=metadata`;
            const threadRes = await fetch(threadUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const threadData = await threadRes.json() as { messages?: Array<{ labelIds?: string[] }>; error?: any };

            if (!threadData.error && threadData.messages) {
              const hasSentMessage = threadData.messages.some(
                (m) => m.labelIds && m.labelIds.includes('SENT')
              );
              if (hasSentMessage) {
                skippedAlreadySent++;
                await supabase
                  .from('emails')
                  .update({ draft_status: 'sent' })
                  .eq('thread_id', threadId)
                  .eq('workspace_id', WORKSPACE_ID);
                await swapDraftsReadyLabel(accessToken, owner_email, msgIds, draftsReadyLabelId, labelCache);
                continue;
              }
            }

            const draftId = draftByThread.get(threadId);
            if (!draftId) {
              skippedNoDraft++;
              await swapDraftsReadyLabel(accessToken, owner_email, msgIds, draftsReadyLabelId, labelCache);
              continue;
            }

            // Fetch full draft content
            const draftUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(owner_email)}/drafts/${draftId}?format=full`;
            const draftRes = await fetch(draftUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const draftData = await draftRes.json() as any;

            if (draftData.error) {
              console.error(`syncDraftsReady [${owner_email}]: Error fetching draft ${draftId}:`, draftData.error);
              await swapDraftsReadyLabel(accessToken, owner_email, msgIds, draftsReadyLabelId, labelCache);
              continue;
            }

            const draftBody = parseEmailBody(draftData.message?.payload);
            if (!draftBody) {
              skippedNoDraft++;
              await swapDraftsReadyLabel(accessToken, owner_email, msgIds, draftsReadyLabelId, labelCache);
              continue;
            }

            const draftHeaders = draftData.message?.payload?.headers || [];
            const toHeader = getHeader(draftHeaders, 'To');

            // Look up the email in Supabase
            const { data: existing } = await supabase
              .from('emails')
              .select('id, message_id, subject')
              .eq('thread_id', threadId)
              .eq('workspace_id', WORKSPACE_ID)
              .order('received_at', { ascending: false })
              .limit(1);

            if (!existing || existing.length === 0) {
              skippedNotInDb++;
              await swapDraftsReadyLabel(accessToken, owner_email, msgIds, draftsReadyLabelId, labelCache);
              continue;
            }

            const emailRecord = existing[0];
            const { error: updateError } = await supabase
              .from('emails')
              .update({
                draft_reply: draftBody,
                draft_status: 'draft_ready',
              })
              .eq('id', emailRecord.id)
              .eq('workspace_id', WORKSPACE_ID);

            if (updateError) {
              console.error(`syncDraftsReady [${owner_email}]: Update error for email ${emailRecord.id}:`, updateError.message);
              continue;
            }

            await swapDraftsReadyLabel(accessToken, owner_email, msgIds, draftsReadyLabelId, labelCache);

            synced++;
            console.log(`syncDraftsReady [${owner_email}]: Synced draft for "${emailRecord.subject}" (to: ${toHeader})`);
          } catch (err) {
            console.error(`syncDraftsReady [${owner_email}]: Error processing thread ${threadId}:`, err);
          }
        }

        console.log(`syncDraftsReady [${owner_email}]: Done — ${synced} synced, ${skippedAlreadySent} already sent, ${skippedNoDraft} no draft, ${skippedNotInDb} not in DB`);
      } catch (wsErr) {
        console.error(`syncDraftsReady [${owner_email}]: Workspace sync failed:`, wsErr);
      }
    }

    return null;
  });

/** Swap "Drafts Ready" label for "Drafts Synced" on the given messages */
async function swapDraftsReadyLabel(
  accessToken: string,
  userEmail: string,
  msgIds: string[],
  draftsReadyLabelId: string,
  labelCache: Record<string, string>
): Promise<void> {
  const draftsSyncedLabelId = await getOrCreateLabel(accessToken, userEmail, 'Drafts Synced', labelCache);

  for (const msgId of msgIds) {
    try {
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/${msgId}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            removeLabelIds: [draftsReadyLabelId],
            addLabelIds: draftsSyncedLabelId ? [draftsSyncedLabelId] : [],
          }),
        }
      );
    } catch (err) {
      console.error(`syncDraftsReady: Failed to swap labels on message ${msgId}:`, err);
    }
  }
}
