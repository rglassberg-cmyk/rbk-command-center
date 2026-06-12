'use client';

import { Fragment, useState } from 'react';
import dynamic from 'next/dynamic';
import { formatMoney } from '@/lib/format';
import type { DonorTag } from './DonorAnnotations';

// Client-only to avoid SSR/hydration issues that surfaced as an
// "Application error" on iOS Safari when the rich notes input rendered
// during hydration. Skeleton during the brief client load is a no-op so
// the surrounding table layout doesn't shift.
const DonorAnnotations = dynamic(() => import('./DonorAnnotations'), { ssr: false });

export interface Constituent {
  donorId: string;
  donorName: string;
  totalPledge: number;
  paid: number;
  outstanding: number;
  giftType: 'donation' | 'pledge' | 'mixed';
  lastGiftDate: string;
  lastGiftAmount?: number;
  thankYouLetterDate?: string | null;
  paymentFrequency?: string | null;
  primaryDevelopmentRole?: string | null;
  // True when any of this donor's gifts in the rolled-up scope carries
  // anonymous=true in Veracross. Drives the "🔒 Anon" pill so staff
  // don't list the name publicly without checking. Optional so older
  // /api/development/fundraising-goals cached responses don't break.
  anonymous?: boolean;
  // Person/household vs organization. Drives the Veracross profile URL
  // path — `development-constituent` for persons/households and
  // `organization-constituent` for orgs (those are separate detail
  // endpoints in Axiom). Optional so older cached responses fall back
  // to the person path.
  constituentType?: 'person' | 'organization';
  // Big Bold Future capital-campaign total. Renders in the BBF column
  // when > 0; em-dash when 0/undefined. Populated by the Guardian Circle
  // route only.
  bbfTotal?: number;
  // Coarse role tag for the donor sidebar / row pill. 'Other' (or
  // undefined) renders no pill — currently the common case until the
  // richer Veracross constituent sync is wired.
  role?: 'Parent' | 'Grandparent' | 'Parents of Alumni' | 'Alumni' | 'Faculty' | 'Other';
  // Child grade levels (Veracross grade IDs). Empty → no chips rendered.
  grades?: number[];
  // True when at least one child is in 8th grade — surfaces a red flag
  // icon next to the donor name.
  agingOut?: boolean;
}

interface Props {
  constituents: Constituent[];
  compact?: boolean;
  onThankYouClick?: (c: Constituent) => void;
  // Bulk-prefetched tags grouped by constituent_name (passed from parent so
  // every row doesn't issue its own request).
  tagsByDonor?: Map<string, DonorTag[]>;
  onTagsChange?: (constituentName: string, next: DonorTag[]) => void;
  // When true, rows expand to show DonorAnnotations on click.
  enableAnnotations?: boolean;
  // When provided, clicking the donor name fires this callback instead
  // of toggling the inline-expansion annotations panel. Used by
  // GuardianCirclePage to open the donor sidebar drawer. If both
  // `enableAnnotations` and `onDonorClick` are set, the click goes to
  // the sidebar — the inline annotations panel is suppressed since the
  // sidebar already hosts DonorAnnotations.
  onDonorClick?: (c: Constituent) => void;
  // When true (Guardian Circle), the desktop table renders the
  // BBF / Capital column between Outstanding and Frequency.
  showBbfColumn?: boolean;
}

// Tailwind classes for the role pill colors. 'Other' has no entry so
// the pill is skipped entirely. Coarse mapping mirrors what's in the
// Veracross data today; can be refined when richer roles land.
const ROLE_PILL_CLASSES: Record<string, string> = {
  Parent: 'bg-blue-50 text-blue-700',
  Grandparent: 'bg-purple-50 text-purple-700',
  'Parents of Alumni': 'bg-orange-50 text-orange-700',
  Alumni: 'bg-green-50 text-green-700',
  Faculty: 'bg-amber-50 text-amber-700',
};

// Compact "Gr N" chip for the child-grade list. K (20) and the nursery
// codes (40/35/30/25) render with their proper labels for ELC
// constituents; everything else is "Gr N".
const GRADE_LABEL: Record<number, string> = {
  40: 'I/T', 35: '2YN', 30: '3YN', 25: '4YN', 20: 'K',
};
function gradeChipLabel(g: number): string {
  return GRADE_LABEL[g] ?? `Gr ${g}`;
}

type Status = 'paid' | 'in_progress' | 'pending';

function statusFor(c: Constituent): Status {
  if (c.outstanding === 0) return 'paid';
  if (c.paid > 0) return 'in_progress';
  return 'pending';
}

