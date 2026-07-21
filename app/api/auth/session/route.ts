import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyIdToken } from '@/lib/firebase-admin';
import { supabaseAdmin } from '@/lib/supabase';

const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json();

    if (!idToken) {
      return NextResponse.json({ error: 'Missing ID token' }, { status: 400 });
    }

    // Verify Firebase ID token via REST API
    const firebaseUser = await verifyIdToken(idToken);
    const email = firebaseUser.email?.toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'No email in token' }, { status: 400 });
    }

    // Check against allowed emails OR workspace_members table
    let isAllowed = allowedEmails.includes(email);
    if (!isAllowed) {
      // Check if email exists in workspace_members (case-insensitive, allows viewer sign-ins)
      const { data: memberCheck, count: memberCount } = await supabaseAdmin
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .ilike('email', email.trim());
      isAllowed = (memberCount != null && memberCount > 0) || (memberCheck != null && memberCheck.length > 0);
    }
    if (!isAllowed) {
      console.log('[AUTH] Access denied for email:', email, 'no matching workspace_members rows');
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Preserve existing access token if not provided in this request
    // (periodic ID token refreshes from AuthProvider don't include the access token)
    let resolvedAccessToken = accessToken || null;
    if (!resolvedAccessToken) {
      const cookieStore = await cookies();
      const existingSession = cookieStore.get('__session');
      if (existingSession?.value) {
        try {
          const existing = JSON.parse(existingSession.value);
          resolvedAccessToken = existing.accessToken || null;
        } catch {
          // ignore parse errors
        }
      }
    }

    // Look up ALL workspace memberships for this user
    interface WorkspaceEntry {
      id: string;
      name: string;
      role: string;
    }
    let workspaces: WorkspaceEntry[] = [];
    let defaultWorkspaceId: string | null = null;
    let defaultRole: string | null = null;
    let defaultDisplayName: string | null = null;
    let defaultModules: Record<string, boolean> | null = null;
    let defaultModuleConfig: Record<string, any> | null = null;
    let defaultAllowedModules: Record<string, boolean> | null = null;
    let defaultTestingFeatures: string[] = [];
    let defaultPromotedFeatures: string[] = [];
    let defaultWorkspaceOwnerEmail: string | null = null;
    let defaultWorkspaceBrand: Record<string, unknown> | null = null;
    // Phase B: identity payload for the logged-in user + their assistant.
    // currentMember.assigneeKey drives Tasks-page column filtering;
    // assistant (if non-null) makes the page show a second column.
    let currentMember: {
      assigneeKey: string | null;
      displayName: string | null;
      title: string | null;
      divisions: string[];
      slackUserId: string | null;
    } | null = null;
    let assistant: {
      assigneeKey: string | null;
      displayName: string | null;
      email: string | null;
      slackUserId: string | null;
    } | null = null;
    // `principal` is the inverse of `assistant` — the person the current
    // user assists. Tasks page uses (assistant ?? principal) as the
    // second-column partner so the layout is bidirectional: principals
    // see [me | assistant], assistants see [me | principal].
    let principal: {
      assigneeKey: string | null;
      displayName: string | null;
      email: string | null;
      slackUserId: string | null;
    } | null = null;
    // Whether the active workspace member has a non-null
    // google_tasks_refresh_token — surfaced to the Sidebar so it can
    // render "Connect Google Tasks" vs. "Google Tasks connected" without
    // a follow-up fetch.
    let googleTasksConnected = false;
    // Super-admin (system builder, e.g. Becca) vs. a plain workspace owner
    // (e.g. RBK). Gates the admin panel + admin-only actions.
    let defaultIsSuperAdmin = false;

    try {
      // Primary lookup: all rows by Firebase UID
      let { data: members } = await supabaseAdmin
        .from('workspace_members')
        .select('id, workspace_id, role, display_name, user_id, allowed_modules, testing_features, is_super_admin')
        .eq('user_id', firebaseUser.localId);

      // Fallback lookup: by email (case-insensitive, handles placeholder user_ids)
      if (!members || members.length === 0) {
        const { data: emailMembers } = await supabaseAdmin
          .from('workspace_members')
          .select('id, workspace_id, role, display_name, user_id, allowed_modules, testing_features, is_super_admin')
          .ilike('email', email.trim());

        if (emailMembers && emailMembers.length > 0) {
          members = emailMembers;

          // Replace placeholder user_ids with real Firebase UID
          for (const m of emailMembers) {
            if (m.user_id?.includes('PLACEHOLDER')) {
              await supabaseAdmin
                .from('workspace_members')
                .update({ user_id: firebaseUser.localId })
                .eq('id', m.id);
            }
          }
        }
      }

      if (members && members.length > 0) {
        // Fetch workspace details for all memberships
        const workspaceIds = members.map(m => m.workspace_id);
        const { data: workspaceRows } = await supabaseAdmin
          .from('workspaces')
          .select('id, name, modules, module_config, owner_email, brand, promoted_features')
          .in('id', workspaceIds);

        const wsMap = new Map(
          (workspaceRows || []).map(w => [w.id, w])
        );

        // Build workspaces array, preferring owner role first for default
        const sorted = [...members].sort((a, b) => {
          if (a.role === 'owner' && b.role !== 'owner') return -1;
          if (a.role !== 'owner' && b.role === 'owner') return 1;
          return 0;
        });

        // Keep workspaces array minimal to stay under 4KB cookie limit
        // modules/module_config are only stored for the active workspace at the top level
        workspaces = sorted.map(m => {
          const ws = wsMap.get(m.workspace_id);
          return {
            id: m.workspace_id,
            name: ws?.name || 'Unknown',
            role: m.role,
          };
        });

        // Default = first sorted member (owner preferred)
        const defaultMember = sorted[0];
        const defaultWs = wsMap.get(defaultMember.workspace_id);
        defaultWorkspaceId = defaultMember.workspace_id;
        defaultRole = defaultMember.role;
        defaultDisplayName = defaultMember.display_name;
        defaultModules = (defaultWs?.modules as Record<string, boolean>) || null;
        defaultModuleConfig = (defaultWs?.module_config as Record<string, any>) || null;
        defaultAllowedModules = (defaultMember as any).allowed_modules || null;
        defaultTestingFeatures = Array.isArray((defaultMember as any).testing_features)
          ? (defaultMember as any).testing_features
          : [];
        defaultIsSuperAdmin = (defaultMember as any).is_super_admin === true;
        defaultWorkspaceOwnerEmail = (defaultWs as any)?.owner_email || null;
        defaultWorkspaceBrand = (defaultWs as any)?.brand || null;
        defaultPromotedFeatures = Array.isArray((defaultWs as any)?.promoted_features)
          ? (defaultWs as any).promoted_features
          : [];

        // Phase B: look up the active member's identity fields + their
        // assistant for Tasks-page column rendering. Both rows come from
        // the same workspace; assistant_to FK is workspace_members.id.
        try {
          const { data: memberRow } = await supabaseAdmin
            .from('workspace_members')
            .select('id, assignee_key, display_name, title, divisions, assistant_to, slack_user_id, google_tasks_refresh_token')
            .eq('id', defaultMember.id)
            .single();

          if (memberRow) {
            currentMember = {
              assigneeKey: memberRow.assignee_key ?? null,
              displayName: memberRow.display_name ?? firebaseUser.displayName ?? null,
              title: memberRow.title ?? null,
              divisions: memberRow.divisions ?? [],
              slackUserId: memberRow.slack_user_id ?? null,
            };
            googleTasksConnected = !!memberRow.google_tasks_refresh_token;

            // The assistant of THIS user is whoever has `assistant_to`
            // pointing back to THIS member's id. `assistant_to` lives on
            // the assistant's row (semantically "I assist <X>"), so
            // resolving the principal's assistant is a reverse lookup,
            // not a direct read of memberRow.assistant_to.
            const { data: assistantRow } = await supabaseAdmin
              .from('workspace_members')
              .select('assignee_key, display_name, email, slack_user_id')
              .eq('assistant_to', memberRow.id)
              .maybeSingle();
            if (assistantRow) {
              assistant = {
                assigneeKey: assistantRow.assignee_key ?? null,
                displayName: assistantRow.display_name ?? null,
                email: assistantRow.email ?? null,
                slackUserId: assistantRow.slack_user_id ?? null,
              };
            }

            // If THIS user is themselves an assistant (memberRow.assistant_to
            // is non-null), resolve the principal they assist — i.e. the
            // forward read of the same FK pointer. The Tasks page treats
            // assistant and principal symmetrically.
            if (memberRow.assistant_to) {
              const { data: principalRow } = await supabaseAdmin
                .from('workspace_members')
                .select('assignee_key, display_name, email, slack_user_id')
                .eq('id', memberRow.assistant_to)
                .maybeSingle();
              if (principalRow) {
                principal = {
                  assigneeKey: principalRow.assignee_key ?? null,
                  displayName: principalRow.display_name ?? null,
                  email: principalRow.email ?? null,
                  slackUserId: principalRow.slack_user_id ?? null,
                };
              }
            }
          }
        } catch (err) {
          console.warn('[session] currentMember/assistant lookup failed:', err);
        }
      }
    } catch {
      // Workspace tables may not exist yet — don't break sign-in
    }

    // Build session payload — keep minimal to stay under 4KB cookie limit
    // idToken is NOT stored (only needed during this POST, never read back)
    const sessionData = JSON.stringify({
      accessToken: resolvedAccessToken,
      user: {
        email: firebaseUser.email,
        name: firebaseUser.displayName || null,
        image: firebaseUser.photoUrl || null,
      },
      workspace_id: defaultWorkspaceId,
      role: defaultRole,
      is_super_admin: defaultIsSuperAdmin,
      display_name: defaultDisplayName,
      modules: defaultModules,
      module_config: defaultModuleConfig,
      allowed_modules: defaultAllowedModules,
      workspaces,
      current_member: currentMember,
      assistant,
      principal,
      workspace_owner_email: defaultWorkspaceOwnerEmail,
      workspace_brand: defaultWorkspaceBrand,
      google_tasks_connected: googleTasksConnected,
      testing_features: defaultTestingFeatures,
      promoted_features: defaultPromotedFeatures,
    });

    // Set __session cookie (Firebase Hosting only forwards this cookie name)
    const response = NextResponse.json({ success: true });
    response.cookies.set('__session', sessionData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours — access token preserved across ID token refreshes
    });

    return response;
  } catch (error) {
    // Only log unexpected errors — expired/missing tokens are expected
    const message = error instanceof Error ? error.message : String(error);
    const isExpected = message.includes('Invalid token') ||
      message.includes('TOKEN_EXPIRED') ||
      message.includes('INVALID_ID_TOKEN') ||
      message.includes('user not found') ||
      message.includes('Decoding Firebase session cookie failed');
    if (!isExpected) {
      console.error('Session creation error:', message);
    }
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
