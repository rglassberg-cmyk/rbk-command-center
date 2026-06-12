'use client';

import { useState, useEffect, useRef } from 'react';

// Daily Announcements Google Doc.
//   DOC_URL   — the direct /edit link; used by the mobile "Open" button
//               and by the desktop fallback's "Open in Google Docs →"
//               link when the iframe errors out.
//   EMBED_URL — derived /pub?embedded=true variant for the desktop
//               iframe (requires the doc to be Published to web via
//               File → Share → Publish to web). Mobile Safari blocks
//               the iframe entirely because ITP rejects the Google
//               third-party cookies the embedded viewer relies on —
//               hence the mobile branch below.
const DOC_URL = 'https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit';
const EMBED_URL = DOC_URL.includes('/pub')
  ? DOC_URL
  : DOC_URL.replace(/\/edit.*$/, '/pub?embedded=true');
const TODAYS_FOLDER_URL = 'https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link';
const LOAD_TIMEOUT = 10000; // 10 seconds — matches ThisWeekCard

export default function DailyAnnouncementsCard() {
  const [expanded, setExpanded] = useState(true);
  // Mobile branch — measure once on mount. Mobile Safari blocks the
  // Google Docs iframe via ITP (third-party cookie restrictions), so
  // we swap the iframe for a direct-link button below 768px. We don't
  // listen to resize events: most mobile users don't change viewport
  // mid-session, and the SSR-first render uses `false` so desktop
  // never sees an initial mismatch flash.
  const [isMobile, setIsMobile] = useState(false);
  // iframe load tracking — desktop-only defense-in-depth. Mirrors the
  // ThisWeekCard pattern: `iframeKey` changes on Retry to force a fresh
  // remount; the load-timeout effect is keyed off it so each retry gets
  // a fresh 10s window.
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeError, setIframeError] = useState(false);
  const loadedRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
  }, []);

  useEffect(() => {
    // Reset state on key change (initial mount + retry). Skip on mobile
    // — the iframe isn't rendered there so timing it would set a stale
    // error flag for no reason.
    if (isMobile) return;
    loadedRef.current = false;
    setIframeError(false);
    timeoutRef.current = setTimeout(() => {
      if (!loadedRef.current) setIframeError(true);
    }, LOAD_TIMEOUT);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [iframeKey, isMobile]);

  const handleLoad = () => {
    loadedRef.current = true;
    setIframeError(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleRetry = () => {
    setIframeKey(k => k + 1);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 mb-8 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2.5 group"
        >
          <div className="w-1 h-5 rounded-full" style={{ backgroundColor: '#7AB648' }} />
          <svg className="w-5 h-5" style={{ color: '#1B3A6B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: '#1B3A6B' }}>Daily Announcements</h3>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <a
          href={TODAYS_FOLDER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          Today&apos;s Folder
        </a>
      </div>

      {/* Collapsible content */}
      <div
        className="transition-all duration-300 ease-in-out overflow-hidden"
        style={{ maxHeight: expanded ? '500px' : '0px', opacity: expanded ? 1 : 0 }}
      >
        <div className="px-6 pb-5">
          {isMobile ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm text-slate-500 text-center">
                Daily Announcements can&apos;t be embedded on mobile.
              </p>
              <a
                href={DOC_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:bg-blue-800"
              >
                Open Daily Announcements →
              </a>
            </div>
          ) : iframeError ? (
            <div className="flex items-center justify-center bg-white border border-slate-100 rounded-lg h-[400px]">
              <div className="text-center px-6">
                <svg className="w-10 h-10 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-slate-500 text-sm mb-3">Daily Announcements couldn&apos;t load.</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={handleRetry}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors"
                  >
                    Retry
                  </button>
                  <a
                    href={DOC_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    Open in Google Docs →
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <iframe
              key={iframeKey}
              src={EMBED_URL}
              className="w-full border-0 rounded-lg h-[400px]"
              loading="lazy"
              title="Daily Announcements"
              onLoad={handleLoad}
              onError={() => setIframeError(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
