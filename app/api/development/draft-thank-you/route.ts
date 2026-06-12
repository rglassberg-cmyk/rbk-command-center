import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { getValidGoogleToken } from '@/lib/googleToken';
import { getSenderIdentity } from '@/lib/emailIdentity';
import { getAnthropicCredentials } from '@/lib/getIntegration';

interface DraftRequest {
  donorName: string;
  amount: number;
  giftType: 'donation' | 'pledge';
  date: string;
  totalPledge?: number;
  outstanding?: number;
  campaignName?: string;
  donorEmail?: string;
}

// All thank-you drafts get a copy auto-BCC'd to the Veracross gift-tracking
// inbox so a record of every outreach lands in the donor's CRM trail.
const VERACROSS_TRACKING_BCC = 'sar.tracking@mail.veracross.com';

const SYSTEM_PROMPT = `You are writing a thank you note on behalf of Rabbi Binyamin "Bini" Krauss, Principal of SAR Academy in Riverdale, NY — a Modern Orthodox Jewish day school.

VOICE AND STYLE RULES (derived from Rabbi Krauss's actual letters):
- Address donors by first name only: "Dear [Name]," or "Dear [Name] and [Name],"
- Length: 2–3 short paragraphs. Never longer.
- Opening patterns:
  (a) For general gifts to an appeal or campaign: open with "I hope this message finds you well." then move to the thank you.
  (b) For event sponsorships or gifts tied to a named event or milestone: open with a brief, meaningful reflection on that event or Jewish value before moving to the thank you.
- Always name the specific gift purpose — never be vague or generic.
- Connect the gift to students, community, values, or traditions at SAR.
- Weave in Jewish language naturally when it fits: kehillah, tefillot, Am Yisrael, chag, Hashem — only when organic, never forced.
- For general campaign gifts, include this line as its own short paragraph: "A formal thank you letter will follow, but I wanted to personally acknowledge your generosity and let you know how much it means to us."
- Sign-off — vary by tone:
  Standard: "Thank you once again for your support.\n\nRegards,\nBini"
  Heartfelt/specific program: "With appreciation,\nBini"
  Holiday or milestone event: "Wishing you a wonderful [chag/Shabbat],\nRabbi Binyamin Krauss"
- Write ONLY the email body. No subject line, no metadata.

EXAMPLES — real letters written by Rabbi Krauss:

---
Example 1 — General campaign gift (Shavuot appeal):

Dear Janet,

I hope this message finds you well. I wanted to express my sincere thanks for your contribution to our Shavuot appeal. Your support helps ensure that we can continue to provide an exceptional and meaningful educational experience for every SAR student, especially at a time of year that invites reflection on our shared values and commitments.

A formal thank you letter will follow, but I wanted to personally acknowledge your generosity and let you know how much it means to us.

Thank you once again for your support.

Regards,
Bini

---
Example 2 — Gift for a specific school program (Sephardic siddurim):

Dear Sarah,

Thank you for your gift, together with your parents, supporting the purchase of the Sephardic siddurim in the middle school. This is a meaningful first step in strengthening Sephardic programming and presence at SAR Academy and in ensuring that every child can feel comfortable when they share their tefillot and take pride in the rich variety of traditions and heritage that make up our community.

Your generosity reflects the kind of care and vision that helps our community continue to grow in inclusive and meaningful ways. I am deeply grateful for your partnership and for all that you do each day for our youngest students and their families.

With appreciation,
Bini

---
Example 3 — Event sponsorship (Siddur Play):

Dear Amy and Harrie,

A Jewish child experiences many meaningful milestones in their journey of growth and learning, and receiving their first siddur is one of the most special. It is a moment filled with joy and significance as they begin to understand their ability to communicate with Hashem and the power of their tefillot. Most importantly, it represents their deepening connection to our kehillah and the strength of a community that comes together to celebrate and support them.

I wanted to take a moment to thank you for your sponsorship in honor of the Siddur Play. Your support helps create a memorable and meaningful experience for our students, reinforcing the values we cherish and the traditions we pass down.

It was wonderful to share this milestone together with you and I appreciate your partnership in nurturing the next generation of Am Yisrael.

Wishing you a wonderful chag,
Rabbi Binyamin Krauss

---
Example 4 — Scholarship gift with personal student connection:

Dear Randi and Arthur,

I hope this message finds you well. I want to express our sincere gratitude for your gift. As you know, our scholarship program relies on the generosity of our community. When we have the support necessary to make the school accessible, we can focus on making every day extraordinary for all our students. Importantly, we hope that's what you hear from Bradley.

A formal thank you letter will follow, but I wanted to personally acknowledge your generosity and let you know how much it means to us.

Thank you once again for your support.

Regards,
Bini
---`;

