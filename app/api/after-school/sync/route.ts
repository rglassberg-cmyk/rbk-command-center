import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, sessionIsSuperAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

// After School Programs sync — pulls courses / classes / enrollments from
// the Veracross *programs* API into the after_school_*_cache tables.
//
// Auth: X-Internal-Secret (called by the syncAfterSchoolPrograms Cloud
// Function, no user session) OR an admin session (the manual "Sync" button
// on the After School page). Same dual-auth pattern as
// app/api/development/giving-history/ingest. The secret accepts
// INTERNAL_SYNC_SECRET (what every other internal route + Cloud Function
// uses) and SYNC_SECRET as a fallback, since the task spec referenced
// both names. Workspace id from the `x-workspace-id` header (defaults to
// SAR).
//
// IMPORTANT — Veracross school_year is the FALL year of the academic
// year, NOT the spring year. Discovery confirmed a class with
// school_year=2025 has begin_date 2025-09-03 / end_date 2026-06-18, i.e.
// AY 2025-26. So:
//   school_year 2025  ->  AY 2025-26  (UI "2025–26")
//   school_year 2026  ->  AY 2026-27  (UI "2026–27", the default view)
// (The task's parenthetical "2026 = 2025-2026" was off by one; the data
// is authoritative.) We sync both years for YoY.
//
// Pagination: the programs API paginates by request headers (X-Page-Size
// / X-Page-Number), same as the students/attendance endpoints — NOT by a
// ?count= query param. Confirmed in scripts/discoverProgramsApi.ts (a
// page size of 2 returned exactly 2 rows). Without looping you only get
// the default 2 records per endpoint.

export const maxDuration = 300;

const DEFAULT_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SCHOOL_ROUTE = process.env.VERACROSS_SCHOOL_ROUTE || 'sar';
const SYNC_SCHOOL_YEARS = [2025, 2026];
const PAGE_SIZE = 1000;
const MAX_PAGES = 100; // safety cap

const PROGRAMS_SCOPE = [
  'programs.classes:list',
  'programs.classes:read',
  'programs.enrollments:list',
  'programs.enrollments:read',
  'programs.courses:list',
  'programs.courses:read',
].join(' ');

// Exact course-name allow-list. Anything not here is ignored.
const TZAHARON_COURSES = [
  'Tzaharon Monday', 'Tzaharon Tuesday', 'Tzaharon Wednesday', 'Tzaharon Thursday',
];
const MS_COURSES = ['MS Extra-Curriculars'];
const AFTER_SCHOOL_COURSES = [
  'Monday - After School - Fall', 'Tuesday - After School - Fall', 'Wednesday - After School - Fall',
  'Thursday - After School - Fall', "Monday - Cont'd - Fall", "Tuesday - Cont'd - Fall",
  "Wednesday - Cont'd - Fall", "Thursday - Cont'd - Fall", 'Drop-Off', 'Monday - Chidon - Fall',
  'Monday - After School - Spring', "Monday - Cont'd - Spring", 'Tuesday - After School - Spring',
  "Tuesday - Cont'd - Spring", 'Wednesday - After School - Spring', "Wednesday - Cont'd - Spring",
  'Thursday - After School - Spring', "Thursday - Cont'd - Spring", 'Friday/Weekend - After-School',
];
const ALLOWED_COURSE_NAMES = new Set<string>([
  ...TZAHARON_COURSES, ...MS_COURSES, ...AFTER_SCHOOL_COURSES,
]);

type ProgramGroup = 'tzaharon' | 'ms_extracurriculars' | 'after_school';
function classifyProgramGroup(courseName: string): ProgramGroup {
  if (courseName.startsWith('Tzaharon')) return 'tzaharon';
  if (courseName.startsWith('MS Extra')) return 'ms_extracurriculars';
  return 'after_school';
}

interface VCCourse {
  id: number;
  name: string;
  catalog_title: string | null;
}
interface VCClass {
  id: number;
  class_id: string | null;
  description: string;
  status: number | null;
  school_year: number;
  begin_date: string | null;
  end_date: string | null;
  internal_course_id: number | null;
}
interface VCEnrollment {
  id: number;
  internal_class_id: number;
  class_description: string | null;
  person_id: number;
  grade_level_id: number | null;
  currently_enrolled: boolean;
  date_withdrawn: string | null;
  late_date_enrolled: string | null;
  level: number | null;
}

