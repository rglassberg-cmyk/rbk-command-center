// Parse + validate a ?division=academy|hs|both query param against the
// caller's actual divisions. Used by Veracross routes to honor an
// explicit division selection from the multi-division UI toggle (Becca,
// Debra May) without letting Academy-only users escalate to HS.
//
// Returns the effective divisions array to use for filtering. If the
// param is missing, invalid, or asks for something the caller doesn't
// actually have, falls back to the caller's full divisions array
// (which getEffectiveDivisions already resolved with impersonation
// in mind).

export type DivisionParam = 'academy' | 'hs' | 'both';

export function applyDivisionParam(
  raw: string | null,
  callerDivisions: string[],
): string[] {
  if (!raw) return callerDivisions;
  const v = raw.toLowerCase();

  // 'both' = use everything the caller has access to
  if (v === 'both') return callerDivisions;

  // Single-division requests: honor only if the caller actually has it.
  if (v === 'academy' && callerDivisions.includes('academy')) return ['academy'];
  if (v === 'hs' && callerDivisions.includes('hs')) return ['hs'];

  // Unknown value or escalation attempt: fall back safely.
  return callerDivisions;
}