// Mirrors the signature in /api/emails/compose/route.ts so the draft RBK
// reviews in Gmail has the same letterhead as any other note he sends.
const EMAIL_SIGNATURE = `
<br><br>
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
  <p style="margin: 0; color: #0066cc; font-weight: bold;">Rabbi Binyamin Krauss</p>
  <p style="margin: 0; color: #0066cc;">Principal</p>
  <p style="margin: 8px 0 0 0;">
    <span style="color: #666;">p</span> | <a href="tel:7185481717" style="color: #333; text-decoration: none;">718.548.1717 ext. 1206</a>
  </p>
  <p style="margin: 0;">
    <span style="color: #666;">e</span> | <a href="mailto:kraussb@saracademy.org" style="color: #0066cc; text-decoration: none;">kraussb@saracademy.org</a>
  </p>
</div>
`;

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fallbackDraft(req: DraftRequest): string {
  const amount = formatMoney(req.amount);
  const campaign = req.campaignName || 'Guardian Circle 2025-26';
  const pledgeLine = req.giftType === 'pledge' && req.totalPledge
    ? ` Your pledge of ${formatMoney(req.totalPledge)} — with ${formatMoney(req.outstanding || 0)} still to be fulfilled — will help us strengthen everything from limudei kodesh to STEM, athletics, and the arts.`
    : '';
  return `Dear ${req.donorName},

Thank you for your ${req.giftType} of ${amount} to the ${campaign} campaign. Your partnership directly shapes what's possible for our students this year, and it means a great deal that you've chosen to stand with SAR.${pledgeLine}

With deep appreciation,
Rabbi Krauss`;
}

function buildUserMessage(req: DraftRequest): string {
  const { donorName, amount, giftType, date, totalPledge, outstanding, campaignName } = req;
  const formattedAmount = amount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
    : null;
  const formattedPledge = totalPledge
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalPledge)
    : null;
  const formattedOutstanding = outstanding
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(outstanding)
    : null;

  const isEventGift = campaignName &&
    !campaignName.toLowerCase().includes('guardian circle') &&
    !campaignName.toLowerCase().includes('scholarship') &&
    !campaignName.toLowerCase().includes('annual');

  let msg = `Write a thank you note to ${donorName} for their ${giftType}`;
  if (formattedAmount) msg += ` of ${formattedAmount}`;
  msg += ` to ${campaignName || 'SAR Academy'}`;
  if (date) msg += ` (gift date: ${date})`;
  msg += '.';

  if (giftType === 'pledge' && formattedPledge) {
    msg += ` They have pledged ${formattedPledge} total`;
    if (formattedOutstanding) msg += ` with ${formattedOutstanding} still outstanding`;
    msg += '.';
  }

  if (isEventGift) {
    msg += ` This gift is for a named event or program — use opening pattern (b): start with a meaningful reflection on the event before thanking them.`;
  } else {
    msg += ` Use opening pattern (a): start with "I hope this message finds you well."`;
  }

  return msg;
}

