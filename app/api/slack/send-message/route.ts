import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getSlackCredentials } from '@/lib/getIntegration';
import { sendSlackDM } from '@/lib/slackNotifications';

// POST /api/slack/send-message
//
// Generic contextual-send endpoint behind the SlackSendModal.
// Any authenticated workspace user can fire this — recipient is
// supplied by the client, looked up against `workspace_members`
// upstream (the modal only surfaces members with a slack_user_id,
// so the route does no second-lookup gating).
//
// Body: { toSlackUserId, message, context }
// Outgoing DM: "{context}\n\n{message}".

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { toSlackUserId?: unknown; message?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const toSlackUserId = typeof body.toSlackUserId === 'string' ? body.toSlackUserId.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const context = typeof body.context === 'string' ? body.context : '';
  if (!toSlackUserId) {
    return NextResponse.json({ ok: false, error: 'toSlackUserId required' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message required' }, { status: 400 });
  }

  try {
    const { botToken } = await getSlackCredentials(session.workspaceId);
    if (!botToken) {
      return NextResponse.json({ ok: false, error: 'Slack not configured' }, { status: 500 });
    }
    const text = context ? `${context}\n\n${message}` : message;
    await sendSlackDM(toSlackUserId, text, botToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[slack/send-message] failed:', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
