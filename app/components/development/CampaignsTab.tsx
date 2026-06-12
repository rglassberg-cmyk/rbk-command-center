'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';
import { ShimmerCards } from '../ui/Shimmer';
import ConstituentTable, { type Constituent } from './ConstituentTable';
import ThankYouModal from './ThankYouModal';

interface FundSummary {
  fund: string;
  totalRaised: number;
  giftCount: number;
  constituents: Constituent[];
}

interface FundraisingGoalsPayload {
  grandTotal: number;
  goal: number;
  asOf: string;
  funds: FundSummary[];
}

interface Props {
  onNavigate?: (nav: string) => void;
  // Called when the user taps "View tab →" on the Guardian Circle row.
  // Switches the parent DevelopmentPage's active tab instead of navigating
  // to a top-level route (Guardian Circle is no longer its own nav id).
  onSwitchTab?: (key: 'weekly-gifts' | 'campaigns' | 'guardian-circle' | 'cooper-fund' | 'israel-fund') => void;
}

const GUARDIAN_CIRCLE_FUND = 'OP: Guardian Circle';

function fundDisplayName(fund: string): string {
  return fund.replace(/^OP:\s*/, '');
}

export default function CampaignsTab({ onNavigate, onSwitchTab }: Props) {
  const [data, setData] = useState<FundraisingGoalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFund, setExpandedFund] = useState<string | null>(null);
  // Holds the donor + the fund name they came from so the modal can pass
  // a campaign-specific prompt. The accordion is the only place that knows
  // which fund the donor row belongs to — `Constituent` doesn't carry it
  // — so we capture it at click time.
  const [thankYouTarget, setThankYouTarget] = useState<{ constituent: Constituent; campaignName: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/development/fundraising-goals');
      if (!res.ok) throw new Error('Failed');
      const json = (await res.json()) as FundraisingGoalsPayload;
      setData(json);
    } catch {
      setError("Couldn't load fundraising goals.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const goToGuardianCircle = () => {
    // Guardian Circle is now the 3rd tab inside DevelopmentPage. Prefer the
    // intra-page tab switch; fall back to a full nav for callers that may
    // have rendered this tab outside DevelopmentPage. The legacy onNavigate
    // path now points at Development with a ?tab= deep-link param.
    if (onSwitchTab) {
      onSwitchTab('guardian-circle');
    } else if (onNavigate) {
      onNavigate('development');
    } else {
      window.location.href = '/?nav=development&tab=guardian-circle';
    }
  };

  if (loading) {
    return <ShimmerCards count={6} />;
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
        <span className="text-red-700 text-sm">{error || 'No data'}</span>
        <button onClick={fetchData} className="text-red-600 text-sm font-medium hover:text-red-800">Retry</button>
      </div>
    );
  }

  const pct = Math.min((data.grandTotal / data.goal) * 100, 100);
  const pctLabel = ((data.grandTotal / data.goal) * 100).toFixed(1);

  return (
    <div>
      {/* Subtitle under DevelopmentPage's own header */}
      <p className="text-slate-500 text-sm mb-4">Annual Fundraising Goals · FY26</p>

      {/* Goal progress bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-slate-700 text-sm">
            <span className="text-slate-900 font-semibold" style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(data.grandTotal)}
            </span>
            <span className="text-slate-500"> raised toward </span>
            <span className="text-slate-900 font-semibold">{formatMoney(data.goal)}</span>
            <span className="text-slate-500"> goal</span>
          </p>
          <span className="text-sm font-medium text-blue-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {pctLabel}%
          </span>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Fund cards */}
      <div className="space-y-2">
        {data.funds.map(fund => {
          const isGuardianCircle = fund.fund === GUARDIAN_CIRCLE_FUND;
          const isExpanded = expandedFund === fund.fund;
          const displayName = fundDisplayName(fund.fund);

          return (
            <div key={fund.fund} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div
                role={isGuardianCircle ? undefined : 'button'}
                tabIndex={isGuardianCircle ? undefined : 0}
                onClick={isGuardianCircle ? undefined : () => setExpandedFund(isExpanded ? null : fund.fund)}
                onKeyDown={isGuardianCircle ? undefined : (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedFund(isExpanded ? null : fund.fund);
                  }
                }}
                className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors ${
                  isGuardianCircle ? '' : 'cursor-pointer hover:bg-slate-50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{displayName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {fund.giftCount} donor{fund.giftCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-slate-900" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(fund.totalRaised)}
                  </span>
                  {isGuardianCircle ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); goToGuardianCircle(); }}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                    >
                      View tab →
                    </button>
                  ) : (
                    <svg
                      className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              </div>

              {!isGuardianCircle && isExpanded && (
                <div className="border-t border-slate-100 px-2 py-2 bg-slate-50">
                  <ConstituentTable
                    constituents={fund.constituents}
                    compact
                    onThankYouClick={(c) => setThankYouTarget({ constituent: c, campaignName: displayName })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {thankYouTarget && (
        <ThankYouModal
          constituent={thankYouTarget.constituent}
          campaignName={thankYouTarget.campaignName}
          onClose={() => setThankYouTarget(null)}
        />
      )}
    </div>
  );
}
