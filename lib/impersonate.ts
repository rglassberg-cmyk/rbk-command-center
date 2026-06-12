import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

const ADMIN_EMAIL = 'rglassberg@saracademy.org';

/**
 * Returns the effective workspace ID, honoring X-Impersonated-Workspace-Id
 * header if the authenticated user is the admin (rglassberg@saracademy.org).
 */
export async function getEffectiveWorkspaceId(session: { user: { email: string | null }; workspaceId?: string | null }): Promise<string | null> {
  if (!session.user.email) return session.workspaceId || null;

  if (session.user.email.toLowerCase() === ADMIN_EMAIL) {
    try {
      const headerStore = await headers();
      const impersonatedId = headerStore.get('x-impersonated-workspace-id');
      if (impersonatedId) return impersonatedId;
    } catch { /* headers() may fail in some contexts */ }
  }

  return session.workspaceId || null;
}

interface EffectiveMembership {
  email: string;
  workspace_id: string;
  display_name: string | null;
  role: string;
  allowed_modules: Record<string, boolean> | null;
  divisions: string[];
}

/**
 * Returns the full impersonated membership if the admin is impersonating.
 * Reads X-Impersonated-Workspace-Id and X-Impersonated-Email headers.
 * Queries workspace_members for the target. Returns null if not impersonating.
 */
export async function getEffectiveMembership(session: { user: { email: string | null }; workspaceId?: string | null }): Promise<EffectiveMembership | null> {
  if (!session.user.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) return null;

  try {
    const headerStore = await headers();
    const impWorkspaceId = headerStore.get('x-impersonated-workspace-id');
    const impEmail = headerStore.get('x-impersonated-email');
    if (!impWorkspaceId || !impEmail) return null;

    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('email, workspace_id, display_name, role, allowed_modules, divisions')
      .eq('email', impEmail)
      .eq('workspace_id', impWorkspaceId)
      .limit(1)
      .single();

    if (!member) return null;

    return {
      email: member.email,
      workspace_id: member.workspace_id,
      display_name: member.display_name,
      role: member.role,
      allowed_modules: member.allowed_modules,
      divisions: member.divisions ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Returns the effective divisions for the current request. Prefers the
 * impersonated user's divisions when admin is impersonating; falls back
 * to the logged-in user's session.currentMember.divisions otherwise.
 * Used by Veracross routes to scope data per the user being viewed,
 * not the user holding the cookie.
 */
export async function getEffectiveDivisions(
  session: {
    user: { email: string | null };
    workspaceId?: string | null;
    currentMember?: { divisions?: string[] } | null;
  },
): Promise<string[]> {
  const impersonated = await getEffectiveMembership(session);
  if (impersonated) return impersonated.divisions;
  return session.currentMember?.divisions ?? [];
}
