import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

// Admin-only management of user_briefing_preferences rows for the
// active workspace. Used by the Morning Briefings → Onboarding sub-tab
// in the admin UI.
//
//   GET   → list rows (joined with display_name from workspace_members)
//   PATCH → toggle a single row's onboarding_complete (reset flow)

const ADMIN_EMAIL = 'rglassberg@saracademy.org';
const SAR_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function gate() {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (session.user.email.toLowerCase() !== ADMIN_EMAIL && session.role !== 'owner') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const g = await gate();
  if ('error' in g) return g.error;

  const { data: prefs, error } = await supabaseAdmin
    .from('user_briefing_preferences')
    .select('email, onboarding_complete, onboarding_sent_at, preferences_summary')
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[BUZZ ONBOARDING GET]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  // Join display_name from workspace_members so the table renders nicely.
  const emails = (prefs || []).map(p => p.email);
  let nameByEmail: Record<string, string | null> = {};
  if (emails.length > 0) {
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('email, display_name')
      .eq('workspace_id', SAR_WORKSPACE_ID)
      .in('email', emails);
    nameByEmail = Object.fromEntries(
      (members || []).map(m => [m.email, m.display_name ?? null]),
    );
  }
  const rows = (prefs || []).map(p => ({
    email: p.email,
    display_name: nameByEmail[p.email] ?? null,
    onboarding_complete: p.onboarding_complete,
    onboarding_sent_at: p.onboarding_sent_at,
    preferences_summary: p.preferences_summary,
  }));
  return NextResponse.json({ rows });
}

export async function PATCH(request: NextRequest) {
  const g = await gate();
  if ('error' in g) return g.error;

  let body: { email?: string; onboarding_complete?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.email || typeof body.onboarding_complete !== 'boolean') {
    return NextResponse.json({ error: 'email and onboarding_complete required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('user_briefing_preferences')
    .update({
      onboarding_complete: body.onboarding_complete,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', SAR_WORKSPACE_ID)
    .eq('email', body.email);
  if (error) {
    console.error('[BUZZ ONBOARDING PATCH]', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