const STATUS_ORDER: Record<Status, number> = { pending: 0, in_progress: 1, paid: 2 };

export function sortConstituents(constituents: Constituent[]): Constituent[] {
  return [...constituents].sort((a, b) => {
    const sA = statusFor(a);
    const sB = statusFor(b);
    if (sA !== sB) return STATUS_ORDER[sA] - STATUS_ORDER[sB];
    return b.outstanding - a.outstanding;
  });
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
        Paid in full
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        In progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
      Pledge pending
    </span>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ConstituentTable({
  constituents,
  compact = false,
  onThankYouClick,
  tagsByDonor,
  onTagsChange,
  enableAnnotations = false,
  onDonorClick,
  showBbfColumn = false,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (constituents.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-500">No donors yet.</div>;
  }

  const sorted = sortConstituents(constituents);
  const cellY = compact ? 'py-1.5' : 'py-2.5';
  // colSpan covers all rendered columns so the annotations expansion
  // row spans the whole table. 8 base columns + 1 extra when the BBF
  // column is rendered for Guardian Circle.
  const colSpan = 8 + (showBbfColumn ? 1 : 0);
  // When onDonorClick is wired, sidebar takes over — inline expansion
  // is suppressed even if enableAnnotations is on.
  const useSidebar = !!onDonorClick;

  return (
    <>
      {/* Mobile: card list. Tapping a card toggles the same expanded-row
          state the desktop table uses, so DonorAnnotations + Veracross link +
          envelope button (when enabled) render in-place below the card. */}
      <div className="md:hidden flex flex-col divide-y divide-slate-100">
        {sorted.map(c => {
          const donorTags = tagsByDonor?.get(c.donorName) || [];
          const isExpanded = expandedId === c.donorId;
          const totalCommitted = c.paid + c.outstanding;
          const toggle = () => {
            if (useSidebar) onDonorClick!(c);
            else if (enableAnnotations) setExpandedId(isExpanded ? null : c.donorId);
          };
          return (
            <div key={c.donorId}>
              <button
                type="button"
                onClick={toggle}
                disabled={!enableAnnotations && !useSidebar}
                className="w-full text-left py-3 px-4 flex items-center justify-between gap-3 hover:bg-slate-50 disabled:cursor-default"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium text-slate-800 text-sm truncate inline-flex items-center gap-1.5">
                    {c.donorName}
                    {c.anonymous === true && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                        🔒 Anon
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500 mt-0.5 truncate">
                    {c.primaryDevelopmentRole || 'Household'}
                    {c.paymentFrequency ? ` · ${c.paymentFrequency}` : ''}
                  </span>
                  {donorTags.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-1">
                      {donorTags.map(t => (
                        <span
                          key={t.id}
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                          style={{ backgroundColor: t.color }}
                        >
                          {t.tag}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end shrink-0 gap-0.5">
                  <span className="font-semibold text-slate-800 text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(totalCommitted)}
                  </span>
                  {c.outstanding > 0 && (
                    <span className="text-xs text-amber-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(c.outstanding)} owed
                    </span>
                  )}
                </div>
              </button>
              {enableAnnotations && !useSidebar && isExpanded && (
                <div className="bg-slate-50 border-t border-slate-200 px-4 py-3">
                  <div className="flex items-center gap-2 mb-3">
                    {onThankYouClick && (
                      <button
                        onClick={() => onThankYouClick(c)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Quick Thank You Email
                      </button>
                    )}
                    <a
                      href={`https://axiom.veracross.com/sar/#/detail/${c.constituentType === 'organization' ? 'organization-constituent' : 'development-constituent'}/${c.donorId}/5011-general`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-600 hover:text-blue-600 inline-flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Veracross
                    </a>
                  </div>
                  <DonorAnnotations
                    constituentName={c.donorName}
                    constituentId={c.donorId}
                    tags={donorTags}
                    onTagsChange={(next) => onTagsChange?.(c.donorName, next)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop table. The BBF / Capital column only renders for
          callers that pass showBbfColumn (Guardian Circle today). */}
      <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className={`px-3 ${cellY} font-medium`}>Donor</th>
            <th className={`px-3 ${cellY} font-medium text-right`}>Total pledge</th>
            <th className={`px-3 ${cellY} font-medium text-right`}>Paid</th>
            <th className={`px-3 ${cellY} font-medium text-right`}>Outstanding</th>
            {showBbfColumn && (
              <th className={`px-3 ${cellY} font-medium text-right`} title="Big Bold Future capital campaign total">BBF / Capital</th>
            )}
            <th className={`px-3 ${cellY} font-medium`}>Frequency</th>
            <th className={`px-3 ${cellY} font-medium`}>Thank you</th>
            <th className={`px-3 ${cellY} font-medium`}>Status</th>
            <th className={`px-3 ${cellY} font-medium w-16`}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const status = statusFor(c);
            const isExpanded = expandedId === c.donorId;
            const donorTags = tagsByDonor?.get(c.donorName) || [];
            // Sidebar mode wins when both are provided.
            const handleRowClick = useSidebar
              ? () => onDonorClick!(c)
              : (enableAnnotations ? () => setExpandedId(isExpanded ? null : c.donorId) : undefined);
            const rowClickable = useSidebar || enableAnnotations;
            const rolePillCls = c.role && c.role !== 'Other' ? ROLE_PILL_CLASSES[c.role] : null;

            return (
              <Fragment key={c.donorId}>
                <tr
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 group ${rowClickable ? 'cursor-pointer' : ''}`}
                  onClick={handleRowClick}
                >
                  <td className={`px-3 ${cellY} text-slate-800`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {rowClickable && !useSidebar && (
                        <svg
                          className={`w-3 h-3 text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                      {rolePillCls && (
                        <span className={`inline-flex items-center text-[10px] font-medium rounded px-1.5 py-0.5 ${rolePillCls}`}>
                          {c.role}
                        </span>
                      )}
                      <span className={useSidebar ? 'hover:text-blue-600 underline-offset-2 hover:underline' : ''}>{c.donorName}</span>
                      {c.agingOut === true && (
                        <span
                          className="inline-flex items-center text-red-500"
                          title="Youngest child graduating this year"
                          aria-label="Aging out — youngest child graduating this year"
                        >
                          🚩
                        </span>
                      )}
                      {c.grades && c.grades.length > 0 && (
                        <span className="inline-flex flex-wrap gap-1">
                          {c.grades.map((g, i) => (
                            <span key={`${g}-${i}`} className="text-xs text-slate-500 bg-slate-100 rounded px-1">
                              {gradeChipLabel(g)}
                            </span>
                          ))}
                        </span>
                      )}
                      {c.anonymous === true && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                          🔒 Anon
                        </span>
                      )}
                      {donorTags.length > 0 && (
                        <span className="inline-flex flex-wrap gap-1">
                          {donorTags.map(t => (
                            <span
                              key={t.id}
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium text-white"
                              style={{ backgroundColor: t.color }}
                              title={t.tag}
                            >
                              {t.tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`px-3 ${cellY} text-right text-slate-700`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {c.totalPledge > 0 ? formatMoney(c.totalPledge) : '—'}
                  </td>
                  <td className={`px-3 ${cellY} text-right text-slate-700`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(c.paid)}
                  </td>
                  <td className={`px-3 ${cellY} text-right text-slate-700`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {c.outstanding > 0 ? formatMoney(c.outstanding) : '—'}
                  </td>
                  {showBbfColumn && (
                    <td className={`px-3 ${cellY} text-right text-slate-700`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {(c.bbfTotal ?? 0) > 0 ? formatMoney(c.bbfTotal!) : <span className="text-slate-300">—</span>}
                    </td>
                  )}
                  <td className={`px-3 ${cellY}`}>
                    {c.paymentFrequency ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        {c.paymentFrequency}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className={`px-3 ${cellY}`}>
                    {c.thankYouLetterDate ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700" title={`Sent ${c.thankYouLetterDate}`}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {formatShortDate(c.thankYouLetterDate)}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className={`px-3 ${cellY}`}>
                    <StatusBadge status={status} />
                  </td>
                  <td className={`px-3 ${cellY}`} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2 justify-end">
                      {onThankYouClick && (
                        <button
                          onClick={() => onThankYouClick(c)}
                          className="text-slate-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Quick Thank You Email"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </button>
                      )}
                      <a
                        href={`https://axiom.veracross.com/sar/#/detail/${c.constituentType === 'organization' ? 'organization-constituent' : 'development-constituent'}/${c.donorId}/5011-general`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-blue-600 inline-flex"
                        title="Open in Veracross"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </td>
                </tr>
                {enableAnnotations && !useSidebar && isExpanded && (
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <td colSpan={colSpan} className="px-4 py-4">
                      <DonorAnnotations
                        constituentName={c.donorName}
                        constituentId={c.donorId}
                        tags={donorTags}
                        onTagsChange={(next) => onTagsChange?.(c.donorName, next)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
