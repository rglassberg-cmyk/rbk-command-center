// Phase F: per-workspace integration credentials.
//
// Credentials live in the `workspace_integrations` table (RLS-locked
// to service role). This module reads them via supabaseAdmin and
// caches per (workspaceId, integration_type) for 5 minutes to avoid
// hammering the DB on every API call. Every typed helper falls back
// to the corresponding `process.env` value when no DB row exists —
// SAR's pre-Phase-F deployment keeps working without any migration
// run; the migrate endpoint is what shifts the source of truth from
// env to DB.
//
// Falls back via `||` rather than `??` so that an empty-string in DB
// still picks up the env var fallback (an empty DB value almost
// always means "user cleared this field, please use the default").

import { supabaseAdmin } from './supabase';

export type IntegrationType =
  | 'veracross'
  | 'slack'
  | 'lever'
  | 'anthropic'
  | 'rise_vision';

export type IntegrationCredentials = Record<string, string>;

interface CacheEntry {
  data: IntegrationCredentials | null;
  expiresAt: number;
}
const integrationCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getIntegration(
  workspaceId: string,
  type: IntegrationType,
): Promise<IntegrationCredentials | null> {
  const cacheKey = `${workspaceId}:${type}`;
  const cached = integrationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data } = await supabaseAdmin
    .from('workspace_integrations')
    .select('credentials, is_active')
    .eq('workspace_id', workspaceId)
    .eq('integration_type', type)
    .eq('is_active', true)
    .maybeSingle();

  const creds = (data?.credentials as IntegrationCredentials | undefined) ?? null;
  integrationCache.set(cacheKey, { data: creds, expiresAt: Date.now() + CACHE_TTL_MS });
  return creds;
}

export function invalidateIntegrationCache(workspaceId: string, type?: IntegrationType) {
  if (type) {
    integrationCache.delete(`${workspaceId}:${type}`);
    return;
  }
  for (const key of integrationCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) integrationCache.delete(key);
  }
}

// ─── Typed convenience helpers ──────────────────────────────────────
// Each helper returns the DB credentials with `process.env` fallback
// per field, so SAR's deployment keeps working before the migrate
// endpoint runs.

export interface VeracrossCredentials {
  clientId: string;
  clientSecret: string;
  admissionsClientId: string;
  admissionsClientSecret: string;
  schoolCode: string;
}

export async function getVeracrossCredentials(workspaceId: string): Promise<VeracrossCredentials> {
  const db = await getIntegration(workspaceId, 'veracross');
  return {
    clientId: db?.clientId || process.env.VERACROSS_CLIENT_ID || '',
    clientSecret: db?.clientSecret || process.env.VERACROSS_CLIENT_SECRET || '',
    admissionsClientId: db?.admissionsClientId || process.env.VERACROSS_ADMISSIONS_CLIENT_ID || '',
    admissionsClientSecret: db?.admissionsClientSecret || process.env.VERACROSS_ADMISSIONS_CLIENT_SECRET || '',
    schoolCode: db?.schoolCode || process.env.VERACROSS_SCHOOL_ROUTE || 'sar',
  };
}

export interface SlackCredentials {
  botToken: string;
}

export async function getSlackCredentials(workspaceId: string): Promise<SlackCredentials> {
  const db = await getIntegration(workspaceId, 'slack');
  return {
    botToken: db?.botToken || process.env.SLACK_BOT_TOKEN || '',
  };
}

export interface LeverCredentials {
  apiKey: string;
}

export async function getLeverCredentials(workspaceId: string): Promise<LeverCredentials> {
  const db = await getIntegration(workspaceId, 'lever');
  return {
    apiKey: db?.apiKey || process.env.LEVER_API_KEY || '',
  };
}

export interface AnthropicCredentials {
  apiKey: string;
}

export async function getAnthropicCredentials(workspaceId: string): Promise<AnthropicCredentials> {
  const db = await getIntegration(workspaceId, 'anthropic');
  return {
    apiKey: db?.apiKey || process.env.ANTHROPIC_API_KEY || '',
  };
}
