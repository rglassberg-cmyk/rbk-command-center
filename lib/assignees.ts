// Shared assignee normalization helpers.
//
// The DB now uniformly stores Capitalized assignee values
// (`tasks.assigned_to` and `agenda_notes.assignee` both CHECK against
// 'RBK' | 'Emily' | 'Sara' | 'Leora' | 'Becca'). Historically
// `agenda_notes` was lowercase, so the client UI still sends lowercase
// in some flows and reads lowercase. `normalizeToCapitalized` is used
// on every write path to coerce up; `toLegacyLowercase` is the
// transitional backward-compat shim used by the agenda-notes GET
// response so the UI continues to work unchanged. Phase B (Tasks-page
// generalization) will remove the lowercase shim once the UI is
// refactored to use dynamic per-user assignee keys.

const CANONICAL: Record<string, string> = {
  rbk: 'RBK', emily: 'Emily', sara: 'Sara', leora: 'Leora', becca: 'Becca',
  RBK: 'RBK', Emily: 'Emily', Sara: 'Sara', Leora: 'Leora', Becca: 'Becca',
};

export function normalizeToCapitalized(v?: string | null): string | undefined {
  if (!v) return undefined;
  return CANONICAL[v.trim()] ?? v;
}

// Backward-compat shim. The agenda-notes UI in Dashboard.tsx and
// TodayTasksCard expect lowercase. Returns lowercase for known names,
// passes through unknown values unchanged.
export function toLegacyLowercase(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (CANONICAL[t]) return CANONICAL[t].toLowerCase();
  return t.toLowerCase();
}
