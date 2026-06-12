import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('dismissed_invitations')
    .select('email_id')
    .eq('workspace_id', session.workspaceId)
    .eq('dismissed_by', session.user.email.toLowerCase());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ dismissedIds: (data || []).map(r => r.email_id) });
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { emailId } = await request.json();
  if (!emailId) {
    return NextResponse.json({ error: 'emailId required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('dismissed_invitations')
    .upsert({
      workspace_id: session.workspaceId,
      email_id: emailId,
      dismissed_by: session.user.email.toLowerCase(),
    }, { onConflict: 'workspace_id,email_id,dismissed_by' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
