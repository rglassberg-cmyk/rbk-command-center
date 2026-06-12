import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('enrollment_budget')
    .select('grade_code, budgeted_count')
    .eq('workspace_id', session.workspaceId)
    .eq('school_year', '2025-26');

  if (error) {
    console.error('[Budget] Fetch error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const budget: Record<string, number> = {};
  for (const row of data || []) {
    budget[row.grade_code] = row.budgeted_count;
  }

  return NextResponse.json({ budget });
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only owners and assistants can edit
  if (session.role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { gradeCode, count, schoolYear } = await request.json();
  if (!gradeCode || count === undefined) {
    return NextResponse.json({ error: 'gradeCode and count required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('enrollment_budget')
    .upsert({
      workspace_id: session.workspaceId,
      grade_code: gradeCode,
      budgeted_count: Number(count),
      school_year: schoolYear || '2025-26',
      updated_at: new Date().toISOString(),
      updated_by: session.user.email,
    }, { onConflict: 'workspace_id,grade_code,school_year' });

  if (error) {
    console.error('[Budget] Upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
