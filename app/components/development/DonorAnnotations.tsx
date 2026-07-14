'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '@/lib/apiFetch';

// Predefined tags (must match server allowlist in /api/development/donor-tags/route.ts).
export const TAG_DEFS: { label: string; color: string }[] = [
  { label: 'Needs Follow-Up', color: '#f59e0b' },
  { label: 'Major Donor', color: '#8b5cf6' },
  { label: 'Lapsed', color: '#ef4444' },
  { label: 'Pledged Verbally', color: '#3b82f6' },
  { label: 'Thank You Sent', color: '#10b981' },
];

// Mentionable user shape — exported so call sites that fetch their own
// list (or want to pass a pre-resolved one in) can type the prop.
export interface MentionableUser {
  name: string;
  fullName: string;
  email: string;
  slackId: string | null;
}

// Hardcoded fallback / initial value. Kept on purpose: used as the seed
// state for the fetch in DonorAnnotations so the @ dropdown is never
// empty during the initial /api/workspace/mentionable-users round-trip,
// and as a defensive fallback if the fetch fails. The live list comes
// from workspace_members — see GET /api/workspace/mentionable-users.
export const MENTIONABLE_USERS: MentionableUser[] = [
  { name: 'RBK', fullName: 'Rabbi Krauss', email: 'kraussb@saracademy.org', slackId: 'U04NBR22Y' },
  { name: 'Emily', fullName: 'Emily Gray', email: 'emily.gray@saracademy.org', slackId: 'U05M5KT86GK' },
  { name: 'Sara', fullName: 'Sara Hasson', email: 'sara.hasson@saracademy.org', slackId: 'U04NB3YP3' },
  { name: 'Leora', fullName: 'Leora Miller', email: 'leora.miller@saracademy.org', slackId: 'U05M4L1RY6Q' },
  { name: 'Becca', fullName: 'Becca Glassberg', email: 'rglassberg@saracademy.org', slackId: 'U04PVHXSD' },
];

// Builds the @-mention regex source from the resolved user list. Returned
// fresh on every call so g-flag `lastIndex` doesn't leak between callers.
function buildMentionPattern(users: MentionableUser[]): string {
  const names = users.map(u => u.name).filter(Boolean);
  if (names.length === 0) return '(?!.*)'; // never matches — empty list edge case
  // Escape regex metacharacters in names. assignee_keys are
  // alphanumeric in practice, but a future workspace could add a name
  // containing punctuation.
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `@(${escaped.join('|')})(?![A-Za-z0-9])`;
}

