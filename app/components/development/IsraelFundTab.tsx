'use client';

import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAuth, useWorkspace } from '@/app/components/AuthProvider';
import { apiFetch } from '@/lib/apiFetch';
import { formatMoney } from '@/lib/format';
import { hasSubPermission } from '@/lib/modules';
import { ShimmerStatCards, ShimmerTableRows } from '../ui/Shimmer';

// Emily owns the underlying grants tracker — see backend
// app/api/development/israel-fund/grants/[id]/route.ts. Everyone in the
// Development module can read; the `canEditGrants` check below decides
// who can add / edit / hide via the UI.
const EMILY_EMAIL = 'egray@saracademy.org';
const BECCA_EMAIL = 'rglassberg@saracademy.org';

interface Initiative {
  name: string;
  // `raised` is the EFFECTIVE raised (Veracross + manualRaised).
  raised: number;
  manualRaised: number;
  manualRaisedNote: string | null;
  disbursed: number;
  balance: number;
}

interface MoneyInEvent {
  event: string;
  total: number;
  pledgeBalance: number;
  giftCount: number;
}

interface Grant {
  id: string;
  workspace_id: string;
  grant_number: string | null;
  // confirmed_payment, wire_status, date_wire_sent, grant_not_given are
  // intentionally kept on the type because the route still returns them
  // and `deriveInitiatives` uses grant_not_given + the sort logic uses
  // date_wire_sent. They're just no longer surfaced in the UI per the
  // 2026-06-08 grant-form simplification.
  confirmed_payment: string | null;
  date_received: string | null;
  initiative: string | null;
  category: string | null;
  organization_person: string | null;
  link: string | null;
  what_funding: string | null;
  wire_status: string | null;
  submitted_by: string | null;
  contact_info: string | null;
  funding_amount: number;
  grant_not_given: boolean;
  notes: string | null;
  submitted_to_procurify: string | null;
  procurify_number: string | null;
  date_wire_sent: string | null;
  wire_was_sent: boolean;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

interface IsraelData {
  total_raised: number;
  total_disbursed: number;
  total_balance: number;
  initiatives: Initiative[];
  grants: Grant[];
  veracrossEvents: string[];
  moneyIn: MoneyInEvent[];
  as_of: string;
}

interface GrantFormState {
  initiative: string;
  grant_number: string;
  organization_person: string;
  date_received: string;
  category: string;
  link: string;
  what_funding: string;
  submitted_by: string;
  contact_info: string;
  funding_amount: string;
  notes: string;
  submitted_to_procurify: string;
  procurify_number: string;
  wire_was_sent: boolean;
}

function emptyForm(initiative: string, grantNumber: string): GrantFormState {
  return {
    initiative,
    grant_number: grantNumber,
    organization_person: '',
    date_received: '',
    category: '',
    link: '',
    what_funding: '',
    submitted_by: '',
    contact_info: '',
    funding_amount: '',
    notes: '',
    submitted_to_procurify: '',
    procurify_number: '',
    wire_was_sent: false,
  };
}

function grantToForm(g: Grant): GrantFormState {
  return {
    initiative: g.initiative ?? '',
    grant_number: g.grant_number ?? '',
    organization_person: g.organization_person ?? '',
    date_received: g.date_received ?? '',
    category: g.category ?? '',
    link: g.link ?? '',
    what_funding: g.what_funding ?? '',
    submitted_by: g.submitted_by ?? '',
    contact_info: g.contact_info ?? '',
    funding_amount: Number.isFinite(g.funding_amount) ? String(g.funding_amount) : '',
    notes: g.notes ?? '',
    submitted_to_procurify: g.submitted_to_procurify ?? '',
    procurify_number: g.procurify_number ?? '',
    wire_was_sent: g.wire_was_sent,
  };
}

function formToPayload(form: GrantFormState) {
  const amount = parseFloat(form.funding_amount);
  return {
    initiative: form.initiative.trim(),
    grant_number: form.grant_number.trim() || null,
    organization_person: form.organization_person.trim() || null,
    date_received: form.date_received || null,
    category: form.category.trim() || null,
    link: form.link.trim() || null,
    what_funding: form.what_funding.trim() || null,
    submitted_by: form.submitted_by.trim() || null,
    contact_info: form.contact_info.trim() || null,
    funding_amount: Number.isFinite(amount) ? amount : 0,
    notes: form.notes.trim() || null,
    submitted_to_procurify: form.submitted_to_procurify.trim() || null,
    procurify_number: form.procurify_number.trim() || null,
    wire_was_sent: form.wire_was_sent,
  };
}

// Suggest the next "Grant N" from the existing grant_number set. Ignores
// any non-matching formats (some legacy rows have free-text labels).
function suggestNextGrantNumber(grants: Grant[]): string {
  let max = 0;
  for (const g of grants) {
    const m = g.grant_number?.match(/^Grant (\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `Grant ${max + 1}`;
}

// Re-derive initiative summary rows from the current grants[] plus a
// frozen `raised` baseline (which never changes client-side — it comes
// from Veracross via the route). Keeps the table in sync after edits
// without a full refetch.
function deriveInitiatives(
  grants: Grant[],
  raisedByKey: Map<string, { name: string; raised: number; manualRaised: number; manualRaisedNote: string | null }>,
): Initiative[] {
  const disbursedByKey = new Map<string, number>();
  for (const g of grants) {
    if (!g.is_visible) continue;
    if (!g.wire_was_sent) continue;
    if (g.grant_not_given) continue;
    const key = (g.initiative ?? '').trim().toLowerCase();
    if (!key) continue;
    disbursedByKey.set(key, (disbursedByKey.get(key) ?? 0) + Number(g.funding_amount || 0));
  }

  const grantNameByKey = new Map<string, string>();
  for (const g of grants) {
    const trimmed = (g.initiative ?? '').trim();
    if (!trimmed) continue;
    const k = trimmed.toLowerCase();
    if (!grantNameByKey.has(k)) grantNameByKey.set(k, trimmed);
  }

  const allKeys = new Set<string>([...raisedByKey.keys(), ...disbursedByKey.keys()]);
  const out: Initiative[] = [];
  for (const key of allKeys) {
    const baseline = raisedByKey.get(key);
    const raised = baseline?.raised ?? 0;
    const disbursed = disbursedByKey.get(key) ?? 0;
    // Drop initiatives with no visible activity at all (matches the
    // spec: zero visible paid grants + zero raised = doesn't appear).
    // `raised` is already effective (Veracross + manual), so an
    // initiative with only a manual top-up still surfaces.
    if (raised === 0 && disbursed === 0) continue;
    const name = baseline?.name ?? grantNameByKey.get(key) ?? key;
    out.push({
      name,
      raised,
      manualRaised: baseline?.manualRaised ?? 0,
      manualRaisedNote: baseline?.manualRaisedNote ?? null,
      disbursed,
      balance: raised - disbursed,
    });
  }
  out.sort((a, b) => b.raised - a.raised || b.disbursed - a.disbursed);
  return out;
}

function axisMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function IsraelFundTab() {
  const { user } = useAuth();
  const { allowedModules } = useWorkspace();
  const impersonation = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('impersonation') || 'null');
    } catch { return null; }
  }, []);
  const effectiveEmail = impersonation?.email ?? user?.email;
  // Editor check — `israel_fund_editor` sub-permission is the primary
  // gate (Becca toggles it per user in /admin/permissions → Users →
  // Development chevron → Israel Fund Editor). The hardcoded email
  // fallback covers Emily + Becca, whose `allowed_modules` is `null`
  // (= full-module-access shortcut for owners/assistants) and
  // therefore returns false from `hasSubPermission()`.
  // Impersonation-aware via `effectiveEmail`.
  const canEditGrants =
    hasSubPermission(allowedModules, 'development', 'israel_fund_editor') ||
    effectiveEmail === EMILY_EMAIL ||
    effectiveEmail === BECCA_EMAIL;

