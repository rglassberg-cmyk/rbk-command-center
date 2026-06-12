'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';
import { ShimmerStatCards, ShimmerTableRows } from '../ui/Shimmer';
import dynamic from 'next/dynamic';
import type { DonorTag } from './DonorAnnotations';
import type { Constituent } from './ConstituentTable';
import ThankYouModal from './ThankYouModal';

// Client-only — see comment in ConstituentTable.tsx.
const DonorAnnotations = dynamic(() => import('./DonorAnnotations'), { ssr: false });

interface GiftNote {
  text: string;
  author: string;
  updated_at: string;
}

interface DisplayGift {
  id: number;
  constituent_id: number;
  displayName: string;
  displayEvent: string;
  fund: string | null;
  event: string | null;
  fundraising_activity: string | null;
  amount: number;
  date: string;
  gift_type: number;
  isPledgePayment: boolean;
  isSoftCredit: boolean;
  isRefund: boolean;
  softCreditType: number | null;
  anonymous: boolean;
  constituentType: 'person' | 'organization';
  note: GiftNote | null;
}

interface Summary {
  totalGifts: number;
  totalAmount: number;
  newGiftsAmount: number;
  pledgePaymentsAmount: number;
  countRefunds: number;
}

interface WeeklyGiftsResponse {
  gifts: DisplayGift[];
  summary: Summary;
  dateRange: { weekStart: string; weekEnd: string; days: number };
  fetchedAt: string;
}

type SortField = 'displayName' | 'amount' | 'date' | 'displayEvent';
type SortDir = 'asc' | 'desc';
type CardFilter = 'all' | 'new' | 'pledge';

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sameMonth = s.getMonth() === e.getMonth();
  if (sameMonth) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.getDate()}, ${e.getFullYear()}`;
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`;
}

// Column widths shared between header and data rows
const COL = {
  donor: 'min-w-0 flex-[3]',
  amount: 'w-[100px] flex-shrink-0',
  date: 'w-[80px] flex-shrink-0',
  event: 'min-w-0 flex-[3.5]',
  type: 'w-[140px] flex-shrink-0 print:hidden',
  note: 'w-[48px] flex-shrink-0 print:hidden',
};

