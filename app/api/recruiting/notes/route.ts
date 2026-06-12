import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { getLeverCredentials } from '@/lib/getIntegration';

const LEVER_BASE = 'https://api.lever.co/v1';

const LEVER_USER_MAP: Record<string, string> = {
  'kraussb@saracademy.org': 'fbbe3ae8-d014-4f0e-930f-0a2c24d35124',
  'egray@saracademy.org': 'b5b07c90-c697-4cc8-af6a-19f7bf57a4a9',
};

function leverAuth(apiKey: string): string {
  return `Basic ${Buffer.from(apiKey + ':').toString('base64')}`;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const opportunityId = new URL(request.url).searchParams.get('opportunityId');
  if (!opportunityId) {
    return NextResponse.json({ error: 'opportunityId required' }, { status: 400 });
  }

  try {
    const { apiKey } = await getLeverCredentials(session.workspaceId);
    const res = await fetch(`${LEVER_BASE}/opportunities/${opportunityId}/notes`, {
      headers: { Authorization: leverAuth(apiKey), Accept: 'application/json' },
    });

    if (!res.ok) {
      console.error('[LEVER NOTES] Fetch error:', res.status);
      return NextResponse.json({ notes: [] });
    }

    const json = await res.json();
    const notes = (json.data || []).map((n: any) => ({
      id: n.id,
      text: n.fields?.text || n.value || '',
      createdAt: n.createdAt,
      user: n.user ? { name: n.user.name, email: n.user.email } : null,
    }));

    return NextResponse.json({ notes });
  } catch (error) {
    console.error('[LEVER NOTES] Error:', error);
    return NextResponse.json({ notes: [] });
  }
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { opportunityId, value, userEmail } = await request.json();

    if (!opportunityId || !value) {
      return NextResponse.json({ error: 'opportunityId and value required' }, { status: 400 });
    }

    const body: Record<string, string> = { value };
    const leverUserId = LEVER_USER_MAP[(userEmail || '').toLowerCase()];
    if (leverUserId) {
      body.perform_as = leverUserId;
    }

    const { apiKey } = await getLeverCredentials(session.workspaceId);
    const res = await fetch(`${LEVER_BASE}/opportunities/${opportunityId}/notes`, {
      method: 'POST',
      headers: {
        Authorization: leverAuth(apiKey),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[LEVER NOTES] Post error:', res.status, err);
      return NextResponse.json({ error: 'Failed to post note' }, { status: 500 });
    }

    const json = await res.json();
    return NextResponse.json({
      success: true,
      note: {
        id: json.data?.id,
        text: value,
        createdAt: Date.now(),
        user: { name: session.user.name || session.user.email, email: session.user.email },
      },
    });
  } catch (error) {
    console.error('[LEVER NOTES] Post error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
