import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

interface GradeOverride {
  override_grade: string;
  reason: string | null;
  original_grade: string | null;
  student_name: string | null;
  updated_by: string | null;
  updated_at: string;
  is_pisgah: boolean;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('enrollment_grade_overrides')
    .select('student_id, student_name, original_grade, override_grade, reason, updated_by, updated_at, is_pisgah')
    .eq('workspace_id', session.workspaceId)
    .eq('school_year', '2025-26');

  if (error) {
    console.error('[GradeOverrides] Fetch error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const overrides: Record<string, GradeOverride> = {};
  for (const row of data || []) {
    overrides[row.student_id] = {
      override_grade: row.override_grade,
      reason: row.reason,
      original_grade: row.original_grade,
      student_name: row.student_name,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
      is_pisgah: row.is_pisgah ?? false,
    };
  }

  return NextResponse.json({ overrides });
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { studentId, studentName, originalGrade, overrideGrade, reason, isPisgah } = body;
  if (!studentId) {
    return NextResponse.json({ error: 'studentId required' }, { status: 400 });
  }

  // If no overrideGrade provided, this is a Pisgah-only toggle — use originalGrade as override_grade
  const effectiveOverrideGrade = overrideGrade || originalGrade;
  if (!effectiveOverrideGrade) {
    return NextResponse.json({ error: 'overrideGrade or originalGrade required' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upsertData: Record<string, any> = {
    workspace_id: session.workspaceId,
    student_id: String(studentId),
    student_name: studentName || null,
    original_grade: originalGrade || null,
    override_grade: effectiveOverrideGrade,
    school_year: '2025-26',
    updated_by: session.user.email,
    updated_at: new Date().toISOString(),
  };
  if (reason !== undefined) upsertData.reason = reason || null;
  if (isPisgah !== undefined) upsertData.is_pisgah = isPisgah;

  const { error } = await supabaseAdmin
    .from('enrollment_grade_overrides')
    .upsert(upsertData, { onConflict: 'workspace_id,student_id,school_year' });

  if (error) {
    console.error('[GradeOverrides] Upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { studentId } = await request.json();
  if (!studentId) {
    return NextResponse.json({ error: 'studentId required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('enrollment_grade_overrides')
    .delete()
    .eq('workspace_id', session.workspaceId)
    .eq('student_id', String(studentId))
    .eq('school_year', '2025-26');

  if (error) {
    console.error('[GradeOverrides] Delete error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