function buildRawMime(opts: { to: string; bcc: string; subject: string; body: string; fromEmail: string; fromName: string }): string {
  const htmlBody = opts.body.replace(/\n/g, '<br>');
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">${htmlBody}${EMAIL_SIGNATURE}</body></html>`;

  // Build headers conditionally. RFC 5322 doesn't allow an empty `To:`
  // value, and including one when the donor email is unknown was causing
  // Gmail to silently drop the rest of the headers (including Bcc) on
  // some accounts. Only emit each header line if it has a value; Bcc is
  // always emitted because we always BCC the Veracross tracking inbox.
  const headerLines: string[] = [
    `From: ${opts.fromName} <${opts.fromEmail}>`,
  ];
  if (opts.to && opts.to.trim()) headerLines.push(`To: ${opts.to.trim()}`);
  headerLines.push(`Bcc: ${opts.bcc}`);
  headerLines.push(`Subject: ${opts.subject}`);
  headerLines.push('MIME-Version: 1.0');
  headerLines.push('Content-Type: text/html; charset=utf-8');

  // RFC 5322: blank line between headers and body.
  const message = headerLines.join('\r\n') + '\r\n\r\n' + htmlContent;
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function createGmailDraft(
  accessToken: string,
  draftText: string,
  donorName: string,
  donorEmail: string | undefined,
  fromEmail: string,
  fromName: string,
): Promise<{ draftId: string; threadId: string } | null> {
  try {
    const raw = buildRawMime({
      to: donorEmail || '',
      bcc: VERACROSS_TRACKING_BCC,
      subject: `Thank you — ${donorName}`,
      body: draftText,
      fromEmail,
      fromName,
    });
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[DRAFT THANK YOU] Gmail draft create failed:', res.status, err);
      return null;
    }
    const json = await res.json();
    return { draftId: json.id, threadId: json.message?.threadId ?? '' };
  } catch (err) {
    console.error('[DRAFT THANK YOU] Gmail draft create threw:', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch { /* fail open */ }

  let body: DraftRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.donorName || typeof body.amount !== 'number' || !body.giftType || !body.date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 1) Generate the note text (Claude if key present, template otherwise).
  let draftText: string;
  let source: 'ai' | 'template' = 'ai';
  const { apiKey } = await getAnthropicCredentials(session.workspaceId);
  if (!apiKey) {
    draftText = fallbackDraft(body);
    source = 'template';
  } else {
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          { role: 'user', content: buildUserMessage(body) },
        ],
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();
      draftText = text || fallbackDraft(body);
    } catch (err) {
      console.error('[DRAFT THANK YOU] Anthropic call failed:', err);
      draftText = fallbackDraft(body);
      source = 'template';
    }
  }

  // 2) Create a Gmail draft (To: donor / Bcc: Veracross tracking) so the
  //    sender can review + send from their own inbox. Token comes from
  //    user_google_tokens via getValidGoogleToken; if the user hasn't
  //    connected Google, the client falls back to mailto: behavior.
  let draftId: string | undefined;
  let draftUrl: string | undefined;
  const accessToken = await getValidGoogleToken(session.workspaceId, session.user.email);
  if (accessToken) {
    const identity = await getSenderIdentity(session.workspaceId, session.user.email);
    const result = await createGmailDraft(
      accessToken,
      draftText,
      body.donorName,
      body.donorEmail,
      identity.fromEmail,
      identity.fromName,
    );
    if (result) {
      draftId = result.draftId;
      // Gmail uses thread IDs in its hash URLs. The format below opens the
      // drafts folder and selects this thread. If the user has multi-account
      // Gmail signed in, /u/0/ targets the primary account.
      draftUrl = result.threadId
        ? `https://mail.google.com/mail/u/0/#drafts/${result.threadId}`
        : `https://mail.google.com/mail/u/0/#drafts/${result.draftId}`;
    }
  }

  return NextResponse.json({ draft: draftText, source, draftId, draftUrl });
}
