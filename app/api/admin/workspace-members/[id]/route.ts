import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, sessionIsSuperAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

// Retained only for the delete-protection fallback below (protects the
// super-admin's own row). Access gating uses sessionIsSuperAdmin.
const ADMIN_EMAIL = 'rglassberg@saracademy.org';

const VALID_ROLES = new Set(['owner', 'assistant', 'viewer']);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!sessionIsSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.allowed_modules !== undefined) updates.allowed_modules = body.allowed_modules;
    if (body.testing_features !== undefined) {
      if (!Array.isArray(body.testing_features) || !body.testing_features.every((k: unknown) => typeof k === 'string')) {
        return NextResponse.json({ error: 'testing_features must be a string array' }, { status: 400 });
      }
      // Dedup + drop any trimmable empties to keep the column tidy.
      updates.testing_features = Array.from(new Set(
        body.testing_features.map((k: string) => k.trim()).filter(Boolean),
      ));
    }
    if (body.role !== undefined) {
      if (!VALID_ROLES.has(body.role)) {
        return NextResponse.json({ error: `role must be one of: ${[...VALID_ROLES].join(', ')}` }, { status: 400 });
      }
      updates.role = body.role;
    }
    if (body.display_name !== undefined) updates.display_name = body.display_name;
    if (body.divisions !== undefined) {
      if (!Array.isArray(body.divisions)) {
        return NextResponse.json({ error: 'divisions must be an array' }, { status: 400 });
      }
      updates.divisions = body.divisions;
    }
    if (body.title !== undefined) updates.title = body.title;
    // assistant_to: this row "assists" the workspace_member with the
    // given id. Pass null to clear. Self-reference is rejected.
    if (body.assistant_to !== undefined) {
      if (body.assistant_to !== null && typeof body.assistant_to !== 'string') {
        return NextResponse.json({ error: 'assistant_to must be a string id or null' }, { status: 400 });
      }
      if (body.assistant_to === id) {
        return NextResponse.json({ error: 'assistant_to cannot self-reference' }, { status: 400 });
      }
      updates.assistant_to = body.assistant_to;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('workspace_members')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error('Admin: update member error:', error);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin: unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Remove a workspace member by id. Hard-deletes the row; the user will
 * lose access on their next session refresh (or immediately if their
 * session cookie expires). Refuses to delete the admin (ADMIN_EMAIL)
 * row to avoid locking out the management UI.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!sessionIsSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Refuse to delete the super-admin row (fallback to the ADMIN_EMAIL match).
    const { data: target } = await supabaseAdmin
      .from('workspace_members')
      .select('email, is_super_admin')
      .eq('id', id)
      .single();
    if (target?.is_super_admin === true || target?.email?.toLowerCase() === ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Cannot remove the super-admin account from the UI' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('workspace_members')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Admin: delete member error:', error);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin: unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
