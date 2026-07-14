'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

// Self-contained "@Notify" button + popover. Drop it anywhere: it fetches
// the workspace's members, lets the user pick one or more people + write a
// message, then POSTs to /api/notify (which opens a Slack group DM and
// creates a task on each tagged member's list).
//
//   <NotifyButton context="Admissions & Enrollment" />
//   <NotifyButton context="Admissions: Jane Doe" message={noteText} onSent={...} />

interface WorkspaceMember {
  id: string;
  name: string;
  fullName?: string | null;
  email: string;
  slackId: string | null;
  role: string;
}

interface NotifyButtonProps {
  context: string;
  message?: string;
  onSent?: () => void;
  className?: string;
  // Optional lazy message source, read at the moment the popover opens.
  // Used by the Admissions candidate cards to pre-fill the notify message
  // with whatever the user has currently typed in the note field (which
  // lives in a ref, so no re-render churn). Takes precedence over `message`
  // when opening.
  getMessage?: () => string;
}

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  owner: { label: 'Owner', cls: 'bg-blue-50 text-blue-700' },
  assistant: { label: 'Assistant', cls: 'bg-purple-50 text-purple-700' },
  viewer: { label: 'Member', cls: 'bg-slate-100 text-slate-600' },
};

function initialOf(m: WorkspaceMember): string {
  const src = (m.fullName || m.name || m.email).trim();
  return (src[0] || '?').toUpperCase();
}

export default function NotifyButton({ context, message, onSent, className, getMessage }: NotifyButtonProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [text, setText] = useState(message ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the textarea in sync if the incoming message prop changes while
  // the popover is closed (e.g. a different candidate's note).
  useEffect(() => {
    if (!open) setText(message ?? '');
  }, [message, open]);

  // Load members once, on first open.
  useEffect(() => {
    if (!open || membersLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/workspace/mentionable-users');
        if (!res.ok) throw new Error('load failed');
        const json = (await res.json()) as { users: WorkspaceMember[] };
        if (!cancelled) {
          setMembers(json.users || []);
          setMembersLoaded(true);
        }
      } catch {
        if (!cancelled) setMembersLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, membersLoaded]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = members.filter(m => !selectedIds.includes(m.id));
    if (!q) return list;
    return list.filter(m =>
      (m.fullName || m.name || '').toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q),
    );
  }, [members, selectedIds, search]);

  const selected = useMemo(
    () => selectedIds.map(id => members.find(m => m.id === id)).filter((m): m is WorkspaceMember => !!m),
    [selectedIds, members],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setSearch('');
  }, []);

  const reset = useCallback(() => {
    setSelectedIds([]);
    setSearch('');
    setText(message ?? '');
    setStatus('idle');
    setErrorMsg(null);
  }, [message]);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const canSend = selectedIds.length > 0 && text.trim().length > 0 && status !== 'sending';

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setStatus('sending');
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          context,
          tagged_member_ids: selectedIds,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || json.success !== true) {
        setStatus('error');
        setErrorMsg(json.error || 'Failed to send');
        return;
      }
      setStatus('sent');
      onSent?.();
      setTimeout(() => close(), 1500);
    } catch {
      setStatus('error');
      setErrorMsg('Failed to send');
    }
  }, [canSend, text, context, selectedIds, onSent, close]);

  return (
    <div ref={containerRef} className={`relative inline-block ${className ?? ''}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) {
            // Opening — seed the message from the lazy source (e.g. the
            // candidate's current note draft) if one was provided.
            if (getMessage) setText(getMessage());
            setOpen(true);
          } else {
            setOpen(false);
          }
        }}
        title="Notify a teammate"
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-slate-900">Notify</h4>
              <p className="text-[11px] text-slate-400 truncate">{context}</p>
            </div>
            <button onClick={close} className="text-slate-400 hover:text-slate-700 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-4 py-3 space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="What do you need?"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />

            {/* Selected chips */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                    {m.fullName || m.name}
                    <button onClick={() => toggle(m.id)} className="hover:bg-blue-100 rounded-full p-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search + results */}
            <div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <div className="mt-1.5 max-h-44 overflow-y-auto divide-y divide-slate-50">
                {!membersLoaded ? (
                  <p className="text-xs text-slate-400 py-2 px-1">Loading…</p>
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2 px-1">
                    {members.length === 0 ? 'No members found.' : 'No matches.'}
                  </p>
                ) : (
                  filtered.map(m => {
                    const badge = ROLE_BADGE[m.role] ?? ROLE_BADGE.viewer;
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggle(m.id)}
                        className="w-full flex items-center gap-2 px-1 py-1.5 hover:bg-slate-50 rounded text-left"
                      >
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold flex items-center justify-center">
                          {initialOf(m)}
                        </span>
                        <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{m.fullName || m.name}</span>
                        <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
          </div>

          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button onClick={close} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!canSend && status !== 'sent'}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                status === 'sent'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {status === 'sending' ? 'Sending…' : status === 'sent' ? '✓ Sent' : 'Notify'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