  const [data, setData] = useState<IsraelData | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initiativeSearch, setInitiativeSearch] = useState('');
  const [moneyInOpen, setMoneyInOpen] = useState(false);
  const [moneyInSearch, setMoneyInSearch] = useState('');
  const [expandedInitiative, setExpandedInitiative] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // raised_cache rows (editor-only fetch). Powers the eye toggle that
  // hides an initiative from the page, and the "Show hidden" view.
  // The main `/api/development/israel-fund` route filters excluded
  // rows out; this fetch returns ALL rows so editors can restore them.
  const [cacheRows, setCacheRows] = useState<Array<{ id: string; event_name: string; raised: number; manual_raised: number; manual_raised_note: string | null; gift_count: number; is_excluded: boolean }>>([]);
  const [showHidden, setShowHidden] = useState(false);

  // Inline "Edit raised" state — editor-only manual top-up per
  // initiative. `editingRaisedKey` is the lowercased/trimmed initiative
  // name currently open for editing; `editingRaisedCacheId` is its
  // raised_cache row id (the PATCH target). `manualOverride` holds saved
  // manual values keyed by the same name so the row recomputes in place
  // without refetching the main route. See `raisedByKey` below.
  const [editingRaisedKey, setEditingRaisedKey] = useState<string | null>(null);
  const [editingRaisedCacheId, setEditingRaisedCacheId] = useState<string | null>(null);
  const [manualAmountInput, setManualAmountInput] = useState('');
  const [manualNoteInput, setManualNoteInput] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [manualOverride, setManualOverride] = useState<Map<string, { manual: number; note: string | null }>>(new Map());

  // Donor drill-down state. Lazy-fetched per initiative on first
  // expand and cached for the session so re-expanding the same row
  // doesn't refetch. `hasMore` flags the "Showing most recent 100"
  // notice when more than 100 matched.
  interface Donor { name: string; amount: number; date: string | null; anonymous: boolean }
  const [donorsByInit, setDonorsByInit] = useState<Map<string, { donors: Donor[]; hasMore: boolean }>>(new Map());
  const [donorsLoading, setDonorsLoading] = useState<Set<string>>(new Set());
  // Optimistic overlay for is_excluded so the eye click feels instant
  // — keyed by raised_cache.id, value is the desired is_excluded state.
  // Cleared on PATCH failure; persists on success until the next
  // refetch overwrites it.
  const [optimisticExcluded, setOptimisticExcluded] = useState<Map<string, boolean>>(new Map());

  // Panel state. `editing` distinguishes between create vs update for
  // routing the save to POST vs PATCH.
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Grant | null>(null);
  const [form, setForm] = useState<GrantFormState>(() => emptyForm('', ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/development/israel-fund');
        if (!res.ok) throw new Error('Failed to load');
        const json = (await res.json()) as IsraelData;
        setData(json);
        setGrants(json.grants ?? []);
      } catch {
        setError('Failed to load Israel Fund data');
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const refetchCacheRows = useCallback(async () => {
    if (!canEditGrants) return;
    try {
      const res = await apiFetch('/api/development/israel-fund/raised-cache');
      if (!res.ok) return;
      const json = (await res.json()) as { rows: Array<{ id: string; event_name: string; raised: number; manual_raised: number; manual_raised_note: string | null; gift_count: number; is_excluded: boolean }> };
      setCacheRows(json.rows ?? []);
    } catch { /* non-fatal */ }
  }, [canEditGrants]);

  useEffect(() => {
    void refetchCacheRows();
  }, [refetchCacheRows]);

  // Lazy-load donors for the currently expanded initiative.
  useEffect(() => {
    if (!expandedInitiative) return;
    if (donorsByInit.has(expandedInitiative)) return;
    if (donorsLoading.has(expandedInitiative)) return;
    const initName = expandedInitiative;
    setDonorsLoading(prev => {
      const next = new Set(prev);
      next.add(initName);
      return next;
    });
    (async () => {
      try {
        const res = await apiFetch(`/api/development/israel-fund/donors?initiative=${encodeURIComponent(initName)}`);
        if (!res.ok) throw new Error('Donors fetch failed');
        const json = (await res.json()) as { donors: Donor[]; hasMore: boolean };
        setDonorsByInit(prev => {
          const next = new Map(prev);
          next.set(initName, { donors: json.donors ?? [], hasMore: Boolean(json.hasMore) });
          return next;
        });
      } catch (err) {
        console.warn('[IsraelFundTab] donors fetch failed:', err);
        setDonorsByInit(prev => {
          const next = new Map(prev);
          next.set(initName, { donors: [], hasMore: false });
          return next;
        });
      } finally {
        setDonorsLoading(prev => {
          const next = new Set(prev);
          next.delete(initName);
          return next;
        });
      }
    })();
  }, [expandedInitiative, donorsByInit, donorsLoading]);

  // Toggle is_excluded on a raised_cache row. Optimistic update flips
  // the row's effective is_excluded immediately; the PATCH is fired in
  // the background. On failure we drop the optimistic entry + toast.
  const handleToggleExcluded = useCallback(async (cacheId: string, next: boolean) => {
    setOptimisticExcluded(prev => {
      const m = new Map(prev);
      m.set(cacheId, next);
      return m;
    });
    try {
      const res = await apiFetch(`/api/development/israel-fund/raised-cache/${cacheId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_excluded: next }),
      });
      if (!res.ok) throw new Error('toggle failed');
      setToast(next ? 'Hidden.' : 'Restored.');
      // Refetch the cache list to align truth with optimistic state.
      // We deliberately don't drop the optimistic entry here — the
      // refetch overwrites cacheRows and the overlay becomes a no-op.
      void refetchCacheRows();
    } catch {
      setOptimisticExcluded(prev => {
        const m = new Map(prev);
        m.delete(cacheId);
        return m;
      });
      setToast('Toggle failed — reverted.');
    }
  }, [refetchCacheRows]);

  // Open the inline "Edit raised" panel for an initiative. `cacheId` is
  // required — only initiatives backed by a raised_cache row can carry a
  // manual top-up (grants-only initiatives have nothing to PATCH).
  const openManualEdit = useCallback((initKey: string, cacheId: string, currentManual: number, currentNote: string | null) => {
    setEditingRaisedKey(initKey);
    setEditingRaisedCacheId(cacheId);
    setManualAmountInput(currentManual ? String(currentManual) : '');
    setManualNoteInput(currentNote ?? '');
  }, []);

  const closeManualEdit = useCallback(() => {
    setEditingRaisedKey(null);
    setEditingRaisedCacheId(null);
    setManualAmountInput('');
    setManualNoteInput('');
  }, []);

  const handleSaveManual = useCallback(async () => {
    if (savingManual) return;
    if (!editingRaisedKey || !editingRaisedCacheId) return;
    const amount = parseFloat(manualAmountInput || '0');
    if (!Number.isFinite(amount) || amount < 0) {
      setToast('Manual raised must be a non-negative number');
      return;
    }
    const note = manualNoteInput.trim() || null;
    setSavingManual(true);
    try {
      const res = await apiFetch(`/api/development/israel-fund/raised-cache/${editingRaisedCacheId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_raised: amount, manual_raised_note: note }),
      });
      if (!res.ok) throw new Error('PATCH failed');
      // Record the override so raisedByKey / hiddenInitiatives recompute
      // the effective raised + balance in place. Refetch the cache list
      // in the background so truth eventually aligns with the override.
      setManualOverride(prev => {
        const m = new Map(prev);
        m.set(editingRaisedKey, { manual: amount, note });
        return m;
      });
      void refetchCacheRows();
      setToast('Manual raised saved');
      closeManualEdit();
    } catch {
      setToast('Save failed — try again');
    } finally {
      setSavingManual(false);
    }
  }, [savingManual, editingRaisedKey, editingRaisedCacheId, manualAmountInput, manualNoteInput, refetchCacheRows, closeManualEdit]);

  // Frozen baseline of Veracross-side `raised` per initiative (keyed
  // case-insensitive). Set once when the route response arrives;
  // client-side grant edits never change it.
  const raisedByKey = useMemo(() => {
    const m = new Map<string, { name: string; raised: number; manualRaised: number; manualRaisedNote: string | null }>();
    if (!data) return m;
    for (const init of data.initiatives) {
      const key = init.name.toLowerCase().trim();
      // The route's `raised` is already effective (Veracross + manual);
      // back out the Veracross-only portion so a freshly-saved manual
      // override recomputes the effective total without a refetch.
      const veracross = init.raised - init.manualRaised;
      const ov = manualOverride.get(key);
      const manual = ov ? ov.manual : init.manualRaised;
      const note = ov ? ov.note : init.manualRaisedNote;
      m.set(key, { name: init.name, raised: veracross + manual, manualRaised: manual, manualRaisedNote: note });
    }
    return m;
  }, [data, manualOverride]);

  const derivedInitiatives = useMemo(
    () => deriveInitiatives(grants, raisedByKey),
    [grants, raisedByKey],
  );

  const totalRaised = useMemo(
    () => derivedInitiatives.reduce((s, r) => s + r.raised, 0),
    [derivedInitiatives],
  );
  const totalDisbursed = useMemo(
    () => derivedInitiatives.reduce((s, r) => s + r.disbursed, 0),
    [derivedInitiatives],
  );
  const totalBalance = totalRaised - totalDisbursed;

  // Pre-bucketed grants by initiative key, so the expanded sub-table
  // doesn't have to filter the full grants[] array on every render.
  // Declared before the cache-derived memos below because
  // hiddenInitiatives consults it for the disbursed total.
  const grantsByInitiativeKey = useMemo(() => {
    const m = new Map<string, Grant[]>();
    for (const g of grants) {
      const k = (g.initiative ?? '').trim().toLowerCase();
      if (!k) continue;
      const arr = m.get(k) ?? [];
      arr.push(g);
      m.set(k, arr);
    }
    // Sort within each bucket: most recent date_wire_sent first, then
    // date_received, then grant_number for a stable read.
    for (const [, arr] of m) {
      arr.sort((a, b) => {
        const aDate = a.date_wire_sent ?? a.date_received ?? '';
        const bDate = b.date_wire_sent ?? b.date_received ?? '';
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return (a.grant_number ?? '').localeCompare(b.grant_number ?? '');
      });
    }
    return m;
  }, [grants]);

  // Map raised_cache rows by trimmed lowercase event_name for fast
  // lookup in the initiatives table. Editors get id + effective
  // is_excluded; non-editors never fetched the data so this is empty.
  const cacheByName = useMemo(() => {
    const m = new Map<string, { id: string; isExcluded: boolean }>();
    for (const r of cacheRows) {
      const key = r.event_name.toLowerCase().trim();
      const overlay = optimisticExcluded.get(r.id);
      const isExcluded = overlay != null ? overlay : r.is_excluded;
      m.set(key, { id: r.id, isExcluded });
    }
    return m;
  }, [cacheRows, optimisticExcluded]);

  // Synthesized Initiative rows for currently-hidden cache entries.
  // Disbursed comes from the local grants slice (same key matching as
  // deriveInitiatives) so a hidden initiative still shows its grants
  // total when Emily toggles "Show hidden" on. Hidden rows only render
  // when canEditGrants + showHidden.
  const hiddenInitiatives = useMemo<Initiative[]>(() => {
    if (!canEditGrants) return [];
    const out: Initiative[] = [];
    for (const r of cacheRows) {
      const overlay = optimisticExcluded.get(r.id);
      const isExcluded = overlay != null ? overlay : r.is_excluded;
      if (!isExcluded) continue;
      const key = r.event_name.toLowerCase().trim();
      let disbursed = 0;
      const grantBucket = grantsByInitiativeKey.get(key) ?? [];
      for (const g of grantBucket) {
        if (!g.is_visible) continue;
        if (!g.wire_was_sent) continue;
        if (g.grant_not_given) continue;
        disbursed += Number(g.funding_amount || 0);
      }
      const ov = manualOverride.get(key);
      const manual = ov ? ov.manual : Number(r.manual_raised || 0);
      const note = ov ? ov.note : (r.manual_raised_note ?? null);
      const raised = Number(r.raised || 0) + manual;
      out.push({ name: r.event_name, raised, manualRaised: manual, manualRaisedNote: note, disbursed, balance: raised - disbursed });
    }
    out.sort((a, b) => b.raised - a.raised);
    return out;
  }, [canEditGrants, cacheRows, optimisticExcluded, grantsByInitiativeKey, manualOverride]);

  const filteredInitiatives = useMemo(() => {
    // Honor the optimistic overlay: filter out derived initiatives
    // whose raised_cache row is currently flagged excluded.
    const baseVisible = derivedInitiatives.filter(init => {
      const cache = cacheByName.get(init.name.toLowerCase().trim());
      return !cache || !cache.isExcluded;
    });
    const combined = (canEditGrants && showHidden)
      ? [...baseVisible, ...hiddenInitiatives]
      : baseVisible;
    const q = initiativeSearch.trim().toLowerCase();
    if (!q) return combined;
    return combined.filter(i => i.name.toLowerCase().includes(q));
  }, [derivedInitiatives, cacheByName, hiddenInitiatives, canEditGrants, showHidden, initiativeSearch]);

  const filteredMoneyIn = useMemo(() => {
    if (!data) return [];
    const q = moneyInSearch.trim().toLowerCase();
    if (!q) return data.moneyIn;
    return data.moneyIn.filter(m => m.event.toLowerCase().includes(q));
  }, [data, moneyInSearch]);

  // Dropdown options for the panel's Initiative combobox — union of
  // Veracross event names + any unique initiative names already on a
  // grant row. Sorted alphabetically.
  const initiativeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const v of data?.veracrossEvents ?? []) {
      if (v) s.add(v);
    }
    for (const g of grants) {
      const t = (g.initiative ?? '').trim();
      if (t) s.add(t);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [data, grants]);

  const chartData = useMemo(() => {
    return derivedInitiatives
      .slice()
      .sort((a, b) => b.raised - a.raised)
      .slice(0, 12)
      .map(i => ({ name: i.name, short: truncate(i.name, 20), raised: i.raised, disbursed: i.disbursed }));
  }, [derivedInitiatives]);

  const openAddPanel = useCallback((initiative: string) => {
    setEditing(null);
    setForm(emptyForm(initiative, suggestNextGrantNumber(grants)));
    setPanelOpen(true);
  }, [grants]);

  const openEditPanel = useCallback((g: Grant) => {
    setEditing(g);
    setForm(grantToForm(g));
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditing(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const initiative = form.initiative.trim();
    const amount = parseFloat(form.funding_amount);
    if (!initiative) {
      setToast('Initiative is required');
      return;
    }
    if (!Number.isFinite(amount)) {
      setToast('Amount must be a number');
      return;
    }
    setSaving(true);
    try {
      const payload = formToPayload(form);
      if (editing) {
        const res = await apiFetch(`/api/development/israel-fund/grants/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('PATCH failed');
        const json = (await res.json()) as { grant: Grant };
        setGrants(prev => prev.map(g => g.id === editing.id ? json.grant : g));
        setToast('Grant saved');
      } else {
        const res = await apiFetch('/api/development/israel-fund/grants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, is_visible: true }),
        });
        if (!res.ok) throw new Error('POST failed');
        const json = (await res.json()) as { grant: Grant };
        setGrants(prev => [json.grant, ...prev]);
        setToast('Grant saved');
      }
      closePanel();
    } catch {
      setToast('Save failed — try again');
    } finally {
      setSaving(false);
    }
  }, [form, editing, saving, closePanel]);

  const handleToggleVisible = useCallback(async (g: Grant) => {
    const next = !g.is_visible;
    // Optimistic update; revert on failure.
    setGrants(prev => prev.map(x => x.id === g.id ? { ...x, is_visible: next } : x));
    try {
      const res = await apiFetch(`/api/development/israel-fund/grants/${g.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_visible: next }),
      });
      if (!res.ok) throw new Error('PATCH failed');
    } catch {
      setGrants(prev => prev.map(x => x.id === g.id ? { ...x, is_visible: g.is_visible } : x));
      setToast('Could not toggle visibility');
    }
  }, []);

  const handleDelete = useCallback(async (g: Grant) => {
    const label = g.grant_number ?? g.id.slice(0, 8);
    if (!window.confirm(`Delete Grant ${label}? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/development/israel-fund/grants/${g.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('DELETE failed');
      setGrants(prev => prev.filter(x => x.id !== g.id));
      setToast('Grant deleted');
    } catch {
      setToast('Delete failed — try again');
    }
  }, []);

  if (loading) {
    return (
      <div>
        <ShimmerStatCards count={3} />
        <ShimmerTableRows rows={6} cols={4} />
      </div>
    );
  }

  if (error || !data) {
    return <p className="text-red-500 text-sm py-8 text-center">{error || 'No data available'}</p>;
  }

  const balancePill = (balance: number) => {
    if (balance > 0) return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{formatMoney(balance)}</span>;
    if (balance < 0) return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{formatMoney(balance)}</span>;
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">$0</span>;
  };

  // Column counts for empty-state colSpan inside the expanded grants
  // sub-table. Everyone: 5. Emily adds 8 more = 13.
  const sharedGrantCols = 5;
  const emilyExtraCols = 8;
  const grantTableCols = sharedGrantCols + (canEditGrants ? emilyExtraCols : 0);
  // Initiative summary row has 5 cells (chevron + name + 3 numbers +
  // optional + button), 6 when Emily can see the +Add column.
  const initiativeTableCols = canEditGrants ? 6 : 5;

  return (
    <div>
      {/* Metric cards. Labels are the only change from the prior tab —
          numbers come straight from the derived totals so they stay in
          sync after client-side grant edits. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total Raised</p>
          <p className="text-2xl font-bold text-green-600">{formatMoney(totalRaised)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total Disbursed</p>
          <p className="text-2xl font-bold text-red-600">{formatMoney(totalDisbursed)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Balance at SAR</p>
          <p className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatMoney(totalBalance)}</p>
        </div>
      </div>

      {/* Initiatives table — expandable per row. */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700">By initiative · {derivedInitiatives.length}</h3>
          <div className="flex items-center gap-3">
            {canEditGrants && hiddenInitiatives.length > 0 && (
              <button
                onClick={() => setShowHidden(v => !v)}
                className={`text-xs font-medium px-2 py-1 rounded border ${showHidden ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
                title={showHidden ? 'Hide excluded initiatives' : 'Show excluded initiatives'}
              >
                {showHidden ? `Hide hidden (${hiddenInitiatives.length})` : `Show hidden (${hiddenInitiatives.length})`}
              </button>
            )}
            <div className="relative">
              <input
                type="text"
                value={initiativeSearch}
                onChange={e => setInitiativeSearch(e.target.value)}
                placeholder="Search initiatives..."
                className="text-sm rounded-lg border border-slate-200 px-3 py-1 w-60 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {initiativeSearch && (
                <button
                  onClick={() => setInitiativeSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                >×</button>
              )}
            </div>
          </div>
        </div>
        <div style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-slate-200">
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase w-8"></th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Initiative</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Raised</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Disbursed</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Balance</th>
                {canEditGrants && <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase w-24"></th>}
              </tr>
            </thead>
            <tbody>
              {filteredInitiatives.length === 0 ? (
                <tr>
                  <td colSpan={initiativeTableCols} className="px-5 py-6 text-center text-sm text-slate-400">No matching initiatives.</td>
                </tr>
              ) : (
                filteredInitiatives.map((init) => {
                  const initKey = init.name.toLowerCase().trim();
                  const isExpanded = expandedInitiative === init.name;
                  const initGrants = grantsByInitiativeKey.get(initKey) ?? [];
                  // For non-Emily viewers we strip hidden grants entirely
                  // before render. Emily sees them muted with a closed-eye
                  // icon.
                  const visibleGrants = canEditGrants ? initGrants : initGrants.filter(g => g.is_visible);
                  const cacheEntry = cacheByName.get(initKey);
                  const isHidden = cacheEntry?.isExcluded === true;
                  const rowMutedCls = isHidden ? 'text-slate-400' : 'text-slate-800';
                  return (
                    <Fragment key={init.name}>
                      <tr
                        className={`border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''} ${isHidden ? 'bg-slate-50/60' : ''}`}
                        onClick={() => setExpandedInitiative(prev => prev === init.name ? null : init.name)}
                      >
                        <td className="px-3 py-3 text-slate-400">
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className={`px-3 py-3 font-medium ${rowMutedCls}`}>{init.name}</td>
                        <td className={`px-5 py-3 text-right ${isHidden ? 'text-slate-400' : 'text-slate-600'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span>{formatMoney(init.raised)}</span>
                            {init.manualRaised > 0 && (
                              <span
                                className="text-blue-500 cursor-help"
                                title={
                                  init.manualRaisedNote
                                    ? `Includes ${formatMoney(init.manualRaised)} entered manually (not in Veracross): ${init.manualRaisedNote}`
                                    : `Includes ${formatMoney(init.manualRaised)} entered manually (not in Veracross)`
                                }
                              >
                                {/* Info circle */}
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                </svg>
                              </span>
                            )}
                            {canEditGrants && cacheEntry && (
                              <button
                                onClick={e => { e.stopPropagation(); openManualEdit(initKey, cacheEntry.id, init.manualRaised, init.manualRaisedNote); }}
                                title="Edit raised (manual amount)"
                                className="text-slate-400 hover:text-blue-600"
                              >
                                {/* Pencil */}
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                                </svg>
                              </button>
                            )}
                          </span>
                        </td>
                        <td className={`px-5 py-3 text-right ${isHidden ? 'text-slate-400' : 'text-slate-600'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(init.disbursed)}</td>
                        <td className="px-5 py-3 text-right">{balancePill(init.balance)}</td>
                        {canEditGrants && (
                          <td className="px-3 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              {cacheEntry && (
                                <button
                                  onClick={e => { e.stopPropagation(); handleToggleExcluded(cacheEntry.id, !isHidden); }}
                                  title={isHidden ? 'Restore (show on page)' : 'Hide from page'}
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  {isHidden ? (
                                    // Eye closed
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                    </svg>
                                  ) : (
                                    // Eye open
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                  )}
                                </button>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); openAddPanel(init.name); }}
                                className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                              >
                                + Add
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {canEditGrants && editingRaisedKey === initKey && (
                        <tr className="bg-blue-50/40 border-b border-slate-200">
                          <td></td>
                          <td colSpan={initiativeTableCols - 1} className="px-3 py-3">
                            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                              <div className="flex-shrink-0">
                                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Manual raised amount</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={manualAmountInput}
                                  onChange={e => setManualAmountInput(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                  placeholder="0"
                                />
                              </div>
                              <div className="flex-1 min-w-[180px]">
                                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Note</label>
                                <input
                                  type="text"
                                  value={manualNoteInput}
                                  onChange={e => setManualNoteInput(e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                  placeholder="e.g. Venmo fundraiser, not in Veracross"
                                />
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                  onClick={e => { e.stopPropagation(); void handleSaveManual(); }}
                                  disabled={savingManual}
                                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
                                >
                                  {savingManual ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); closeManualEdit(); }}
                                  disabled={savingManual}
                                  className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-2">
                              Manual raised is added on top of the Veracross total for money that doesn&apos;t flow through Veracross (e.g. a Venmo fundraiser).
                            </p>
                          </td>
                        </tr>
                      )}
                      {isExpanded && (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td></td>
                          <td colSpan={initiativeTableCols - 1} className="px-3 py-3">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs min-w-[640px]">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                                    <th className="text-left px-2 py-2 font-semibold">Grant #</th>
                                    <th className="text-left px-2 py-2 font-semibold">Organization/Person</th>
                                    <th className="text-left px-2 py-2 font-semibold">What they&apos;re funding</th>
                                    <th className="text-right px-2 py-2 font-semibold">Amount</th>
                                    <th className="text-left px-2 py-2 font-semibold">Notes</th>
                                    {canEditGrants && (
                                      <>
                                        <th className="text-left px-2 py-2 font-semibold">Category</th>
                                        <th className="text-left px-2 py-2 font-semibold">Submitted By</th>
                                        <th className="text-left px-2 py-2 font-semibold">Contact Info</th>
                                        <th className="text-left px-2 py-2 font-semibold">Procurify</th>
                                        <th className="text-left px-2 py-2 font-semibold">Procurify #</th>
                                        <th className="text-left px-2 py-2 font-semibold">Wire Sent</th>
                                        <th className="text-left px-2 py-2 font-semibold">Visible</th>
                                        <th className="text-right px-2 py-2 font-semibold">Actions</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleGrants.length === 0 ? (
                                    <tr>
                                      <td colSpan={grantTableCols} className="px-2 py-4 text-center text-slate-400 italic">
                                        No grants for this initiative yet.
                                      </td>
                                    </tr>
                                  ) : visibleGrants.map(g => {
                                    const muted = !g.is_visible;
                                    const cellCls = muted ? 'px-2 py-2 text-slate-400' : 'px-2 py-2 text-slate-700';
                                    return (
                                      <tr key={g.id} className="border-b border-slate-100 last:border-0">
                                        <td className={cellCls}>
                                          <span className="font-medium">{g.grant_number ?? '—'}</span>
                                        </td>
                                        <td className={cellCls}>{g.organization_person ?? '—'}</td>
                                        <td className={cellCls}>{g.what_funding ?? '—'}</td>
                                        <td className={`${cellCls} text-right`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                          {formatMoney(g.funding_amount)}
                                        </td>
                                        <td className={cellCls}>{g.notes ? <span title={g.notes}>{truncate(g.notes, 40)}</span> : '—'}</td>
                                        {canEditGrants && (
                                          <>
                                            <td className={cellCls}>{g.category ?? '—'}</td>
                                            <td className={cellCls}>{g.submitted_by ?? '—'}</td>
                                            <td className={cellCls}>{g.contact_info ? <span title={g.contact_info}>{truncate(g.contact_info, 24)}</span> : '—'}</td>
                                            <td className={cellCls}>{g.submitted_to_procurify ?? '—'}</td>
                                            <td className={cellCls}>{g.procurify_number ?? '—'}</td>
                                            <td className={cellCls}>{g.wire_was_sent ? '✓' : '✗'}</td>
                                            <td className="px-2 py-2">
                                              <button
                                                onClick={() => handleToggleVisible(g)}
                                                title={g.is_visible ? 'Hide from non-Emily viewers' : 'Show to everyone'}
                                                className="text-slate-500 hover:text-slate-900"
                                              >
                                                {g.is_visible ? (
                                                  // Eye open
                                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                  </svg>
                                                ) : (
                                                  // Eye closed
                                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                                  </svg>
                                                )}
                                              </button>
                                            </td>
                                            <td className="px-2 py-2 text-right">
                                              <div className="inline-flex items-center gap-2">
                                                <button
                                                  onClick={() => openEditPanel(g)}
                                                  title="Edit grant"
                                                  className="text-slate-500 hover:text-blue-600"
                                                >
                                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                                                  </svg>
                                                </button>
                                                <button
                                                  onClick={() => handleDelete(g)}
                                                  title="Delete grant"
                                                  className="text-slate-500 hover:text-red-600"
                                                >
                                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                  </svg>
                                                </button>
                                              </div>
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {/* Donors subsection — lazy-loaded on first
                                expand. Grants live above; this surfaces
                                the donor-side recent activity for the
                                same initiative. */}
                            {(() => {
                              const entry = donorsByInit.get(init.name);
                              const loading = donorsLoading.has(init.name);
                              // "No entry yet" = pre-effect-fire frame.
                              // Treat that as loading so the heading is
                              // always visible the moment the row expands.
                              const isLoading = loading || !entry;
                              return (
                                <div className="mt-4">
                                  <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Donors</h4>
                                  {isLoading ? (
                                    <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                                      <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      Loading donors…
                                    </div>
                                  ) : entry.donors.length === 0 ? (
                                    <p className="text-xs italic text-slate-400 py-2">Donor data available from May 2025 onward.</p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs min-w-[480px]">
                                        <thead>
                                          <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                                            <th className="text-left px-2 py-2 font-semibold">Donor</th>
                                            <th className="text-right px-2 py-2 font-semibold">Amount</th>
                                            <th className="text-left px-2 py-2 font-semibold">Date</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {entry.donors.map((d, i) => (
                                            <tr key={`${init.name}-donor-${i}`} className="border-b border-slate-100 last:border-0">
                                              <td className="px-2 py-2 text-slate-700">{d.name}</td>
                                              <td className="px-2 py-2 text-right text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.amount)}</td>
                                              <td className="px-2 py-2 text-slate-500">{d.date ? new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      {entry.hasMore && (
                                        <p className="text-[11px] italic text-slate-400 mt-2">Showing most recent 100 gifts.</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Chart — Raised vs. Disbursed, top 12 by raised. */}
      {chartData.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Raised vs. Disbursed by Initiative</h3>
          <div style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 10, right: 24, bottom: 0, left: 10 }}
                barCategoryGap={6}
              >
                <XAxis type="number" tickFormatter={axisMoney} tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="short"
                  width={160}
                  tick={{ fontSize: 11 }}
                  interval={0}
                />
                <Tooltip
                  formatter={(value, name) => [formatMoney(Number(value)), name === 'raised' ? 'Raised' : 'Disbursed']}
                  labelFormatter={(_label, payload) => {
                    const full = payload?.[0]?.payload?.name;
                    return typeof full === 'string' ? full : String(_label);
                  }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend formatter={(v) => v === 'raised' ? 'Raised' : 'Disbursed'} />
                <Bar dataKey="raised" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="disbursed" fill="#f87171" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Money In — collapsible. Unchanged from prior tab. */}
      {data.moneyIn && data.moneyIn.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <button
            onClick={() => setMoneyInOpen(o => !o)}
            className="w-full px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between hover:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform ${moneyInOpen ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <h3 className="text-sm font-semibold text-slate-700">Money In · By Event ({data.moneyIn.length})</h3>
            </div>
            <span className="text-xs text-slate-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(data.moneyIn.reduce((s, m) => s + m.total, 0))} total
            </span>
          </button>
          {moneyInOpen && (
            <>
              <div className="px-5 py-3 border-b border-slate-200">
                <div className="relative">
                  <input
                    type="text"
                    value={moneyInSearch}
                    onChange={e => setMoneyInSearch(e.target.value)}
                    placeholder="Search events..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  {moneyInSearch && (
                    <button
                      onClick={() => setMoneyInSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                    >×</button>
                  )}
                </div>
              </div>
              <div style={{ maxHeight: 480, overflow: 'auto' }}>
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Event</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Raised</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Outstanding Pledges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMoneyIn.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-6 text-center text-sm text-slate-400">No matching events.</td>
                      </tr>
                    ) : (
                      filteredMoneyIn.map((m) => (
                        <tr key={m.event} className="border-b border-slate-100 last:border-0">
                          <td className="px-5 py-3 font-medium text-slate-800">{m.event}</td>
                          <td className="px-5 py-3 text-right text-slate-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(m.total)}</td>
                          <td className="px-5 py-3 text-right text-slate-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {m.pledgeBalance > 0 ? formatMoney(m.pledgeBalance) : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3 mb-2">
        Raised: Veracross gifts data · Disbursed: Israel Fund Grants (managed by Emily Gray) · Updated live
      </p>

      <p className="text-xs text-slate-400">
        Data as of {new Date(data.as_of).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>

      {/* Add / Edit panel. Same backdrop + slide-in pattern as the
          Guardian Circle donor sidebar — 480px instead of 420px to give
          the form more breathing room. */}
      {panelOpen && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/20 z-40 print:hidden"
            onClick={closePanel}
          />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col print:hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold text-slate-900">
                {editing ? `Edit Grant ${editing.grant_number ?? ''}`.trim() : 'Add Grant'}
              </h3>
              <button
                onClick={closePanel}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 text-sm">
              <FormRow label="Initiative" required>
                <input
                  type="text"
                  list="israel-initiative-options"
                  value={form.initiative}
                  onChange={e => setForm(f => ({ ...f, initiative: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Choose or type a new initiative…"
                />
                <datalist id="israel-initiative-options">
                  {initiativeOptions.map(opt => <option key={opt} value={opt} />)}
                </datalist>
              </FormRow>

              <FormRow label="Grant #">
                <input
                  type="text"
                  value={form.grant_number}
                  onChange={e => setForm(f => ({ ...f, grant_number: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </FormRow>

              <FormRow label="Organization/Person">
                <input type="text" value={form.organization_person}
                  onChange={e => setForm(f => ({ ...f, organization_person: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Date Received">
                <input type="date" value={form.date_received}
                  onChange={e => setForm(f => ({ ...f, date_received: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Category">
                <input type="text" value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Link">
                <input type="url" value={form.link}
                  onChange={e => setForm(f => ({ ...f, link: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="https://…" />
              </FormRow>

              <FormRow label="What they're funding">
                <textarea rows={3} value={form.what_funding}
                  onChange={e => setForm(f => ({ ...f, what_funding: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Submitted By">
                <input type="text" value={form.submitted_by}
                  onChange={e => setForm(f => ({ ...f, submitted_by: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Contact Info">
                <textarea rows={2} value={form.contact_info}
                  onChange={e => setForm(f => ({ ...f, contact_info: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Amount" required>
                <input
                  type="number"
                  step="0.01"
                  value={form.funding_amount}
                  onChange={e => setForm(f => ({ ...f, funding_amount: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </FormRow>

              <FormRow label="Notes">
                <textarea rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Submitted to Procurify">
                <input type="text" value={form.submitted_to_procurify}
                  onChange={e => setForm(f => ({ ...f, submitted_to_procurify: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <FormRow label="Procurify #">
                <input type="text" value={form.procurify_number}
                  onChange={e => setForm(f => ({ ...f, procurify_number: e.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </FormRow>

              <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={form.wire_was_sent}
                  onChange={e => setForm(f => ({ ...f, wire_was_sent: e.target.checked }))}
                />
                Wire sent
              </label>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={closePanel}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Grant'}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white rounded-lg px-4 py-3 shadow-lg z-[60] text-sm print:hidden">
          {toast}
        </div>
      )}
    </div>
  );
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
