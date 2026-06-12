// Division segmentation helpers. The `divisions` column on
// workspace_members is a text[] of school divisions a member has access
// to. An empty array means "no division explicitly set" — the helpers
// below treat that as Academy-only (the safe default while most users
// are Academy-side).
//
// 'academy' = SAR Academy (ELC + Lower School + Middle School) -- all in one building
// 'hs' = SAR High School -- separate building, same institution
//
// Phase D made the filter user-aware and bidirectional. Per-route
// usage: read divisions from `session.currentMember?.divisions ?? []`
// (set by /api/auth/session POST), then call `getGradeFilterForMember`
// for grade-list filtering or `memberCanSeeDivision` for binary
// division checks.

export const DIVISION_ACADEMY = 'academy';
export const DIVISION_HS = 'hs';

// Veracross grade_level IDs for HS — verified against
// attendance_cache (the cached IDs are exactly [9,10,11,12]).
export const HS_GRADE_NUMBERS = [9, 10, 11, 12];
// Veracross grade_level IDs for SAR Academy — ELC codes
// 40/35/30/25/20 (Pre-K tiers) plus grades 1-8.
export const ACADEMY_GRADE_NUMBERS = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8];

// Veracross grading_period codes used by HS attendance records. The
// pre-Phase-D constant said `29`, but live attendance_cache data shows
// HS records actually carry `grading_period=24` (with 29 historically
// reserved for the prior school year per Veracross's year-rotation
// pattern). The array form covers both so the sync filter stays
// correct across school-year rollovers.
export const HS_GRADING_PERIODS = [24, 29];
// Back-compat single-value export for any caller still referencing the
// old scalar name. Prefer HS_GRADING_PERIODS where possible.
export const HS_GRADING_PERIOD = 24;

// True if the member's divisions array contains `division`. Empty
// divisions defaults to "Academy only" (so an unconfigured account
// safely sees Academy data and not HS).
export function memberCanSeeDivision(
  memberDivisions: string[] | null | undefined,
  division: string,
): boolean {
  if (!memberDivisions || memberDivisions.length === 0) return division === DIVISION_ACADEMY;
  return memberDivisions.includes(division);
}

// Legacy name — true if Academy access without HS. Used by the Lever
// route's string-based "SAR High School" department filter. Kept for
// back-compat; new code should prefer memberCanSeeDivision.
export function memberHasDivision(memberDivisions: string[] | null | undefined, division: string): boolean {
  return memberCanSeeDivision(memberDivisions, division);
}

// Returns the list of grade_level IDs a member is allowed to see.
// Always returns a non-empty array (defaults to Academy when divisions
// is empty or only contains unknown values).
export function getGradeFilterForMember(memberDivisions: string[] | null | undefined): number[] {
  if (!memberDivisions || memberDivisions.length === 0) return ACADEMY_GRADE_NUMBERS;
  const grades: number[] = [];
  if (memberDivisions.includes(DIVISION_ACADEMY)) grades.push(...ACADEMY_GRADE_NUMBERS);
  if (memberDivisions.includes(DIVISION_HS)) grades.push(...HS_GRADE_NUMBERS);
  if (grades.length === 0) return ACADEMY_GRADE_NUMBERS;
  return grades;
}

// Should HS data be filtered out for this member? Legacy helper kept
// for string-based filters (Lever department) where there's no grade
// number to consult. Returns true when the user has Academy access
// without HS — i.e. they should not see HS-tagged content.
export function shouldExcludeHs(memberDivisions: string[] | null | undefined): boolean {
  return memberCanSeeDivision(memberDivisions, DIVISION_ACADEMY) && !memberCanSeeDivision(memberDivisions, DIVISION_HS);
}
