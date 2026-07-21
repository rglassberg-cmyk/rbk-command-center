// Phase F: lightweight connection test per integration type. Hits a
// cheap real endpoint to validate the credentials currently saved in
// the DB (or env fallback). Returns { ok: true } / { ok: false, error }.
// Never returns the credential value itself.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, sessionIsSuperAdmin } from '@/lib/auth';
import {
  getVeracrossCredentials,
  getSlackCredentials,
  getLeverCredentials,
  getAnthropicCredentials,
} from '@/lib/getIntegration';


async function testVeracross(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
  const { clientId, clientSecret, schoolCode } = await getVeracrossCredentials(workspaceId);
  if (!clientId || !clientSecret) return { ok: false, error: 'No client_id / client_secret configured' };
  try {
    const res = await fetch(`https://accounts.veracross.com/${schoolCode}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'students:list',
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testSlack(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
  const { botToken } = await getSlackCredentials(workspaceId);
  if (!botToken) return { ok: false, error: 'No bot token configured' };
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) {
      return { ok: false, error: j.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testLever(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
  const { apiKey } = await getLeverCredentials(workspaceId);
  if (!apiKey) return { ok: false, error: 'No API key configured' };
  try {
    const auth = `Basic ${Buffer.from(apiKey + ':').toString('base64')}`;
    const res = await fetch('https://api.lever.co/v1/postings?limit=1', {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testAnthropic(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
  const { apiKey } = await getAnthropicCredentials(workspaceId);
  if (!apiKey) return { ok: false, error: 'No API key configured' };
  // Minimal request — uses /v1/messages with 1-token cap.
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!sessionIsSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { workspace_id?: string; integration_type?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const wsId = body.workspace_id || session.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  switch (body.integration_type) {
    case 'veracross':  return NextResponse.json(await testVeracross(wsId));
    case 'slack':      return NextResponse.json(await testSlack(wsId));
    case 'lever':      return NextResponse.json(await testLever(wsId));
    case 'anthropic':  return NextResponse.json(await testAnthropic(wsId));
    default:           return NextResponse.json({ ok: false, error: 'Unknown integration_type' }, { status: 400 });
  }
}
