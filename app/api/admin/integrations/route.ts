// Phase F: per-workspace integration credential management.
//
// GET    → list integrations for the current workspace (CREDENTIALS REDACTED)
// POST   → upsert credentials for one integration type
// DELETE → deactivate one integration (sets is_active = false)
//
// All routes are admin-gated (rglassberg@). Credentials are never
// returned to the client — only the `hasCredentials` boolean +
// per-field present/missing flags are surfaced. The actual values
// stay in workspace_integrations.credentials (RLS-locked).

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { invalidateIntegrationCache, type IntegrationType } from '@/lib/getIntegration';

const ADMIN_EMAIL = 'rglassberg@saracademy.org';
const VALID_TYPES: IntegrationType[] = ['veracross', 'slack', 'lever', 'anthropic', 'rise_vision'];

function gate(email?: string | null): NextResponse | null {
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (email.toLowerCase() !== ADMIN_EMAIL) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

interface IntegrationRow {
  integration_type: string;
  credentials: Record<string, string> | null;
  is_active: boolean;
  connected_at: string;
  connected_by: string | null;
  updated_at: string;
}

// Redact credentials — return only field presence (not values).
function redact(row: IntegrationRow) {
  const fields = Object.entries(row.credentials || {}).reduce<Record<string, boolean>>((acc, [k, v]) => {
    acc[k] = !!v && String(v).length > 0;
    return acc;
  }, {});
  return {
    integration_type: row.integration_type,
    is_active: row.is_active,
    connected_at: row.connected_at,
    connected_by: row.connected_by,
    updated_at: row.updated_at,
    hasCredentials: Object.values(fields).some(Boolean),
    fields, // map of field_name → boolean (is the field populated?)
  };
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  const blocked = gate(session?.user?.email);
  if (blocked) return blocked;

  const wsId = new URL(request.url).searchParams.get('workspace_id') || session?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('workspace_integrations')
    .select('integration_type, credentials, is_active, connected_at, connected_by, updated_at')
    .eq('workspace_id', wsId);

  if (error) {
    console.error('[admin/integrations] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  return NextResponse.json({
    integrations: (data || []).map(r => redact(r as IntegrationRow)),
  });
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  const blocked = gate(session?.user?.email);
  if (blocked) return blocked;

  let body: { workspace_id?: string; integration_type?: string; credentials?: Record<string, string> };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const wsId = body.workspace_id || session?.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!body.integration_type || !VALID_TYPES.includes(body.integration_type as IntegrationType)) {
    return NextResponse.json({ error: `integration_type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!body.credentials || typeof body.credentials !== 'object') {
    return NextResponse.json({ error: 'credentials object required' }, { status: 400 });
  }

  // Merge with existing credentials so partial updates (e.g. "just refresh the
  // API key") don't wipe other fields. Pre-Phase-F deploys have no row at all,
  // so the merge is just an insert in that case.
  const { data: existing } = await supabaseAdmin
    .from('workspace_integrations')
    .select('credentials')
    .eq('workspace_id', wsId)
    .eq('integration_type', body.integration_type)
    .maybeSingle();
  const merged = { ...(existing?.credentials || {}), ...body.credentials };
  // Strip empty-string values so they can fall back to env vars on read.
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v !== 'string' || v.trim() === '') delete (merged as Record<string, unknown>)[k];
  }

  const { error } = await supabaseAdmin
    .from('workspace_integrations')
    .upsert({
      workspace_id: wsId,
      integration_type: body.integration_type,
      credentials: merged,
      is_active: true,
      connected_by: session?.user?.email ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,integration_type' });

  if (error) {
    console.error('[admin/integrations] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }

  invalidateIntegrationCache(wsId, body.integration_type as IntegrationType);
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getAuthSession();
  const blocked = gate(session?.user?.email);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const wsId = url.searchParams.get('workspace_id') || session?.workspaceId;
  const type = url.searchParams.get('integration_type');
  if (!wsId || !type) {
    return NextResponse.json({ error: 'workspace_id and integration_type required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('workspace_integrations')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', wsId)
    .eq('integration_type', type);

  if (error) {
    console.error('[admin/integrations] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }

  invalidateIntegrationCache(wsId, type as IntegrationType);
  return NextResponse.json({ success: true });
}
