'use client';

import type { Email } from '@/types';

interface DraftEditorModalProps {
  email: Email | undefined;
  draftText: string;
  setDraftText: (text: string) => void;
  updating: string | null;
  onSaveDraft: (emailId: string, draft: string, markReady?: boolean) => Promise<void>;
  onClose: () => void;
}

export function DraftEditorModal({ email, draftText, setDraftText, updating, onSaveDraft, onClose }: DraftEditorModalProps) {
  if (!email) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Edit Draft Response</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="font-medium text-slate-900">{email.subject}</p>
            <p className="text-sm text-slate-500">To: {email.from_email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Draft Response</label>
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={10}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="Type your response here..."
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button
              onClick={async () => { await onSaveDraft(email.id, draftText, false); onClose(); }}
              disabled={updating === email.id}
              className="border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              onClick={async () => { await onSaveDraft(email.id, draftText, true); onClose(); }}
              disabled={updating === email.id}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Mark Ready for Review
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DraftEditorModal;
