import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// After School Programs data route. Reads the after_school_*_cache tables
// (Supabase) — never Veracross directly. Gated to the `after_school`
// module (owners/assistants pass via workspace modules; viewers need an
// allowed_modules grant — same model as development/admissions).
//
// ?school_year=2026  (default 2026 = AY 2026-27; 2025 = AY 2025-26).

const DEFAULT_SCHOOL_YEAR = 2026;
const VALID_SCHOOL_YEARS = new Set([2025, 2026]);
type ProgramGroup = 'tzaharon' | 'after_school' | 'ms_extracurriculars';
const ALL_GROUPS: ProgramGroup[] = ['tzaharon', 'after_school', 'ms_extracurriculars'];

interface ClassRow {
  veracross_class_id: number;
  description: string;
  program_group: ProgramGroup;
  capacity: number | null;
  begin_date: string | null;
  end_date: string | null;
  course_name: string | null;
  synced_at: string | null;
}

interface AfterSchoolClass {
  veracross_class_id: number;
  description: string;
  program_group: ProgramGroup;
  enrollment_count: number;
  capacity: number | null;
  grade_breakdown: Record<number, number>;
  begin_date: string | null;
  end_date: string | null;
  course_name: string | null;
  // Per-student rows for the drilldown panel. Only person_id + grade are
  // available from the programs enrollments endpoint — no names.
  students: { person_id: number; grade_level_id: number | null }[];
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = (await getEffectiveWorkspaceId(session)) || session.workspaceId;

  // Module gating.
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.after_school === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.after_school === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch {
    /* fail open */
  }

  const yearParam = Number(new URL(request.url).searchParams.get('school_year'));
  const schoolYear = VALID_SCHOOL_YEARS.has(yearParam) ? yearParam : DEFAULT_SCHOOL_YEAR;

  // 1. Classes for this workspace + school year.
  const { data: classData, error: classErr } = await supabaseAdmin
    .from('after_school_classes_cache')
    .select('veracross_class_id, description, program_group, capacity, begin_date, end_date, course_name, synced_at')
    .eq('workspace_id', wsId)
    .eq('school_year', schoolYear);
  if (classErr) {
    console.error('[AFTER-SCHOOL] classes query failed:', classErr);
    return NextResponse.json({ error: 'Failed to load classes' }, { status: 500 });
  }
  const classes = (classData || []) as ClassRow[];

  // 2. Enrollments (paginated — a busy year can exceed 1000 rows).
  const enrollments: { veracross_class_id: number; person_id: number; grade_level_id: number | null }[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('after_school_enrollments_cache')
      .select('veracross_class_id, person_id, grade_level_id')
      .eq('workspace_id', wsId)
      .eq('school_year', schoolYear)
      .eq('currently_enrolled', true)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('[AFTER-SCHOOL] enrollments query failed:', error);
      return NextResponse.json({ error: 'Failed to load enrollments' }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    enrollments.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // 3. Aggregate per class: count + grade breakdown + student rows.
  const countByClass = new Map<number, number>();
  const gradesByClass = new Map<number, Record<number, number>>();
  const studentsByClass = new Map<number, { person_id: number; grade_level_id: number | null }[]>();
  for (const e of enrollments) {
    countByClass.set(e.veracross_class_id, (countByClass.get(e.veracross_class_id) || 0) + 1);
    if (e.grade_level_id != null) {
      const g = gradesByClass.get(e.veracross_class_id) ?? {};
      g[e.grade_level_id] = (g[e.grade_level_id] || 0) + 1;
      gradesByClass.set(e.veracross_class_id, g);
    }
    const list = studentsByClass.get(e.veracross_class_id) ?? [];
    list.push({ person_id: e.person_id, grade_level_id: e.grade_level_id });
    studentsByClass.set(e.veracross_class_id, list);
  }

  // 4. Build grouped response.
  const groups: Record<ProgramGroup, { classes: AfterSchoolClass[]; total_enrolled: number }> = {
    tzaharon: { classes: [], total_enrolled: 0 },
    after_school: { classes: [], total_enrolled: 0 },
    ms_extracurriculars: { classes: [], total_enrolled: 0 },
  };

  let lastSynced: string | null = null;
  for (const cl of classes) {
    if (cl.synced_at && (!lastSynced || cl.synced_at > lastSynced)) lastSynced = cl.synced_at;
    const group = ALL_GROUPS.includes(cl.program_group) ? cl.program_group : 'after_school';
    const enrollment_count = countByClass.get(cl.veracross_class_id) || 0;
    groups[group].classes.push({
      veracross_class_id: cl.veracross_class_id,
      description: cl.description,
      program_group: group,
      enrollment_count,
      capacity: cl.capacity,
      grade_breakdown: gradesByClass.get(cl.veracross_class_id) ?? {},
      begin_date: cl.begin_date,
      end_date: cl.end_date,
      course_name: cl.course_name,
      students: studentsByClass.get(cl.veracross_class_id) ?? [],
    });
    groups[group].total_enrolled += enrollment_count;
  }

  // Sort classes within each group by enrollment desc, then name.
  for (const g of ALL_GROUPS) {
    groups[g].classes.sort(
      (a, b) => b.enrollment_count - a.enrollment_count || a.description.localeCompare(b.description),
    );
  }

  return NextResponse.json({
    school_year: schoolYear,
    groups,
    last_synced: lastSynced,
  });
}
