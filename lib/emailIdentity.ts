// Sender identity resolution for outbound email routes.
//
// Phase C moved the From address + signature from hardcoded constants
// inside each send route to per-user lookups against workspace_members
// (`email_identity_html`, `display_name`, `title`, `email`).
//
// The LEGACY_RBK_* fallbacks are intentional and load-bearing: if a
// member somehow lacks `email_identity_html` (new user not yet
// configured, race condition), we'd rather send RBK's existing
// signature than drop the signature entirely — RBK sends daily and a
// missing signature would be more disruptive than a wrong one.

import { supabaseAdmin } from './supabase';

export const LEGACY_RBK_FROM_EMAIL = 'kraussb@saracademy.org';
export const LEGACY_RBK_FROM_NAME = 'Rabbi Binyamin Krauss';

// The exact signature that has been baked into compose / send-batch /
// [id]/send for months. Mirrored in workspace_members.email_identity_html
// for kraussb@saracademy.org via the Phase C backfill migration.
export const LEGACY_RBK_SIGNATURE = `
<br><br>
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
  <p style="margin: 0; color: #0066cc; font-weight: bold;">Rabbi Binyamin Krauss</p>
  <p style="margin: 0; color: #0066cc;">Principal</p>
  <p style="margin: 8px 0 0 0;">
    <span style="color: #666;">p</span> | <a href="tel:7185481717" style="color: #333; text-decoration: none;">718.548.1717 ext. 1206</a>
  </p>
  <p style="margin: 0;">
    <span style="color: #666;">e</span> | <a href="mailto:kraussb@saracademy.org" style="color: #0066cc; text-decoration: none;">kraussb@saracademy.org</a>
  </p>
  <p style="margin: 4px 0 8px 0;">
    <a href="https://www.linkedin.com/in/bini-krauss/" style="color: #0066cc; text-decoration: none;">LinkedIn</a>
  </p>
  <img src="https://photos.smugmug.com/photos/i-bWnQXVn/2/MPtkRLsvBjfzcTb8qdm3vNRwmJntjMxwjjLzFVpf4/O/i-bWnQXVn.png" alt="SAR Academy" width="120" style="display:block;margin-top:8px;" />
</div>
`;

export interface SenderIdentity {
  fromEmail: string;
  fromName: string;
  signatureHtml: string;
}

// Resolve the sender identity for a user in a workspace. Reads
// workspace_members and falls back to RBK constants on any missing
// field (defense-in-depth — the row should always exist for authed
// users, but the fallback prevents a malformed email send if it
// doesn't).
export async function getSenderIdentity(
  workspaceId: string,
  userEmail: string,
): Promise<SenderIdentity> {
  const { data: member } = await supabaseAdmin
    .from('workspace_members')
    .select('email, display_name, title, email_identity_html')
    .eq('workspace_id', workspaceId)
    .ilike('email', userEmail.trim())
    .maybeSingle();

  const fromEmail = member?.email || LEGACY_RBK_FROM_EMAIL;
  const fromName = member?.display_name
    ? (member.title ? `${member.display_name}` : member.display_name)
    : LEGACY_RBK_FROM_NAME;
  const signatureHtml = member?.email_identity_html || LEGACY_RBK_SIGNATURE;

  return { fromEmail, fromName, signatureHtml };
}
