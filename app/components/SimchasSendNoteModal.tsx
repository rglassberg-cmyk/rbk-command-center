'use client';

import { useState } from 'react';

export interface SimchasSendNotePayload {
  emailId: string;
  familyName: string;
  summary: string;
  receivedAt: string;
}

interface Props {
  payload: SimchasSendNotePayload;
  onClose: () => void;
  onSent: () => void;
}

function formatReceivedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SimchasSendNoteModal({ payload, onClose, onSent }: Props) {
  const [rbkNote, setRbkNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/simchas/send-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: payload.emailId,
          familyName: payload.familyName,
          summary: payload.summary,
          rbkNote: rbkNote.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      onSent();
    } catch {
      setError("Couldn't send. Try again.");
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-slate-900 font-semibold text-lg">
            Send Condolence Note — {payload.familyName}
          </h2>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Read-only summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">From the Hamakom notice</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
              {payload.summary || <span className="italic text-slate-400">No summary available — Emily will need to read the original email.</span>}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">Received {formatReceivedDate(payload.receivedAt)}</p>
          </div>

          {/* RBK's optional note */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Add a note for Emily <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={rbkNote}
              onChange={(e) => setRbkNote(e.target.value)}
              placeholder="e.g. Draft for David specifically, he was RBK's student"
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="text-sm text-slate-600 hover:text-slate-800 px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:bg-slate-300 inline-flex items-center gap-2"
          >
            {sending ? 'Sending…' : 'Send to Emily'}
          </button>
        </div>
      </div>
    </div>
  );
}
