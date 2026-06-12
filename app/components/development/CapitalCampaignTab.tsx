'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';

interface CapitalGift {
  constituent_id: number | null;
  constituent_name: string | null;
  date: string;
  amount: number;
  event: string | null;
  fundraising_activity: string | null;
}

interface Payload {
  fund: string;
  totalRaised: number;
  giftCount: number;
  donorCount: number;
  gifts: CapitalGift[];
}

export default function CapitalCampaignTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/development/capital-campaign');
      if (!res.ok) throw new Error('Failed to load');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-3 bg-slate-200 rounded w-24 mb-3" />
              <div className="h-6 bg-slate-100 rounded w-32" />
            </div>
          ))}
        </div>
        <div className="h-40 bg-slate-50 rounded-xl border border-slate-100 animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        <p>{error || 'No data'}</p>
        <button onClick={fetchData} className="mt-3 text-sm text-blue-600 hover:underline">Retry</button>
      </div>
    );
  }

  // Empty state when there's no meaningful data yet. Threshold is 2
  // distinct donors — the single-donor case (currently 4 gifts from one
  // family) doesn't represent a campaign-wide picture and showing it as
  // such was misleading. The fund name in Veracross also needs review
  // (we filter on fund = 'Capital Campaign' but the live data only
  // surfaces one donor under that name) — hence the Sara mention.
  if (data.donorCount < 2) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-slate-900 font-semibold mb-1">No Capital Campaign data yet</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Capital Campaign data will appear here once gifts are recorded in Veracross. Contact Sara to confirm the correct fund name.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Total raised</p>
          <p className="text-2xl font-semibold text-slate-900">{formatMoney(data.totalRaised)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Gifts</p>
          <p className="text-2xl font-semibold text-slate-900">{data.giftCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Donors</p>
          <p className="text-2xl font-semibold text-slate-900">{data.donorCount}</p>
        </div>
      </div>

      {/* Gifts table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900" style={{ fontSize: 14 }}>Individual gifts</h3>
          <span className="text-xs text-slate-400">{data.giftCount} total</span>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5 font-medium">Donor</th>
              <th className="px-5 py-2.5 font-medium">Date</th>
              <th className="px-5 py-2.5 font-medium">Event / Activity</th>
              <th className="px-5 py-2.5 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.gifts.map((g, i) => (
              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50/60">
                <td className="px-5 py-2.5 text-sm text-slate-800">{g.constituent_name || 'Anonymous'}</td>
                <td className="px-5 py-2.5 text-sm text-slate-500">{g.date}</td>
                <td className="px-5 py-2.5 text-sm text-slate-500">{g.event || g.fundraising_activity || '—'}</td>
                <td className="px-5 py-2.5 text-sm text-slate-800 text-right font-medium">{formatMoney(g.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