// Renders a note string with `@<Name>` tokens replaced by inline blue pills.
// Builds a fresh regex per call — a module-shared g-flagged regex would
// have its `lastIndex` corrupted if two MentionText instances iterated
// concurrently (which can happen under React's concurrent rendering or
// Strict-Mode double-render, and we suspect contributed to a Safari hang).
// `users` prop is optional — defaults to the hardcoded MENTIONABLE_USERS
// fallback. Pass the resolved workspace list in to render pills for
// newly-added members.
export function MentionText({ text, users = MENTIONABLE_USERS }: { text: string; users?: MentionableUser[] }) {
  const pattern = useMemo(() => buildMentionPattern(users), [users]);
  const parts = useMemo(() => {
    const out: Array<{ kind: 'text'; value: string } | { kind: 'mention'; value: string }> = [];
    const re = new RegExp(pattern, 'g');
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIndex) {
        out.push({ kind: 'text', value: text.slice(lastIndex, m.index) });
      }
      out.push({ kind: 'mention', value: m[1] });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) {
      out.push({ kind: 'text', value: text.slice(lastIndex) });
    }
    return out;
  }, [text, pattern]);

  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'mention' ? (
          <span
            key={i}
            className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700 align-baseline"
          >
            @{p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

export interface DonorTag {
  id: string;
  constituent_name: string;
  constituent_id: string | null;
  tag: string;
  color: string;
  created_by: string;
  created_at: string;
}

export interface DonorNote {
  id: string;
  constituent_name: string;
  constituent_id: string | null;
  note: string;
  created_by: string;
  // Server-side enrichment from workspace_members.display_name. Falls
  // back to the raw `created_by` email if no member row matches. Always
  // present on responses from /api/development/donor-notes GET.
  author_name?: string | null;
  created_at: string;
  updated_at: string;
}

// Shape for the picker dropdown + pill rendering. `bg` lets a caller
// override the saturated default pill color with a softer Tailwind
// background class (admissions pages use this). When `bg` is set, the
// pill renders with class names; otherwise it falls back to the legacy
// inline-style hex from `donor_tags.color`.
export interface TagDef {
  label: string;
  color: string;
  bg?: string;
}

// Inline pill row of a donor's tags. Click a pill to remove. "+" opens
// a dropdown of the predefined tags that aren't already applied. The
// `tagDefs` prop overrides the module-level TAG_DEFS — admissions
// passes a different palette so the picker shows admissions-specific
// labels and the pills render with Tailwind tint classes instead of
// the saturated default.
export function TagPills({
  tags,
  onApply,
  onRemove,
  compact = false,
  tagDefs = TAG_DEFS,
}: {
  tags: DonorTag[];
  onApply: (tag: string) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
  tagDefs?: TagDef[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const applied = new Set(tags.map(t => t.tag));
  const available = tagDefs.filter(t => !applied.has(t.label));
  const pillSize = compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  // Lookup by label so applied-pill rendering can pick up the caller's
  // Tailwind classes when present, falling back to the hex on the row.
  const defByLabel = new Map<string, TagDef>(tagDefs.map(d => [d.label, d]));

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {tags.map(t => {
        const def = defByLabel.get(t.tag);
        // If the caller supplied a Tailwind `bg` class, render via
        // className so we can use soft tinted pills (admissions). Otherwise
        // fall back to the saturated inline-hex style (development),
        // matching the historical look on Guardian Circle / Cooper / Israel.
        const useTailwind = !!def?.bg;
        return (
          <button
            key={t.id}
            onClick={(e) => { e.stopPropagation(); onRemove(t.id); }}
            className={`${pillSize} rounded-full font-medium hover:opacity-80 transition-opacity inline-flex items-center gap-1 ${
              useTailwind ? `${def!.bg} ${def!.color}` : 'text-white'
            }`}
            style={useTailwind ? undefined : { backgroundColor: t.color }}
            title={`Remove "${t.tag}"`}
          >
            {t.tag}
            <span className="opacity-60">×</span>
          </button>
        );
      })}
      {available.length > 0 && (
        <span className="relative inline-block">
          <button
            onClick={(e) => { e.stopPropagation(); setPickerOpen(o => !o); }}
            className={`${pillSize} rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors font-medium`}
            title="Add tag"
          >
            + Tag
          </button>
          {pickerOpen && (
            <>
              <span
                className="fixed inset-0 z-10"
                onClick={(e) => { e.stopPropagation(); setPickerOpen(false); }}
              />
              <span className="absolute left-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px] flex flex-col">
                {available.map(t => {
                  // Swatch convention: Tailwind `bg` class when present
                  // (soft tint), otherwise inline-hex via `color`. The hex
                  // path also works for the legacy TAG_DEFS where `color`
                  // is "#hex".
                  const swatchTailwind = !!t.bg;
                  return (
                    <button
                      key={t.label}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApply(t.label);
                        setPickerOpen(false);
                      }}
                      className="text-left px-3 py-1.5 text-xs hover:bg-slate-50 inline-flex items-center gap-2"
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full inline-block ${swatchTailwind ? t.bg : ''}`}
                        style={swatchTailwind ? undefined : { backgroundColor: t.color }}
                      />
                      {t.label}
                    </button>
                  );
                })}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Detects an active "@<query>" being typed immediately before the caret.
// Returns the query (chars after the @) or null if no active mention.
function activeMentionQuery(value: string, caret: number): { query: string; atIndex: number } | null {
  // Walk backwards from caret looking for an @ preceded by start-of-string
  // or whitespace. Bail if we hit whitespace before finding @ (means we're
  // not actively typing a mention).
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '@') {
      const before = i === 0 ? ' ' : value[i - 1];
      if (/\s/.test(before)) {
        return { query: value.slice(i + 1, caret), atIndex: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

// Notes list + add-new input. Notes are workspace-shared; anyone with
// development access can see, add, and delete. The input supports @mention
// autocomplete over the `users` list (defaults to MENTIONABLE_USERS).
export function NotesList({
  notes,
  onAdd,
  onDelete,
  saving = false,
  users = MENTIONABLE_USERS,
  onDraftChange,
}: {
  notes: DonorNote[];
  onAdd: (note: string) => void;
  onDelete: (id: string) => void;
  saving?: boolean;
  users?: MentionableUser[];
  // Fires whenever the draft note text changes. Lets a parent mirror the
  // in-progress note (e.g. into a ref) without lifting the draft state —
  // used by the Admissions NotifyButton pre-fill. Called on every keystroke
  // so keep the handler cheap (a ref write, not a setState).
  onDraftChange?: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [mentionState, setMentionState] = useState<{ query: string; atIndex: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    return users.filter(u =>
      u.name.toLowerCase().startsWith(q) || u.fullName.toLowerCase().includes(q),
    );
  }, [mentionState, users]);

  const updateMentionState = (value: string, pos: number) => {
    setMentionState(activeMentionQuery(value, pos));
  };

  const insertMention = (name: string) => {
    if (!mentionState) return;
    const before = draft.slice(0, mentionState.atIndex);
    const after = draft.slice(caret);
    const inserted = `@${name} `;
    const next = before + inserted + after;
    const nextCaret = before.length + inserted.length;
    setDraft(next);
    onDraftChange?.(next);
    setMentionState(null);
    // Move focus + caret back into the input. Guarded for SSR even though
    // this handler only fires on a user click — defense-in-depth so the
    // component is fully safe to render server-side if ever needed.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
          setCaret(nextCaret);
        }
      });
    }
  };

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft('');
    onDraftChange?.('');
    setMentionState(null);
  };

  return (
    <div className="space-y-2">
      {notes.length === 0 && (
        <p className="text-xs text-slate-400 italic">No notes yet.</p>
      )}
      {notes.map(n => (
        <div key={n.id} className="bg-slate-50 rounded-lg px-3 py-2 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
              <MentionText text={n.note} users={users} />
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {n.author_name || n.created_by} · {formatTimestamp(n.created_at)}
            </p>
          </div>
          <button
            onClick={() => onDelete(n.id)}
            className="text-slate-300 hover:text-red-500 transition-colors p-1"
            title="Delete note"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
            </svg>
          </button>
        </div>
      ))}
      <div className="relative flex gap-2 pt-1">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              const pos = e.target.selectionStart ?? v.length;
              setDraft(v);
              onDraftChange?.(v);
              setCaret(pos);
              updateMentionState(v, pos);
            }}
            onSelect={(e) => {
              const t = e.currentTarget;
              const pos = t.selectionStart ?? t.value.length;
              setCaret(pos);
              updateMentionState(t.value, pos);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && mentionState) {
                e.preventDefault();
                setMentionState(null);
                return;
              }
              if (e.key === 'Enter') {
                if (mentionState && candidates.length > 0) {
                  e.preventDefault();
                  insertMention(candidates[0].name);
                  return;
                }
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add a note… (use @ to mention)"
            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {mentionState && candidates.length > 0 && (
            <div className="absolute left-0 bottom-full mb-1 z-30 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-56 overflow-y-auto">
              {candidates.map(u => (
                <button
                  key={u.email}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertMention(u.name); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-baseline gap-2"
                >
                  <span className="font-medium text-slate-800">@{u.name}</span>
                  <span className="text-xs text-slate-400 truncate">{u.fullName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={submit}
          disabled={!draft.trim() || saving}
          className="bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-slate-300"
        >
          {saving ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// Self-contained per-donor annotations block: fetches its own notes
// (tags should be passed in from a workspace-level bulk fetch to avoid
// N+1 requests on a 246-row table).
export default function DonorAnnotations({
  constituentName,
  constituentId,
  tags,
  onTagsChange,
  mentionableUsers,
  tagDefs,
  onDraftChange,
}: {
  constituentName: string;
  constituentId?: string | null;
  tags: DonorTag[];
  onTagsChange: (next: DonorTag[]) => void;
  // Mirrors the in-progress note draft to the parent (used by the
  // Admissions NotifyButton pre-fill). Optional — development call sites
  // don't pass it, so their behavior is unchanged.
  onDraftChange?: (text: string) => void;
  // Optional pre-resolved list. When omitted, the component fetches
  // /api/workspace/mentionable-users on mount. The hardcoded
  // MENTIONABLE_USERS fallback seeds the initial state so the autocomplete
  // dropdown is never empty during the round-trip.
  mentionableUsers?: MentionableUser[];
  // Per-context tag palette. Defaults to the development TAG_DEFS;
  // admissions passes a 5-tag palette with Tailwind tint classes.
  tagDefs?: TagDef[];
}) {
  const [notes, setNotes] = useState<DonorNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Resolved mention list. Prop wins; otherwise fetched on mount.
  // Falls back to MENTIONABLE_USERS so the dropdown is populated before
  // the fetch resolves and stays usable if the fetch fails.
  const [fetchedUsers, setFetchedUsers] = useState<MentionableUser[]>(MENTIONABLE_USERS);
  const resolvedUsers = mentionableUsers ?? fetchedUsers;

  useEffect(() => {
    // If the caller provided a list, skip the fetch entirely.
    if (mentionableUsers) return;
    let cancelled = false;
    apiFetch('/api/workspace/mentionable-users')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json?.users) return;
        const users = json.users as MentionableUser[];
        if (users.length > 0) setFetchedUsers(users);
      })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, [mentionableUsers]);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/development/donor-notes?constituent_name=${encodeURIComponent(constituentName)}`);
      if (res.ok) {
        const json = await res.json();
        setNotes(json.notes || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [constituentName]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const handleAddNote = async (note: string) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/development/donor-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          constituent_name: constituentName,
          constituent_id: constituentId ?? null,
          note,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setNotes(prev => [json.note, ...prev]);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDeleteNote = async (id: string) => {
    const prev = notes;
    setNotes(notes.filter(n => n.id !== id)); // optimistic
    try {
      const res = await apiFetch(`/api/development/donor-notes?id=${id}`, { method: 'DELETE' });
      if (!res.ok) setNotes(prev); // rollback
    } catch { setNotes(prev); }
  };

  // Resolved palette — prop wins, else module-level TAG_DEFS.
  const resolvedTagDefs = tagDefs ?? TAG_DEFS;

  const handleApplyTag = async (tagLabel: string) => {
    const def = resolvedTagDefs.find(t => t.label === tagLabel);
    if (!def) return;
    try {
      const res = await apiFetch('/api/development/donor-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          constituent_name: constituentName,
          constituent_id: constituentId ?? null,
          tag: tagLabel,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        onTagsChange([...tags, json.tag]);
      }
    } catch { /* ignore */ }
  };

  const handleRemoveTag = async (id: string) => {
    const prev = tags;
    onTagsChange(tags.filter(t => t.id !== id)); // optimistic
    try {
      const res = await apiFetch(`/api/development/donor-tags?id=${id}`, { method: 'DELETE' });
      if (!res.ok) onTagsChange(prev);
    } catch { onTagsChange(prev); }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">Tags</p>
        <TagPills tags={tags} onApply={handleApplyTag} onRemove={handleRemoveTag} tagDefs={resolvedTagDefs} />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">Notes</p>
        {loading ? (
          <p className="text-xs text-slate-400">Loading notes…</p>
        ) : (
          <NotesList
            notes={notes}
            onAdd={handleAddNote}
            onDelete={handleDeleteNote}
            saving={saving}
            users={resolvedUsers}
            onDraftChange={onDraftChange}
          />
        )}
      </div>
    </div>
  );
}
