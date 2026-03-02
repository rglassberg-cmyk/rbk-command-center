'use client';

import type { Email } from '@/types';
import type { ReactNode } from 'react';

interface EmailSectionProps {
  title: string;
  emails: Email[];
  borderColor: string;
  badgeColor: string;
  isExpanded: boolean;
  onToggle: () => void;
  expandedEmail: string | null;
  setExpandedEmail: (id: string | null) => void;
  onMarkSectionDone: (emailIds: string[]) => Promise<void>;
  bulkUpdating: boolean;
  renderExpandedContent: (email: Email) => ReactNode;
}

export function EmailSection({
  title,
  emails,
  borderColor,
  badgeColor,
  isExpanded,
  onToggle,
  expandedEmail,
  setExpandedEmail,
  onMarkSectionDone,
  bulkUpdating,
  renderExpandedContent,
}: EmailSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-slate-800 sticky top-0 z-10 border-b border-slate-100"
      >
        <span className="font-semibold text-sm">{title}</span>
        <div className="flex items-center gap-2">
          {emails.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkSectionDone(emails.map(em => em.id)); }}
              disabled={bulkUpdating}
              className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              All Done
            </button>
          )}
          <span className={`${badgeColor} px-3 py-1 rounded-full text-xs font-medium`}>{emails.length}</span>
          <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>&#9660;</span>
        </div>
      </button>
      {isExpanded && (
        <div className="p-4 space-y-3">
          {emails.length === 0 ? (
            <p className="text-slate-500 text-sm">No emails</p>
          ) : (
            emails.map((email) => (
              <div
                key={email.id}
                className={`bg-white border border-slate-200 border-l-4 ${borderColor} rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${expandedEmail === email.id ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                    <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                  </div>
                  {email.attachments && email.attachments.length > 0 && (
                    <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium">
                      {email.attachments.length}
                    </span>
                  )}
                </div>
                {expandedEmail === email.id && renderExpandedContent(email)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default EmailSection;
