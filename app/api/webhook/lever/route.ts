import { NextRequest, NextResponse } from 'next/server';

const LEVER_BASE = 'https://api.lever.co/v1';

function leverAuth(): string {
  return `Basic ${Buffer.from((process.env.LEVER_API_KEY || '') + ':').toString('base64')}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, data } = body;

    if (event !== 'applicationCreated' || !data?.opportunityId) {
      return NextResponse.json({ ok: true });
    }

    const headers = { Authorization: leverAuth(), Accept: 'application/json' };

    // Fetch opportunity
    const oppRes = await fetch(`${LEVER_BASE}/opportunities/${data.opportunityId}`, { headers });
    if (!oppRes.ok) {
      console.error('Lever webhook: failed to fetch opportunity', oppRes.status);
      return NextResponse.json({ ok: true });
    }
    const oppJson = await oppRes.json();
    const opp = oppJson.data;

    // Fetch posting if available
    const postingId = opp?.applications?.[0]?.posting;
    let posting = null;
    if (postingId) {
      const postingRes = await fetch(`${LEVER_BASE}/postings/${postingId}`, { headers });
      if (postingRes.ok) {
        const postingJson = await postingRes.json();
        posting = postingJson.data;
      }
    }

    // Skip High School postings
    if (posting) {
      const dept = posting.categories?.department || '';
      const team = posting.categories?.team || '';
      if (dept === 'SAR High School' || team.includes('High School')) {
        return NextResponse.json({ ok: true });
      }
    }

    // Send Slack DM to RBK
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (slackToken) {
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${slackToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'U04NBR22Y',
          text: `📋 New application: *${opp.name}* applied for *${posting?.text || 'a position'}*\n<${opp.urls?.show}|View in Lever>`,
        }),
      }).catch(e => console.error('Slack notify failed:', e));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Lever webhook error:', error);
    return NextResponse.json({ ok: true });
  }
}
