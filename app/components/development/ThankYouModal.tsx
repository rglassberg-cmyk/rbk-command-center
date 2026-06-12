'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { Constituent } from './ConstituentTable';

interface Props {
  constituent: Constituent;
  campaignName: string;
  onClose: () => void;
}

export default function ThankYouModal({ constituent, campaignName, onClose }: Props) {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'ai' | 'template' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // When the server successfully creates a Gmail draft (auto-BCC'd to
  // sar.tracking@mail.veracross.com), it returns a URL to open it. We
  // prefer this over a mailto: link because RBK can review/edit in Gmail
  // before sending and the Veracross BCC is already in place.
  const [draftUrl, setDraftUrl] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Choose representative gift type: if donor has any pledge, treat as pledge
      const giftType = constituent.totalPledge > 0 ? 'pledge' : 'donation';
      // Amount: use the most recent gift amount if available, otherwise paid
      const amount = constituent.lastGiftAmount && constituent.lastGiftAmount > 0
        ? constituent.lastGiftAmount
        : constituent.totalPledge > 0
          ? constituent.totalPledge
          : constituent.paid;
      const res = await apiFetch('/api/development/draft-thank-you', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorName: constituent.donorName,
          amount,
          giftType,
          date: constituent.lastGiftDate,
          totalPledge: constituent.totalPledge || undefined,
          outstanding: constituent.outstanding || undefined,
          campaignName,
        }),
      });
      if (!res.ok) throw new Error('Draft failed');
      const json = await res.json();
      setDraft(json.draft || '');
      setSource(json.source || null);
      setNote(json.note || null);
      setDraftUrl(json.draftUrl || null);
    } catch {
      setError("Couldn't generate draft. Try again.");
    }
    setLoading(false);
  }, [constituent, campaignName]);

  useEffect(() => { generate(); }, [generate]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Prefer the server-created Gmail draft (BCC already attached); fall
  // back to a mailto: link if draft creation failed (no token, Gmail API
  // refused, etc.). The mailto: path doesn't include the Veracross BCC.
  const openDraft = () => {
    if (draftUrl) {
      window.open(draftUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const subject = encodeURIComponent(`Thank you from SAR Academy`);
    const body = encodeURIComponent(draft);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-slate-900 font-semibold text-lg">Quick Thank You Email</h2>
            <p className="text-slate-500 text-sm mt-0.5">{constituent.donorName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-3/4" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-full" />
              <div className="h-4 bg-slate-100 rounded w-2/3" />
              <div className="h-4 bg-slate-100 rounded w-1/3" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-red-700 text-sm">{error}</span>
              <button onClick={generate} className="text-red-600 text-sm font-medium hover:text-red-800">
                Retry
              </button>
            </div>
          ) : (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full min-h-[240px] border border-slate-200 rounded-lg px-3 py-2 text-sm leading-relaxed font-sans focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {source === 'template' && (
                <p className="text-xs text-amber-600 mt-2">
                  {note || 'Template fallback used.'}
                </p>
              )}
              {source === 'ai' && (
                <p className="text-xs text-slate-400 mt-2">Drafted by Claude. Edit before sending.</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Regenerate
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              disabled={loading || !draft}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={openDraft}
              disabled={loading || !draft}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              title={draftUrl ? 'Opens the Gmail draft (BCC: sar.tracking@mail.veracross.com)' : 'Opens your email client with a blank draft'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {draftUrl ? 'Open Draft in Gmail' : 'Send via Email'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
