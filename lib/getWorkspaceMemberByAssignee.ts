import { supabaseAdmin } from './supabase';

export interface WorkspaceMemberLookup {
  id: string;
  email: string;
  display_name: string | null;
  assignee_key: string | null;
  slack_user_id: string | null;
  divisions: string[];
  title: string | null;
  assistant_to: string | null;
}

const SELECT_COLS = 'id, email, display_name, assignee_key, slack_user_id, divisions, title, assistant_to';

// All mentionable members for a workspace — those with assignee_key set.
// Used by the donor-notes server route to parse @mentions and by any
// future feature that needs the list of task-assignable users.
export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberLookup[]> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select(SELECT_COLS)
    .eq('workspace_id', workspaceId)
    .not('assignee_key', 'is', null);
  return (data ?? []) as WorkspaceMemberLookup[];
}

// Single member by their assignee_key (case-insensitive). Used by
// sendTaskSlack to resolve a slack_user_id from a string like 'RBK' or
// 'emily'.
export async function getMemberByAssigneeKey(
  workspaceId: string,
  key: string,
): Promise<WorkspaceMemberLookup | null> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select(SELECT_COLS)
    .eq('workspace_id', workspaceId)
    .ilike('assignee_key', key.trim())
    .maybeSingle();
  return (data as WorkspaceMemberLookup | null) ?? null;
}

// Get the current user's workspace_member row by their email. Used by
// API routes to load divisions for the request's filter logic.
export async function getMemberByEmail(
  workspaceId: string,
  email: string,
): Promise<WorkspaceMemberLookup | null> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select(SELECT_COLS)
    .eq('workspace_id', workspaceId)
    .ilike('email', email.trim())
    .maybeSingle();
  return (data as WorkspaceMemberLookup | null) ?? null;
}
