'use client';

import { useState, useEffect, useRef } from 'react';

const IFRAME_URL = 'https://thisweek-sar.netlify.app/';
const LOAD_TIMEOUT = 10000; // 10 seconds

export default function ThisWeekCard() {
  const [iframeKey, setIframeKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Reset state on key change (retry)
    setLoaded(false);
    setFailed(false);
    timeoutRef.current = setTimeout(() => {
      if (!loaded) setFailed(true);
    }, LOAD_TIMEOUT);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeKey]);

  const handleLoad = () => {
    setLoaded(true);
    setFailed(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleRetry = () => {
    setIframeKey(k => k + 1);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col w-full max-w-2xl h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 pt-5 pb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: '#E87722' }} />
          <svg className="w-5 h-5 flex-shrink-0" style={{ color: '#1B3A6B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <h3 className="font-bold uppercase tracking-wide truncate" style={{ fontSize: 13, color: '#1B3A6B' }}>This Week at SAR</h3>
        </div>
        <a
          href={IFRAME_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
          title="Open in new tab"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6v6m-11 5L21 3" />
          </svg>
        </a>
      </div>

      {/* Content area */}
      <div className="flex-1 relative h-[400px] md:h-[500px] lg:h-[600px]">
        {/* Loading skeleton */}
        {!loaded && !failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="flex flex-col items-center gap-2">
              <svg className="w-6 h-6 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-xs text-slate-400">Loading calendar...</span>
            </div>
          </div>
        )}

        {/* Failed state */}
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="text-center px-6">
              <svg className="w-10 h-10 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-slate-500 text-sm mb-3">Calendar couldn&apos;t load</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors"
                >
                  Retry
                </button>
                <a
                  href={IFRAME_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Open This Week at SAR
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Iframe */}
        <iframe
          key={iframeKey}
          src={IFRAME_URL}
          className={`w-full h-full border-0 ${loaded ? '' : 'invisible'}`}
          sandbox="allow-scripts allow-same-origin allow-popups"
          loading="lazy"
          title="This Week at SAR"
          onLoad={handleLoad}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