async function getProgramsToken(): Promise<string> {
  const clientId = process.env.VERACROSS_PROGRAMS_CLIENT_ID;
  const clientSecret = process.env.VERACROSS_PROGRAMS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing VERACROSS_PROGRAMS_CLIENT_ID / VERACROSS_PROGRAMS_CLIENT_SECRET');
  }
  const res = await fetch(`https://accounts.veracross.com/${SCHOOL_ROUTE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: PROGRAMS_SCOPE,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Programs token error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

// Header-paginated fetch over a programs endpoint until a short page.
async function fetchAllPages<T>(path: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const res = await fetch(`https://api.veracross.com/${SCHOOL_ROUTE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'X-Page-Size': String(PAGE_SIZE),
        'X-Page-Number': String(page),
      },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GET ${path} page ${page} -> ${res.status}: ${err.slice(0, 200)}`);
    }
    const json = await res.json();
    const data: T[] = json.data || [];
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return out;
}

export async function POST(request: NextRequest) {
  // ---- Auth ----
  // Shared secret (Cloud Function) OR an admin session (manual UI trigger).
  const secret = request.headers.get('x-internal-secret');
  const accepted = [process.env.INTERNAL_SYNC_SECRET, process.env.SYNC_SECRET].filter(Boolean);
  const hasSecret = !!secret && accepted.includes(secret);
  if (!hasSecret) {
    const session = await getAuthSession();
    if (!sessionIsSuperAdmin(session) && session?.role !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const workspaceId = request.headers.get('x-workspace-id') || DEFAULT_WORKSPACE_ID;

  try {
    const token = await getProgramsToken();

    // 1. Courses → allowed course id → {name, catalog_title}.
    const courses = await fetchAllPages<VCCourse>('/v3/programs/courses', token);
    const courseById = new Map<number, VCCourse>();
    const allowedCourseIds = new Set<number>();
    for (const c of courses) {
      courseById.set(c.id, c);
      if (ALLOWED_COURSE_NAMES.has(c.name)) allowedCourseIds.add(c.id);
    }

    // 2. Classes → filter to synced years + allowed courses.
    const allClasses = await fetchAllPages<VCClass>('/v3/programs/classes', token);
    const classesToStore = allClasses.filter(
      (cl) =>
        SYNC_SCHOOL_YEARS.includes(cl.school_year) &&
        cl.internal_course_id != null &&
        allowedCourseIds.has(cl.internal_course_id),
    );

    // Map class id → school_year (used to bucket enrollments).
    const classYearById = new Map<number, number>();
    for (const cl of classesToStore) classYearById.set(cl.id, cl.school_year);
    const syncedClassIds = new Set<number>(classesToStore.map((cl) => cl.id));

    // 3. Upsert classes. Omit `capacity` from the payload entirely so the
    //    upsert never touches it: new rows fall back to the column default
    //    (NULL) and existing rows keep any manually-set capacity (PostgREST
    //    only updates columns present in the payload).
    const classRows = classesToStore.map((cl) => {
      const course = cl.internal_course_id != null ? courseById.get(cl.internal_course_id) : undefined;
      const courseName = course?.name ?? '';
      return {
        workspace_id: workspaceId,
        veracross_class_id: cl.id,
        class_id_string: cl.class_id,
        description: cl.description,
        course_id: cl.internal_course_id,
        course_name: courseName || null,
        course_catalog_title: course?.catalog_title ?? null,
        school_year: cl.school_year,
        begin_date: cl.begin_date,
        end_date: cl.end_date,
        status: cl.status,
        program_group: classifyProgramGroup(courseName),
        synced_at: new Date().toISOString(),
      };
    });

    let classesSynced = 0;
    for (let i = 0; i < classRows.length; i += 500) {
      const batch = classRows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from('after_school_classes_cache')
        .upsert(batch, { onConflict: 'workspace_id,veracross_class_id,school_year' });
      if (error) {
        console.error('[AFTER-SCHOOL SYNC] classes upsert failed:', error);
        return NextResponse.json({ error: 'classes upsert failed', detail: error.message }, { status: 500 });
      }
      classesSynced += batch.length;
    }

    // 4. Enrollments → filter to synced classes + currently enrolled.
    const allEnrollments = await fetchAllPages<VCEnrollment>('/v3/programs/enrollments', token);
    const enrollmentRows = allEnrollments
      .filter((e) => syncedClassIds.has(e.internal_class_id) && e.currently_enrolled === true)
      .map((e) => ({
        workspace_id: workspaceId,
        enrollment_id: e.id,
        veracross_class_id: e.internal_class_id,
        class_description: e.class_description,
        person_id: e.person_id,
        grade_level_id: e.grade_level_id,
        currently_enrolled: true,
        date_withdrawn: e.date_withdrawn,
        late_date_enrolled: e.late_date_enrolled,
        // `level` was present in the raw enrollment response (0 in samples)
        // but unstored — capturing it now to learn whether it encodes
        // registration status (pending vs confirmed).
        level: e.level ?? null,
        school_year: classYearById.get(e.internal_class_id)!,
        synced_at: new Date().toISOString(),
      }));

    // Replace the synced years' enrollments so students who have since
    // withdrawn drop out of the cache (we only re-insert currently_enrolled
    // rows). Safe: the Veracross fetch already succeeded above, so we never
    // delete without fresh data to re-insert.
    const { error: delErr } = await supabaseAdmin
      .from('after_school_enrollments_cache')
      .delete()
      .eq('workspace_id', workspaceId)
      .in('school_year', SYNC_SCHOOL_YEARS);
    if (delErr) {
      console.error('[AFTER-SCHOOL SYNC] enrollments delete failed:', delErr);
      return NextResponse.json({ error: 'enrollments delete failed', detail: delErr.message }, { status: 500 });
    }

    let enrollmentsSynced = 0;
    for (let i = 0; i < enrollmentRows.length; i += 500) {
      const batch = enrollmentRows.slice(i, i + 500);
      const { error } = await supabaseAdmin
        .from('after_school_enrollments_cache')
        .upsert(batch, { onConflict: 'workspace_id,enrollment_id' });
      if (error) {
        console.error('[AFTER-SCHOOL SYNC] enrollments upsert failed:', error);
        return NextResponse.json({ error: 'enrollments upsert failed', detail: error.message }, { status: 500 });
      }
      enrollmentsSynced += batch.length;
    }

    console.log(
      `[AFTER-SCHOOL SYNC] ws=${workspaceId} courses=${courses.length} allowedCourses=${allowedCourseIds.size} classes=${classesSynced} enrollments=${enrollmentsSynced}`,
    );

    return NextResponse.json({
      success: true,
      classes_synced: classesSynced,
      enrollments_synced: enrollmentsSynced,
      school_years: SYNC_SCHOOL_YEARS,
    });
  } catch (err) {
    console.error('[AFTER-SCHOOL SYNC] failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
