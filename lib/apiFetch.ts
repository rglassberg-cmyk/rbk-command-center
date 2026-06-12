/**
 * Wrapper around fetch() that adds impersonation header when active.
 * Reads impersonation state from localStorage.
 */
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('impersonation');
      if (raw) {
        const imp = JSON.parse(raw);
        if (imp?.workspace_id) {
          headers.set('X-Impersonated-Workspace-Id', imp.workspace_id);
        }
        if (imp?.email) {
          headers.set('X-Impersonated-Email', imp.email);
        }
      }
    } catch { /* ignore */ }
  }

  return fetch(url, { ...options, headers });
}
