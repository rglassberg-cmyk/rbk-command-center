import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { hasSubPermission } from '@/lib/modules';
import { supabaseAdmin } from '@/lib/supabase';
import { type NextRequest } from 'next/server';

// Enrollment settings stored in workspace_settings as JSON keyed by grade
// label. Currently powers the manually-entered Pisgah counts on the Current
// Enrollment By Grade table (key 'pisgah_counts'). 'enrollment_budgeted' is
// whitelisted for future use, but the projection "Budgeted" column keeps using
// the dedicated enrollment_budget table via /api/admissions/budget (unchanged).
const ALLOWED_KEYS = ['pisgah_counts', 'enrollment_budgeted'] as const;
type SettingKey = (typeof ALLOWED_KEYS)[number];

// Mirror of the client's canEditEnrollment: owner, admissions_manager, or
// either edit_enrollment_* sub-permission.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canEditEnrollment(session: { role?: string | null; allowedModules?: Record<string, any> | null }): boolean {
  if (session.role === 'owner') return true;
  return (
    hasSubPermission(session.allowedModules, 'admissions', 'admissions_manager') ||
    hasSubPermission(session.allowedModules, 'admissions', 'edit_enrollment_budget') ||
    hasSubPermission(session.allowedModules, 'admissions', 'edit_enrollment_data')
  );
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('workspace_settings')
    .select('key, value')
    .eq('workspace_id', session.workspaceId)
    .in('key', ALLOWED_KEYS as unknown as string[]);

  if (error) {
    console.error('[enrollment-settings] read error:', error.message);
    return NextResponse.json({ pisgah_counts: {}, enrollment_budgeted: {} });
  }

  const out: Record<string, unknown> = { pisgah_counts: {}, enrollment_budgeted: {} };
  for (const row of data || []) {
    out[row.key] = row.value ?? {};
  }
  return NextResponse.json(out);
}

export async function PATCH(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canEditEnrollment(session)) {
    return NextResponse.json({ error: 'Not permitted to edit enrollment data' }, { status: 403 });
  }

  let body: { key?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const key = body.key as SettingKey;
  if (typeof key !== 'string' || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json({ error: `key must be one of ${ALLOWED_KEYS.join(', ')}` }, { status: 400 });
  }
  if (typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
    return NextResponse.json({ error: 'value must be a JSON object keyed by grade label' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('workspace_settings')
    .upsert(
      {
        workspace_id: session.workspaceId,
        key,
        value: body.value,
        updated_by: session.user.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,key' },
    );

  if (error) {
    console.error('[enrollment-settings] upsert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, key, value: body.value });
}
