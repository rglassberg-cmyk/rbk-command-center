import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { workspace_id, reported_by, page, feedback, screenshot_data } = await request.json();

    const { error } = await supabaseAdmin
      .from('bug_reports')
      .insert({
        workspace_id: workspace_id || session.workspaceId || null,
        reported_by: reported_by || session.user.email,
        page: page || null,
        feedback: feedback || '',
        screenshot_data: screenshot_data || null,
      });

    if (error) {
      console.error('Bug report insert error:', error);
      return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Bug report error:', error);
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
  }
}
