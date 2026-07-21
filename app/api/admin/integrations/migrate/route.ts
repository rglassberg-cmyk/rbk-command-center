// Phase F: one-time migration from process.env → workspace_integrations.
// Idempotent — if a row already exists for (workspace_id, type), it
// is skipped (no overwrite). Admin-gated.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, sessionIsSuperAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { invalidateIntegrationCache } from '@/lib/getIntegration';


interface MigrationResult {
  type: string;
  status: 'inserted' | 'skipped_already_exists' | 'skipped_no_env';
  fields?: string[];
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!sessionIsSuperAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { workspaceId?: string };
  try { body = await request.json(); } catch { body = {}; }
  const wsId = body.workspaceId || session.workspaceId;
  if (!wsId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });

  // Build per-integration credential blobs from process.env. Empty
  // strings are stripped so env fallback still kicks in.
  const candidates: Array<{ type: string; creds: Record<string, string> }> = [
    {
      type: 'veracross',
      creds: {
        clientId: process.env.VERACROSS_CLIENT_ID || '',
        clientSecret: process.env.VERACROSS_CLIENT_SECRET || '',
        admissionsClientId: process.env.VERACROSS_ADMISSIONS_CLIENT_ID || '',
        admissionsClientSecret: process.env.VERACROSS_ADMISSIONS_CLIENT_SECRET || '',
        schoolCode: process.env.VERACROSS_SCHOOL_ROUTE || 'sar',
      },
    },
    {
      type: 'slack',
      creds: { botToken: process.env.SLACK_BOT_TOKEN || '' },
    },
    {
      type: 'lever',
      creds: { apiKey: process.env.LEVER_API_KEY || '' },
    },
    {
      type: 'anthropic',
      creds: { apiKey: process.env.ANTHROPIC_API_KEY || '' },
    },
  ];

  const results: MigrationResult[] = [];

  for (const c of candidates) {
    // Strip empty fields
    const nonEmpty: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.creds)) {
      if (v && v.trim().length > 0) nonEmpty[k] = v;
    }
    if (Object.keys(nonEmpty).length === 0) {
      results.push({ type: c.type, status: 'skipped_no_env' });
      continue;
    }

    const { data: existing } = await supabaseAdmin
      .from('workspace_integrations')
      .select('id')
      .eq('workspace_id', wsId)
      .eq('integration_type', c.type)
      .maybeSingle();

    if (existing) {
      results.push({ type: c.type, status: 'skipped_already_exists' });
      continue;
    }

    const { error } = await supabaseAdmin
      .from('workspace_integrations')
      .insert({
        workspace_id: wsId,
        integration_type: c.type,
        credentials: nonEmpty,
        is_active: true,
        connected_by: 'system-migration',
      });

    if (error) {
      console.error('[integrations/migrate] insert failed for', c.type, error);
      results.push({ type: c.type, status: 'skipped_no_env' });
      continue;
    }

    results.push({ type: c.type, status: 'inserted', fields: Object.keys(nonEmpty) });
    invalidateIntegrationCache(wsId, c.type as 'veracross' | 'slack' | 'lever' | 'anthropic');
  }

  return NextResponse.json({ workspaceId: wsId, results });
}
