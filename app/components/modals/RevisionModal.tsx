'use client';

import type { Email } from '@/types';

interface RevisionModalProps {
  email: Email | undefined;
  revisionComment: string;
  setRevisionComment: (comment: string) => void;
  updating: string | null;
  onRequestRevision: (emailId: string, comment: string) => Promise<void>;
  onClose: () => void;
}

export function RevisionModal({ email, revisionComment, setRevisionComment, updating, onRequestRevision, onClose }: RevisionModalProps) {
  if (!email) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Request Revision</h3>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
            <p className="text-xs text-slate-500">To: {email.from_email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Comment for Emily</label>
            <textarea
              value={revisionComment}
              onChange={(e) => setRevisionComment(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              placeholder="What changes are needed?"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button
              onClick={() => onRequestRevision(email.id, revisionComment)}
              disabled={updating === email.id}
              className="bg-amber-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              Send to Emily
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RevisionModal;