export default function WeeklyGiftsTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<WeeklyGiftsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedNoteGiftId, setExpandedNoteGiftId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [donorPanel, setDonorPanel] = useState<{ id: number; name: string; type: 'person' | 'organization' } | null>(null);
  const [donorData, setDonorData] = useState<{ totalGiving: number; giftsByYear: Array<{ year: string; total: number; gifts: Array<{ id: number; date: string; amount: number; event: string | null; fund: string | null; gift_type: number; isPledgePayment: boolean; isSoftCredit: boolean }> }> } | null>(null);
  const [donorLoading, setDonorLoading] = useState(false);
  // Tags for the donor currently shown in the side panel. Refetched when
  // donorPanel changes; donor-notes are fetched inside DonorAnnotations.
  const [donorPanelTags, setDonorPanelTags] = useState<DonorTag[]>([]);
  // Tags for the donor whose per-gift inline annotations popover is open
  // (the small note icon on a gift row). Refetched when that gift changes.
  const [inlineTags, setInlineTags] = useState<DonorTag[]>([]);
  const [cardFilter, setCardFilter] = useState<CardFilter>('all');
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [searchTerm, setSearchTerm] = useState('');
  // Synthesizes a Constituent from the open side panel + most-recent gift
  // in donorData and opens ThankYouModal. campaignName is the gift's
  // event/fund label (or a generic fallback) so the prompt has context.
  const [thankYouTarget, setThankYouTarget] = useState<{ constituent: Constituent; campaignName: string } | null>(null);

  // Fetch donor history when panel opens
  useEffect(() => {
    if (!donorPanel) { setDonorData(null); return; }
    setDonorLoading(true);
    apiFetch(`/api/development/donor-history?constituentId=${donorPanel.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.donor) setDonorData(d.donor); })
      .catch(() => {})
      .finally(() => setDonorLoading(false));
  }, [donorPanel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch donor tags when panel opens
  useEffect(() => {
    if (!donorPanel) { setDonorPanelTags([]); return; }
    let cancelled = false;
    apiFetch(`/api/development/donor-tags?constituent_name=${encodeURIComponent(donorPanel.name)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.tags) setDonorPanelTags(d.tags); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [donorPanel?.id, donorPanel?.name]);

  // Fetch donor tags when the inline per-gift annotations popover opens.
  useEffect(() => {
    if (expandedNoteGiftId == null || !data) { setInlineTags([]); return; }
    const gift = data.gifts.find(g => g.id === expandedNoteGiftId);
    if (!gift) { setInlineTags([]); return; }
    let cancelled = false;
    apiFetch(`/api/development/donor-tags?constituent_name=${encodeURIComponent(gift.displayName)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.tags) setInlineTags(d.tags); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [expandedNoteGiftId, data]);

  // Tick every 30s for relative time display
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/development/weekly-gifts?days=${days}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(json);
      if (json.fetchedAt) setLastFetchedAt(json.fetchedAt);
    } catch {
      setError("Couldn't load gifts. Try refreshing.");
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const startMs = Date.now();

    try {
      // 1. Trigger Veracross sync → gifts_cache
      console.log('[REFRESH] Sync start');
      const syncRes = await apiFetch('/api/development/sync-gifts', {
        method: 'POST',
        signal: controller.signal,
      });
      console.log('[REFRESH] Sync response:', syncRes.status, Date.now() - startMs, 'ms');
      if (!syncRes.ok) throw new Error('Sync failed');
      const syncResult = await syncRes.json();

      // 2. Refetch from cache
      console.log('[REFRESH] Refetch start');
      const res = await apiFetch(`/api/development/weekly-gifts?days=${days}`);
      if (!res.ok) throw new Error('Refetch failed');
      const json = await res.json();
      setData(json);
      if (json.fetchedAt) setLastFetchedAt(json.fetchedAt);
      console.log('[REFRESH] Refetch done', Date.now() - startMs, 'ms');
      setToast(`Synced ${syncResult.count?.toLocaleString() || ''} gifts`);
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error?.name === 'AbortError') {
        setToast('Sync took too long. Try again or wait for the next scheduled sync.');
      } else {
        setToast("Couldn't sync. Try again.");
      }
      console.log('[REFRESH] Error:', error, Date.now() - startMs, 'ms');
    } finally {
      clearTimeout(timeout);
      setRefreshing(false);
    }
  };

  const relativeTime = (iso: string): string => {
    const diff = nowTick - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    const d = Math.floor(hours / 24);
    return `${d}d ago`;
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'amount' ? 'desc' : 'asc');
    }
  };

  // Sort all gifts
  const sortedAll = data ? [...data.gifts].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'amount') cmp = a.amount - b.amount;
    else if (sortField === 'date') cmp = a.date.localeCompare(b.date);
    else if (sortField === 'displayName') cmp = a.displayName.localeCompare(b.displayName);
    else if (sortField === 'displayEvent') cmp = a.displayEvent.localeCompare(b.displayEvent);
    return sortDir === 'desc' ? -cmp : cmp;
  }) : [];

  // Apply card filter
  const cardFiltered = cardFilter === 'all' ? sortedAll
    : cardFilter === 'new' ? sortedAll.filter(g => !g.isPledgePayment)
    : sortedAll.filter(g => g.isPledgePayment);

  // Apply search filter
  const searchLower = searchTerm.toLowerCase().trim();
  const sortedGifts = searchLower
    ? cardFiltered.filter(g =>
        g.displayName.toLowerCase().includes(searchLower) ||
        (g.fund || '').toLowerCase().includes(searchLower) ||
        (g.event || '').toLowerCase().includes(searchLower) ||
        g.displayEvent.toLowerCase().includes(searchLower) ||
        String(g.amount).includes(searchLower) ||
        (g.note?.text || '').toLowerCase().includes(searchLower)
      )
    : cardFiltered;

  // Top 3 by amount (only highlight when sorted by amount desc and showing all)
  const isDefaultSort = sortField === 'amount' && sortDir === 'desc' && cardFilter === 'all';
  const top3Ids = isDefaultSort ? sortedGifts.slice(0, 3).map(g => g.id) : [];

  // Toggle the inline annotations popover for a gift's donor.
  const openNote = (gift: DisplayGift) => {
    setExpandedNoteGiftId(prev => prev === gift.id ? null : gift.id);
  };

  // The per-gift save/delete helpers (writing to gift_notes table) were
  // removed when the popover switched to DonorAnnotations. Existing
  // gift_notes rows remain in the DB but are no longer editable from the
  // UI; the icon's amber dot still reflects their presence as a passive
  // legacy indicator. The gift-notes API route is left intact for any
  // future re-introduction.

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div>
        <ShimmerStatCards count={3} />
        <ShimmerTableRows rows={8} cols={5} />
      </div>
    );
  }

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between print:hidden">
          <span className="text-red-700 text-sm">{error}</span>
          <button onClick={fetchData} className="text-red-600 text-sm font-medium hover:text-red-800">Retry</button>
        </div>
      )}

      {data && (
        <>
          {/* Header row */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-slate-900 font-semibold" style={{ fontSize: 20 }}>Weekly Gifts</h2>
              <p className="text-slate-500 mt-0.5" style={{ fontSize: 13 }}>
                {formatDateRange(data.dateRange.weekStart, data.dateRange.weekEnd)}
              </p>
            </div>
            <div className="flex items-center gap-3 print:hidden">
              {lastFetchedAt && (
                <span className="text-xs text-slate-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  Last synced {relativeTime(lastFetchedAt)}
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="bg-white border border-slate-200 shadow-sm rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              <button
                onClick={() => window.print()}
                className="bg-white border border-slate-200 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print
              </button>
            </div>
          </div>

          {/* Date preset pills */}
          <div className="flex gap-2 mb-5 print:hidden">
            {([
              { d: 0, label: 'Today' },
              { d: 7, label: '7 days' },
              { d: 14, label: '14 days' },
              { d: 30, label: '30 days' },
            ] as const).map(({ d, label }) => (
              <button
                key={d}
                onClick={() => { setDays(d); setCardFilter('all'); }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === d
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative mb-5 print:hidden">
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search donors, funds, events..."
              className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
              >
                ×
              </button>
            )}
          </div>

          {/* Summary cards — clickable filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
            <div
              onClick={() => setCardFilter(cardFilter === 'all' ? 'all' : 'all')}
              className={`bg-white border border-slate-200 rounded-lg p-4 cursor-pointer hover:bg-slate-50 transition-all print:cursor-default print:hover:bg-white ${cardFilter === 'all' ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}
            >
              <p className="text-slate-500 text-[11px] font-semibold tracking-wide uppercase mb-1">Total Gifts</p>
              <p className="text-slate-900 font-semibold" style={{ fontSize: 18 }}>{formatMoney(data.summary.totalAmount)}</p>
              <p className="text-slate-500 text-xs mt-1">{data.summary.totalGifts} gift{data.summary.totalGifts !== 1 ? 's' : ''}</p>
            </div>
            <div
              onClick={() => setCardFilter(cardFilter === 'new' ? 'all' : 'new')}
              className={`bg-white border border-slate-200 rounded-lg p-4 border-t-2 border-t-green-400 cursor-pointer hover:bg-slate-50 transition-all print:cursor-default print:hover:bg-white ${cardFilter === 'new' ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}
            >
              <p className="text-slate-500 text-[11px] font-semibold tracking-wide uppercase mb-1">New Gifts</p>
              <p className="text-slate-900 font-semibold" style={{ fontSize: 18 }}>{formatMoney(data.summary.newGiftsAmount)}</p>
              <p className="text-slate-500 text-xs mt-1">{data.gifts.filter(g => !g.isPledgePayment).length} gift{data.gifts.filter(g => !g.isPledgePayment).length !== 1 ? 's' : ''}</p>
            </div>
            <div
              onClick={() => setCardFilter(cardFilter === 'pledge' ? 'all' : 'pledge')}
              className={`bg-white border border-slate-200 rounded-lg p-4 border-t-2 border-t-blue-400 cursor-pointer hover:bg-slate-50 transition-all print:cursor-default print:hover:bg-white ${cardFilter === 'pledge' ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}
            >
              <p className="text-slate-500 text-[11px] font-semibold tracking-wide uppercase mb-1">Pledge Payments</p>
              <p className="text-slate-900 font-semibold" style={{ fontSize: 18 }}>{formatMoney(data.summary.pledgePaymentsAmount)}</p>
              <p className="text-slate-500 text-xs mt-1">{data.gifts.filter(g => g.isPledgePayment).length} payment{data.gifts.filter(g => g.isPledgePayment).length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {/* Refund banner */}
          {data.summary.countRefunds > 0 && (
            <div className="mb-5 bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 rounded-md print:hidden">
              Note: {data.summary.countRefunds} refund{data.summary.countRefunds !== 1 ? 's' : ''} this week reducing total by {formatMoney(Math.abs(data.gifts.filter(g => g.isRefund).reduce((s, g) => s + g.amount, 0)))}
            </div>
          )}

          {/* Pending online gifts link */}
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 print:hidden">
            <a
              href="https://axiom.veracross.com/sar/#/results/1470528"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-amber-800 inline-flex items-center gap-1.5"
            >
              Some recently submitted donations may still be pending processing. View pending online gifts in Veracross →
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
            </a>
          </div>

          {/* Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden print:border-0 print:shadow-none">
            {sortedGifts.length === 0 ? (
              <div className="py-12 text-center text-slate-500">
                {searchTerm
                  ? 'No matching gifts found.'
                  : days === 0
                    ? 'No gifts recorded today.'
                    : 'No gifts in this range.'}
              </div>
            ) : (
              <>
                {/* Mobile: card list. The desktop flex-table below squishes
                    badly below 768px; cards put the two key fields per gift
                    (donor + event/fund, then amount + date) on their own
                    lines so nothing gets clipped. Tapping opens the same
                    donor side panel that the desktop donor-name link does. */}
                <div className="md:hidden flex flex-col divide-y divide-slate-100">
                  {sortedGifts.map(gift => (
                    <button
                      key={gift.id}
                      type="button"
                      onClick={() => setDonorPanel({ id: gift.constituent_id, name: gift.displayName, type: gift.constituentType })}
                      className={`text-left py-3 px-4 flex items-center justify-between gap-3 hover:bg-slate-50 ${gift.isRefund ? 'bg-red-50/50' : ''}`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium text-slate-800 text-sm truncate">{gift.displayName}</span>
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                          <span className="text-xs text-slate-500 truncate">{gift.displayEvent}</span>
                          {gift.isPledgePayment && <span className="bg-blue-100 text-blue-700 text-[9px] font-medium rounded px-1 py-0.5 flex-shrink-0">PLEDGE</span>}
                          {gift.isRefund && <span className="bg-red-100 text-red-700 text-[9px] font-medium rounded px-1 py-0.5 flex-shrink-0">REFUND</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className={`font-semibold text-sm ${gift.isRefund ? 'text-red-700' : 'text-slate-800'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(gift.amount)}
                        </span>
                        <span className="text-xs text-slate-400" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatDateShort(gift.date)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Desktop: existing flex-table, unchanged. */}
                <div className="hidden md:block">
                {/* Header row */}
                <div className="flex items-center bg-slate-50 border-b border-slate-200 px-4 py-3 print:bg-white print:border-b-2 print:border-slate-400">
                  <div className={`${COL.donor} pr-3`}>
                    <button onClick={() => handleSort('displayName')} className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide cursor-pointer hover:text-slate-900 select-none">
                      Donor<SortArrow field="displayName" />
                    </button>
                  </div>
                  <div className={`${COL.amount} pr-3 text-right`}>
                    <button onClick={() => handleSort('amount')} className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide cursor-pointer hover:text-slate-900 select-none">
                      Amount<SortArrow field="amount" />
                    </button>
                  </div>
                  <div className={`${COL.date} pr-3`}>
                    <button onClick={() => handleSort('date')} className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide cursor-pointer hover:text-slate-900 select-none">
                      Date<SortArrow field="date" />
                    </button>
                  </div>
                  <div className={`${COL.event} pr-3`}>
                    <button onClick={() => handleSort('displayEvent')} className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide cursor-pointer hover:text-slate-900 select-none">
                      Event / Fund<SortArrow field="displayEvent" />
                    </button>
                  </div>
                  <div className={COL.type}>
                    <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Type</span>
                  </div>
                  <div className={COL.note} />
                </div>

                {/* Data rows */}
                {sortedGifts.map(gift => {
                  const isTop3 = top3Ids.includes(gift.id);
                  const rowBg = gift.isRefund ? 'bg-red-50/50 print:bg-white' : isTop3 ? 'bg-amber-50/50 print:bg-white' : '';
                  return (
                    <div key={gift.id} className="group">
                      <div className={`flex items-center ${rowBg} hover:bg-slate-50 border-b border-slate-100 px-4 py-3 print:hover:bg-white print:border-slate-200`}>
                        {/* Donor */}
                        <div className={`${COL.donor} pr-3 truncate`}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDonorPanel({ id: gift.constituent_id, name: gift.displayName, type: gift.constituentType }); }}
                            className="text-blue-600 hover:underline inline-flex items-center gap-1 print:text-black print:no-underline text-left"
                          >
                            <span className="truncate">{gift.displayName}</span>
                          </button>
                        </div>
                        {/* Amount */}
                        <div className={`${COL.amount} pr-3 text-right font-medium ${gift.isRefund ? 'text-red-700' : 'text-slate-900'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(gift.amount)}
                        </div>
                        {/* Date */}
                        <div className={`${COL.date} pr-3 text-slate-700`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatDateShort(gift.date)}
                        </div>
                        {/* Event / Fund */}
                        <div className={`${COL.event} pr-3 text-slate-700 truncate`}>{gift.displayEvent}</div>
                        {/* Type badges */}
                        <div className={`${COL.type} flex items-center gap-1 flex-wrap`}>
                          {gift.isPledgePayment && <span className="bg-blue-100 text-blue-700 text-[10px] font-medium rounded px-1.5 py-0.5">PLEDGE</span>}
                          {gift.isSoftCredit && <span className="bg-slate-100 text-slate-600 text-[10px] font-medium rounded px-1.5 py-0.5">SC</span>}
                          {gift.anonymous && <span className="bg-slate-100 text-slate-500 text-[10px] font-medium rounded px-1.5 py-0.5">ANON</span>}
                          {gift.isRefund && <span className="bg-red-100 text-red-700 text-[10px] font-medium rounded px-1.5 py-0.5">REFUND</span>}
                        </div>
                        {/* Note icon */}
                        <div className={`${COL.note} flex justify-center`}>
                          <button
                            onClick={() => openNote(gift)}
                            className={`p-1 rounded transition-colors ${gift.note ? 'text-amber-600' : 'text-slate-300 hover:text-slate-500'}`}
                            title={gift.note ? 'View note' : 'Add note'}
                          >
                            <svg className="w-4 h-4" fill={gift.note ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                          </button>
                        </div>
                      </div>
                      {/* Annotations popover — donor-level notes + tags with
                          @mention autocomplete, Slack DMs, and auto-task on @RBK.
                          Identical to what's shown on Guardian Circle. */}
                      {expandedNoteGiftId === gift.id && (
                        <div className="bg-slate-50 border-t border-slate-200 p-4 print:hidden">
                          <DonorAnnotations
                            constituentName={gift.displayName}
                            constituentId={String(gift.constituent_id)}
                            tags={inlineTags}
                            onTagsChange={setInlineTags}
                          />
                          <div className="flex justify-end mt-2">
                            <button onClick={() => setExpandedNoteGiftId(null)} className="text-slate-500 text-xs hover:text-slate-700">
                              Close
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white rounded-lg px-4 py-3 shadow-lg z-50 text-sm print:hidden">
          {toast}
        </div>
      )}

      {/* Donor side panel */}
      {donorPanel && (
        <>
          <div className="fixed inset-0 bg-slate-900/20 z-40 print:hidden" onClick={() => setDonorPanel(null)} />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col print:hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900">{donorPanel.name}</h3>
                  <a
                    href={`https://axiom.veracross.com/sar/#/detail/${donorPanel.type === 'organization' ? 'organization-constituent' : 'development-constituent'}/${donorPanel.id}/5011-general`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-blue-500 transition-colors"
                    title="Open in Veracross"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                  </a>
                </div>
                <button onClick={() => setDonorPanel(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {donorData && (
                <p className="text-sm text-slate-500 mt-1">Giving this year: <span className="font-semibold text-slate-800">{formatMoney(donorData.totalGiving)}</span></p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Draft thank you — synthesizes a Constituent from the most
                  recent gift in donorData so ThankYouModal has a real
                  amount + date + campaign label to send. Disabled until
                  donorData loads since those fields are required for a
                  sensible prompt. */}
              <div className="mb-5">
                <button
                  type="button"
                  disabled={!donorData || donorData.giftsByYear.length === 0 || donorData.giftsByYear[0].gifts.length === 0}
                  onClick={() => {
                    if (!donorData || donorData.giftsByYear.length === 0 || donorData.giftsByYear[0].gifts.length === 0) return;
                    const latest = donorData.giftsByYear[0].gifts[0];
                    const isPledge = latest.isPledgePayment;
                    const constituent: Constituent = {
                      donorId: String(donorPanel.id),
                      donorName: donorPanel.name,
                      totalPledge: 0,
                      paid: donorData.totalGiving,
                      outstanding: 0,
                      giftType: isPledge ? 'pledge' : 'donation',
                      lastGiftDate: latest.date,
                      lastGiftAmount: latest.amount,
                    };
                    setThankYouTarget({
                      constituent,
                      campaignName: latest.event || latest.fund || 'SAR Academy',
                    });
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={donorData ? 'Quick Thank You Email for the most recent gift' : 'Loading donor history…'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Quick Thank You Email
                </button>
              </div>

              {/* Donor notes + tags */}
              <div className="mb-5 pb-5 border-b border-slate-100">
                <DonorAnnotations
                  constituentName={donorPanel.name}
                  constituentId={String(donorPanel.id)}
                  tags={donorPanelTags}
                  onTagsChange={setDonorPanelTags}
                />
              </div>
              {donorLoading ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map(i => <div key={i} className="h-4 bg-slate-100 rounded w-full" />)}
                </div>
              ) : donorData ? (
                <div className="space-y-5">
                  {donorData.giftsByYear.map(fy => (
                    <div key={fy.year}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">FY {fy.year}</span>
                        <span className="text-xs font-semibold text-slate-700">{formatMoney(fy.total)} · {fy.gifts.length} gift{fy.gifts.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-1.5">
                        {fy.gifts.map(g => (
                          <div key={g.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs text-slate-400 w-14 flex-shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {new Date(g.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                              <span className="text-slate-600 truncate text-xs">{g.event || g.fund || 'Unspecified'}</span>
                              {g.isPledgePayment && <span className="bg-blue-100 text-blue-700 text-[9px] font-medium rounded px-1 py-0.5 flex-shrink-0">PLEDGE</span>}
                            </div>
                            <span className="font-medium text-slate-900 flex-shrink-0 ml-2" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(g.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {/* Veracross link */}
                  <div className="border-t border-slate-100 pt-3 mt-3">
                    <a
                      href={`https://axiom.veracross.com/sar/#/detail/development-constituent/${donorPanel.id}/4028-gift-detail`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium inline-flex items-center gap-1"
                    >
                      View full giving history in Veracross →
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-8">No giving history found.</p>
              )}
            </div>
          </div>
        </>
      )}

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
