'use client';

import { useState, useCallback } from 'react';
import html2canvas from 'html2canvas';

interface BugReportButtonProps {
  activeNav: string;
  workspaceId: string | null;
  userEmail: string | null;
}

export default function BugReportButton({ activeNav, workspaceId, userEmail }: BugReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(false);

  const handleOpen = useCallback(async () => {
    setCapturing(true);
    try {
      const canvas = await html2canvas(document.body, { useCORS: true, width: Math.min(document.body.scrollWidth, 1200) });
      setScreenshot(canvas.toDataURL('image/png'));
    } catch {
      setScreenshot(null);
    }
    setCapturing(false);
    setOpen(true);
    setFeedback('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!feedback.trim()) return;
    setSubmitting(true);
    try {
      await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          reported_by: userEmail,
          page: activeNav,
          feedback: feedback.trim(),
          screenshot_data: screenshot,
        }),
      });
    } catch {
      // fire and forget
    }
    setSubmitting(false);
    setOpen(false);
    setScreenshot(null);
    setToast(true);
    setTimeout(() => setToast(false), 3000);
  }, [feedback, screenshot, activeNav, workspaceId, userEmail]);

  return (
    <>
      {/* Floating bug button */}
      <button
        onClick={handleOpen}
        disabled={capturing}
        className="fixed bottom-6 right-6 z-50 bg-slate-700 hover:bg-slate-800 text-white rounded-full p-3 shadow-lg transition-colors disabled:opacity-50"
        title="Report a bug"
      >
        {capturing ? (
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135c-.117-1.064-.542-2.053-1.267-2.778a4.063 4.063 0 00-2.788-1.182V2.25m-6 0v1.845a4.063 4.063 0 00-2.788 1.182c-.725.725-1.15 1.714-1.267 2.778a23.907 23.907 0 01-1.152 6.135A24.176 24.176 0 0112 12.75zM9.75 6h4.5" />
          </svg>
        )}
      </button>

      {/* Modal */}
      {open && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 z-50" onClick={() => { setOpen(false); setScreenshot(null); }} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-xl shadow-2xl p-6 w-[480px] max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Report a Bug</h3>
            <p className="text-xs text-slate-400 mb-4">Page: {activeNav}</p>
            {screenshot && (
              <img src={screenshot} alt="Screenshot" className="w-full max-h-32 object-cover rounded border border-slate-200 mb-4" />
            )}
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Describe the issue..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 min-h-[100px] mb-4 resize-y"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setOpen(false); setScreenshot(null); }}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!feedback.trim() || submitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 right-6 z-50 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg">
          Report submitted!
        </div>
      )}
    </>
  );
}
