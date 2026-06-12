import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';

const MANUAL_SYNC_DRAFTS_URL = 'https://us-central1-rbk-cmd-center.cloudfunctions.net/manualSyncDrafts';

export async function POST() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const res = await fetch(MANUAL_SYNC_DRAFTS_URL, { method: 'POST' });
    const data = await res.json();

    if (!res.ok || !data.success) {
      console.error('gmail/sync-drafts: manualSyncDrafts failed:', data.error || res.status);
      return NextResponse.json({ success: false, error: data.error || 'Trigger failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('gmail/sync-drafts: Unexpected error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
