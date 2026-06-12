import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Never cache — must always read fresh cookie state
export const dynamic = 'force-dynamic';

// Lightweight GET endpoint to read workspace fields from the httpOnly session cookie
// Used by AuthProvider to populate WorkspaceContext on the client
const EMPTY_WORKSPACE = {
  workspace_id: null, role: null, modules: null, module_config: null,
  allowed_modules: null, display_name: null, workspaces: [],
  current_member: null, assistant: null, principal: null,
  workspace_owner_email: null, workspace_brand: null,
  google_tasks_connected: false,
  testing_features: [] as string[],
  promoted_features: [] as string[],
};

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session');

    if (!sessionCookie?.value) {
      return NextResponse.json(EMPTY_WORKSPACE);
    }

    const data = JSON.parse(sessionCookie.value);

    // modules/module_config are stored at the top level for the active workspace
    return NextResponse.json({
      workspace_id: data.workspace_id || null,
      role: data.role || null,
      modules: data.modules || null,
      module_config: data.module_config || null,
      allowed_modules: data.allowed_modules || null,
      display_name: data.display_name || null,
      workspaces: data.workspaces || [],
      current_member: data.current_member || null,
      assistant: data.assistant || null,
      principal: data.principal || null,
      workspace_owner_email: data.workspace_owner_email || null,
      workspace_brand: data.workspace_brand || null,
      google_tasks_connected: !!data.google_tasks_connected,
      testing_features: Array.isArray(data.testing_features) ? data.testing_features : [],
      promoted_features: Array.isArray(data.promoted_features) ? data.promoted_features : [],
    });
  } catch {
    return NextResponse.json(EMPTY_WORKSPACE);
  }
}
