'use client';

import { useState, useEffect } from 'react';
import { useWorkspace } from './AuthProvider';

interface ImpersonationTarget {
  email: string;
  display_name: string;
  role: string;
  workspace_id: string;
  workspace_name: string;
}

export default function ImpersonationBanner() {
  const { impersonating: ctxImp, stopImpersonation } = useWorkspace();

  // Also read directly from localStorage as fallback for first render
  const [localImp, setLocalImp] = useState<ImpersonationTarget | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('impersonation');
      if (raw) setLocalImp(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const imp = ctxImp || localImp;
  if (!imp) return null;

  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center justify-between text-sm">
      <span>
        👁 Viewing as <strong>{imp.display_name}</strong> ({imp.email}) — {imp.role} in {imp.workspace_name}
      </span>
      <button
        onClick={() => {
          localStorage.removeItem('impersonation');
          stopImpersonation();
        }}
        className="text-amber-800 hover:text-amber-900 underline text-sm font-medium"
      >
        Exit impersonation
      </button>
    </div>
  );
}
