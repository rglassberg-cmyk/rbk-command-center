'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

// Contextual "send via Slack" modal. Driven by a single parent state
// (the caller flips `contextText` on/off via `null`). Pre-filled context
// is read-only — the user adds a personal note, picks a recipient
// from workspace members with Slack IDs, and the route assembles
// "{context}\n\n{message}" before posting to Slack.

interface MentionableUser {
  id: string;
  name: string;
  fullName?: string | null;
  email: string;
  slackId: string | null;
}

interface SlackSendModalProps {
  contextText: string;
  onClose: () => void;
}

export default function SlackSendModal({ contextText, onClose }: SlackSendModalProps) {
  const [users, setUsers] = useState<MentionableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [recipientId, setRecipientId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The spec asked for /api/workspace/members; the project's
        // existing endpoint is mentionable-users, which already returns
        // the shape we need (id, name, fullName, email, slackId) and is
        // auth-gated to the active workspace.
        const res = await apiFetch('/api/workspace/mentionable-users');
        if (!res.ok) throw new Error('Failed to load members');
        const json = (await res.json()) as { users: MentionableUser[] };
        if (cancelled) return;
        const withSlack = (json.users || [])
          .filter(u => !!u.slackId)
          .sort((a, b) => (a.fullName || a.name).localeCompare(b.fullName || b.name));
        setUsers(withSlack);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load members');
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Esc-to-close. Stops bubbling so a modal-over-modal scenario
  // wouldn't dismiss both at once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSend = async () => {
    const recipient = users.find(u => u.id === recipientId);
    if (!recipient?.slackId) {
      setError('Pick a recipient with Slack');
      return;
    }
    if (!message.trim()) {
      setError('Message cannot be empty');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await apiFetch('/api/slack/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toSlackUserId: recipient.slackId,
          message: message.trim(),
          context: contextText,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j as { ok?: boolean }).ok !== true) {
        setError((j as { error?: string }).error || 'Send failed');
        return;
      }
      setToast(`Sent to ${recipient.fullName || recipient.name}`);
      setMessage('');
      // Close shortly after the toast appears so the user sees confirmation.
      setTimeout(() => onClose(), 1200);
    } catch {
      setError('Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Send via Slack</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Context</label>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {contextText || <span className="text-slate-400 italic">No context</span>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">To</label>
            {usersLoading ? (
              <p className="text-sm text-slate-400">Loading members…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-slate-400">No workspace members have a Slack ID configured.</p>
            ) : (
              <select
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                <option value="">Select a recipient…</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.fullName || u.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Add a note…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
          {toast && (
            <p className="text-xs text-emerald-600">{toast}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !recipientId || !message.trim()}
            className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
