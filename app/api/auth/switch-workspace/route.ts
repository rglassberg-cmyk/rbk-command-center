import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await request.json();

    if (!workspaceId) {
      return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
    }

    // Read current session
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session');

    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const session = JSON.parse(sessionCookie.value);
    const workspaces = session.workspaces || [];

    // Verify user is a member of the requested workspace (from session data)
    const target = workspaces.find((w: { id: string }) => w.id === workspaceId);

    if (!target) {
      // Double-check against the database as a safety net
      const userEmail = session.user?.email;
      if (!userEmail) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const { data: member } = await supabaseAdmin
        .from('workspace_members')
        .select('workspace_id')
        .eq('email', userEmail)
        .eq('workspace_id', workspaceId)
        .limit(1)
        .single();

      if (!member) {
        return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
      }
    }

    // Fetch workspace details + member details from the database
    const { data: wsData } = await supabaseAdmin
      .from('workspaces')
      .select('modules, module_config')
      .eq('id', workspaceId)
      .single();

    // Fetch member role, display_name, and allowed_modules for this workspace
    const userEmail = session.user?.email;
    const { data: memberData } = userEmail ? await supabaseAdmin
      .from('workspace_members')
      .select('role, display_name, allowed_modules')
      .eq('email', userEmail)
      .eq('workspace_id', workspaceId)
      .limit(1)
      .single() : { data: null };

    // Re-set the session cookie with the new active workspace
    const updatedSession = JSON.stringify({
      ...session,
      workspace_id: workspaceId,
      role: memberData?.role || target?.role || session.role,
      display_name: memberData?.display_name || session.display_name,
      modules: wsData?.modules || null,
      module_config: wsData?.module_config || null,
      allowed_modules: memberData?.allowed_modules || null,
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set('__session', updatedSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Failed to switch workspace' }, { status: 500 });
  }
}
