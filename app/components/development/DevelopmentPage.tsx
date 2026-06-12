'use client';

import { useState, useEffect, useMemo } from 'react';
import { useWorkspace } from '../AuthProvider';
import { canSeeTestingFeature } from '@/lib/testingFeatures';
import OverviewTab from './OverviewTab';
import WeeklyGiftsTab from './WeeklyGiftsTab';
import CampaignsTab from './CampaignsTab';
import CapitalCampaignTab from './CapitalCampaignTab';
import GuardianCirclePage from './GuardianCirclePage';
import CooperFundTab from './CooperFundTab';
import IsraelFundTab from './IsraelFundTab';

// Full tab list. The Overview entry is gated by the
// `development_overview` testing flag (see lib/testingFeatures.ts) —
// users without the flag don't see it at all and Weekly Gifts becomes
// the default landing tab.
const ALL_TABS = [
  { key: 'overview' as const, label: 'Overview', testingKey: 'development_overview' },
  { key: 'weekly-gifts' as const, label: 'Weekly Gifts' },
  { key: 'campaigns' as const, label: 'Campaign Giving by Fund' },
  { key: 'guardian-circle' as const, label: 'Guardian Circle' },
  { key: 'cooper-fund' as const, label: 'Cooper Fund' },
  { key: 'israel-fund' as const, label: 'Israel Fund' },
  { key: 'capital-campaign' as const, label: 'Capital Campaign' },
] as const;

export type DevelopmentTabKey = (typeof ALL_TABS)[number]['key'];

interface Props {
  onNavigate?: (nav: string) => void;
}

// Initial tab can come from the URL query string (?tab=guardian-circle)
// so deep links from outside the dashboard — e.g. Slack DMs sent by the
// donor-notes route on an @mention — can land directly on a tab.
function readInitialTab(canSeeOverview: boolean, validKeys: readonly string[]): DevelopmentTabKey {
  const fallback: DevelopmentTabKey = canSeeOverview ? 'overview' : 'weekly-gifts';
  if (typeof window === 'undefined') return fallback;
  const params = new URLSearchParams(window.location.search);
  const t = params.get('tab');
  return (validKeys.includes(t || '') ? (t as DevelopmentTabKey) : fallback);
}

export default function DevelopmentPage({ onNavigate }: Props) {
  const { testingFeatures, promotedFeatures } = useWorkspace();
  const canSeeOverview = canSeeTestingFeature(
    'development_overview',
    testingFeatures,
    promotedFeatures,
  );

  // Filter the testing-gated tabs out of the rendered list. Each
  // tab's `testingKey` (when present) is unioned across per-user and
  // workspace-wide promoted flags via canSeeTestingFeature.
  const TABS = useMemo(
    () => ALL_TABS.filter(t =>
      !('testingKey' in t) || canSeeTestingFeature(t.testingKey, testingFeatures, promotedFeatures),
    ),
    [testingFeatures, promotedFeatures],
  );
  const validKeys = useMemo(() => TABS.map(x => x.key), [TABS]);

  const [activeTab, setActiveTab] = useState<DevelopmentTabKey>(
    () => readInitialTab(canSeeOverview, validKeys),
  );

  // If the user lost overview access mid-session (or never had it),
  // fall back to weekly-gifts when the current tab is no longer valid.
  useEffect(() => {
    if (!validKeys.includes(activeTab)) {
      setActiveTab(canSeeOverview ? 'overview' : 'weekly-gifts');
    }
  }, [validKeys, activeTab, canSeeOverview]);

  // If the page mounts before the URL settles (Dashboard's own ?nav= handling
  // calls history.replaceState after read), re-check the tab param once.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    if (t && TABS.some(x => x.key === t)) {
      setActiveTab(t as DevelopmentTabKey);
      // Clean the param so refreshing doesn't keep forcing the tab.
      params.delete('tab');
      const qs = params.toString();
      const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, '', url);
    }
    // Intentionally empty deps — first-mount only. Tab filtering for
    // ungated users is handled by the canSeeOverview useEffect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-slate-900 font-semibold" style={{ fontSize: 28 }}>Development</h1>
        <p className="text-slate-500 mt-1" style={{ fontSize: 14 }}>Weekly gifts tracking and donor intelligence</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit flex-wrap">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-white border border-slate-200 font-medium text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'weekly-gifts' && <WeeklyGiftsTab />}
      {activeTab === 'campaigns' && (
        <CampaignsTab
          onNavigate={onNavigate}
          onSwitchTab={(key) => setActiveTab(key as DevelopmentTabKey)}
        />
      )}
      {activeTab === 'capital-campaign' && <CapitalCampaignTab />}
      {activeTab === 'guardian-circle' && <GuardianCirclePage />}
      {activeTab === 'cooper-fund' && <CooperFundTab />}
      {activeTab === 'israel-fund' && <IsraelFundTab />}
    </div>
  );
}
