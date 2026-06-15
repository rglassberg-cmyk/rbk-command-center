# RBK Command Center — Master TODO

> ⚠️ THIS IS THE ONLY TODO FILE. Update this after every session. Do not create new TODO or action item files. Archive any other planning docs by adding an ARCHIVED header. Phase build plans are reference-only.

*Last updated: June 15, 2026*

For the longer roadmap + horizon items + architecture history, see `RBKCC_VISION_AND_ROADMAP.md`. For implementation detail, see `CLAUDE_CONTEXT.md` ("Recent Changes" section).

---

## ✅ Shipped (June 15, 2026)

- ✅ **After School Programs page — new module + Veracross programs API** (rev `ssrrbkcmdcenter-00670-97n`, deployed + site verified UP HTTP 307). New standalone Academics page (nav item after Student Absences, book-open icon) showing after-school enrollment from the Veracross **programs** API. New OAuth app creds `VERACROSS_PROGRAMS_CLIENT_ID/SECRET` (existing clients lack `programs.*` scopes — confirmed via `scripts/discoverProgramsApi.ts`); added to `.env.local` + `deploy.sh` Cloud Run env. Two cache tables (`after_school_classes_cache`, `after_school_enrollments_cache`, RLS on, server-only) created via `scripts/migrations/after-school-tables.sql`. Secret-auth sync route `POST /api/after-school/sync` (header-paginated; allow-lists the exact course names; classifies tzaharon / ms_extracurriculars / after_school; upserts classes **without** touching `capacity`; delete+reinsert enrollments so withdrawals drop out) — first run **595 classes / 5,417 enrollments**. Data route `GET /api/after-school?school_year=2026` (Supabase-only, `after_school`-module gated). UI `AfterSchoolTab.tsx`: year toggle 2025–26 / 2026–27 (default 26-27), 3 summary cards, per-group collapsible tables (enrolled color-coding, fill bars, grade chips), right slide-in per-class drilldown (grade breakdown + `Student #{person_id}` list — names stubbed). Daily 7am Cloud Function `syncAfterSchoolPrograms` (scheduler ENABLED). Module enabled on the SAR workspace; granted to Debra May (`debra@saracademy.org` — task said `debramay@`, which doesn't exist) and Becca (owner, sees it automatically). **Key learnings:** Veracross `school_year` = FALL year (2026 = AY 26-27); programs API paginates by `X-Page-Size`/`X-Page-Number` headers (default 2/page), no `X-Total-Count`; classes have no `capacity` field; enrollments have no names (only `person_id`); `meeting_times` needs a class id in the path. **Caveat:** owners/assistants (RBK, Emily) also see the page — inherent to the module model; per-user hiding would need a testing_features-style flag. tsc (app + functions) + build clean.

## ✅ Shipped (June 14, 2026)

- ✅ **Development Overview — segment soft credits now gap-fill only (double-count fix)** (rev `ssrrbkcmdcenter-00668-w2w`, deployed + site verified UP HTTP 307). Last week's change (`00659-9l8`) added type-3 soft credits to **every** constituent's segment `received`, but Veracross writes a `gift_type=3 / soft_credit_type=1` soft-credit twin for **every** direct `gift_type=1` gift — so every direct donor was counted twice, inflating all segment totals. Separately, donors whose only FY26 attribution was a household soft credit (`gift_type=3 / soft_credit_type=2`, e.g. Cory Greenbaum) were dropped from segments entirely. **Corrected rule (gap-fill), per constituent:** (1) has ANY type-1 row → segment `received` = SUM(type-1 amount), soft credits ignored (they're twins); (2) NO type-1 row → `received` = SUM(amount) on type-3 rows where `soft_credit_type IN (1,2)`. Soft credits ONLY fill the gap for non-direct donors; this also surfaces DAF/org- and household-only donors that were missing. Applies to segment totals, donor counts (a constituent counts once, in one segment, iff type-1 OR type-2 OR qualifying soft credit), and the drill-down lists (mirrored in `segment-donors/route.ts` so they reconcile). Files: `app/api/development/overview/route.ts`, `.../overview/segment-donors/route.ts` only. **Untouched** per spec: headline Total Raised / Total Donors (still `gift_type IN (1,2)`, type-1 count), per-fund campaign table, Lapsed/New/Retained pills, "Pledged" sublines (type-2 `pledge_balance`), Board Members→Trustee priority, all other tabs, `lib/syncGifts.ts`. **Deploy fix:** pinned `frameworksBackend.memory = "512MiB"` in `firebase.json` — the SSR function deploy was rejected because Cloud Run forbids `memory < 512Mi` with the live `--no-cpu-throttling` (CPU always-allocated) setting; now matches the `--memory=512Mi` the deploy script's gcloud step applies. tsc + build clean.

## ✅ Shipped (June 11, 2026)

- ✅ **Add-Task modal — "urgent" flag now sticks on creation** (rev `ssrrbkcmdcenter-00665-94w`, deployed + site verified UP HTTP 307). Creating a task with the urgent toggle on didn't persist; user had to reopen + re-toggle. Two bugs in the Create-Task handler in `app/components/Dashboard.tsx` (modal POSTs `/api/agenda-notes`; urgent is client-side localStorage, not a `/api/tasks` field): (1) it wrote `taskUrgent[\`note-${note.id}\`]` but all lookups key off `getTaskId()` = raw note id → fixed to `taskUrgent[note.id]`; (2) it never persisted to localStorage → now writes `localStorage.setItem('taskUrgent', …)` inside a functional updater, mirroring `toggleTaskUrgent`. Modal already had the urgent toggle UI. Untouched: card urgent toggles, the `taskUrgent` key name, task routes. tsc + build clean.

- ✅ **Buzz AI "Something's off on my end" intermittent-failure fix** (rev `ssrrbkcmdcenter-00664-7s9`, deployed + site verified UP HTTP 307). Four fixes: (1) **root cause** — Cloud Run was throttling CPU to ~0 after the 200 ack to Slack, freezing/aborting Buzz's fire-and-forget Anthropic call → error fallback. Added `--no-cpu-throttling` (+ required `--memory=512Mi`, was 256Mi) to the `gcloud run services update` step in `deploy.sh`; verified live annotation `cpu-throttling: false`. (2) **Per-stage logging** in `lib/buzzConversation.ts` main try (building context / loading history / calling Claude / saving history) + richer catch message, so future failures are diagnosable. (3) **Guarded `saveHistory`** in its own try/catch so a persistence error can't trigger a second "Something's off" after a good answer. (4) **Model id** `claude-sonnet-4-20250514` → `claude-sonnet-4-6` (project canonical). Untouched: fire-and-forget pattern, `processedEventIds` dedup, other Slack notifications. (`lib/morningBriefing.ts` still on the old model id — flagged for follow-up.) tsc + build clean.

- ✅ **Israel Fund "Total Raised" de-inflation — RE-VERIFIED (no new deploy)**. A follow-up request re-asked for the Israel Fund `gift_type = 1` filter + `raised`-cache recompute. **Already shipped earlier the same day (rev `00657-lpv`) and live.** Verified: `lib/syncIsraelFundRaised.ts` already has `.eq('gift_type', 1)` before summing; re-ran the idempotent `scripts/recompute-israel-fund-raised.ts` → **0 rows changed**, displayed Total Raised **$1,947,228.54** (in the $1.88M–$1.95M band); `seed_raised` / `manual_raised` / `is_excluded` untouched. Skipped a redundant redeploy (no code delta = no-op revision). tsc clean.

- ✅ **Development Overview — Lapsed Donors list excludes organizations** (rev `ssrrbkcmdcenter-00661-2hs`, deployed + site verified UP HTTP 307). The Lapsed Donors drill-down was listing orgs (DAFs/foundations/charitable funds); only individual persons should appear. In `gifts_cache` the Veracross record type lives in `raw_data->>'constituent_record_type'` (`'2'` = person, `'3'` = org). Fix in `app/api/development/overview/route.ts`: after building `lapsedIds`, a chunked `gifts_cache` query filtered `.eq('raw_data->>constituent_record_type','3')` collects org IDs (checking **any** gift row for the constituent, not just Operating 2025-2026 — a lapsed org may have no current-year row), then those are filtered out of the displayed `lapsedDonors` array. Unknown/missing record types are kept (only explicit `'3'` excludes). **Lapsed COUNT pill unchanged** (still full `lapsedIds.length`) — only the drill-down list is person-filtered, per spec. tsc + build clean.

- ✅ **Development Overview — Board Members segment + soft credits in segment cards** (rev `ssrrbkcmdcenter-00659-9l8`, deployed + site verified UP HTTP 307). (1) Added **Board Members** (trustees) as the **highest-priority** segment in `classifySegment` (`roles_raw ILIKE '%Trustee%'` AND NOT `%Trustee - Former%` AND NOT `%DECEASED%`) — so a trustee who is also a parent now classifies as Board Members. New order: Board Members → Parent → Grandparent → Parents of Alumni → Program & Future Families → Alumni → Faculty → Other (UI segment grid widened 7→8 cols, indigo card style). (2) **Soft credits** (`gift_type = 3`, `soft_credit_type = 1`) now count toward each **segment card** total + donor count (DAF/foundation gifts were falling into Other) — folded into the card "Received" subline (type-1 + type-3) and `fy26SegmentDonors`; "Pledged" stays type-2 only. **Headline Total Raised / Total Donors / per-fund campaign table / Lapsed / New are unchanged** (still `gift_type IN (1,2)`). Drill-down route mirrors the same math so donor lists reconcile with card totals. Files: `app/api/development/overview/route.ts`, `.../overview/segment-donors/route.ts`, `app/components/development/OverviewTab.tsx`. tsc + build clean.

- ✅ **Israel Fund "Total Raised" de-inflated** (rev `ssrrbkcmdcenter-00657-lpv`, deployed + site verified UP HTTP 307). The raised-cache incremental sync (`lib/syncIsraelFundRaised.ts`) was summing **all** `gift_type`s from `gifts_cache`, so non-seeded events double-counted Veracross's hard-credit (`gift_type=1`) + soft-credit (`gift_type=3`) row pairs (plus leaking pledges types 2/5). **Code fix:** added `.eq('gift_type', 1)` before the amounts are aggregated. **Data fix:** one-time `scripts/recompute-israel-fund-raised.ts` reset `raised` for non-seeded rows only to the `gift_type=1` sum (9 rows lowered). `seed_raised` ($1,841,649.79 across 39 seeded rows), `manual_raised` ($50,697), and `is_excluded` left untouched. Displayed Total Raised: **$2.05M → $1,947,228.54** (in the expected $1.88M–$1.95M band). Script is idempotent.

---

## ✅ Shipped (June 10, 2026)

- ✅ **Major-gift Slack alert no longer double-fires** (rev `ssrrbkcmdcenter-00655-x2t`, deployed + site verified UP). Veracross writes a hard credit (`gift_type=1`) AND a soft credit (`gift_type=3`) per gift, so Sara's ≥$1,000 alert listed each gift twice. Added `gift_type === 1` to the `majorGifts` filter in `lib/syncGifts.ts` (hard credits / real money only; pledges type 2 + soft-credit pledges type 5 also excluded). `gifts_cache` upsert unchanged — still stores all gift types.

---

## 🔴 Immediate (This Week)

- [ ] **Cooper Fund — Schreck + Israel Gap Year merge**: `Israel Gap Year Scholarships` + `M Schreck B Ball Tournament` should both display as `M Schreck Fund / Israel Gap Year Scholarship`. Cooper still shows them split.
- [ ] **Cooper Fund — General/Undesignated → Cooper 25-26 bucket**. Emily asked where the $360 is pulling from.
- [ ] **Cooper Fund — Cooper Yahrzeit → Cooper 25-26 bucket**.
- [ ] **Cooper Fund — drop Education Sayeret Matkal Soldier entirely** (Israel Fund, not Cooper).
- [ ] **Cooper Fund — Cooper Purim 25 raised should be $0**. Money raised was last FY, disbursements are this FY. Confirm with Emily; she may relabel in the spreadsheet.
- [ ] **Cooper Fund accuracy gap**: Leora's ground truth = $350,294; page shows $388,804 → $38K gap. Root cause TBD.
- [ ] **Cooper Fund pie chart label overlap fix** — prompt drafted, deploy pending.
- [ ] **Cooper Fund — General Fund summary card** to left of bar chart — prompt drafted, deploy pending.
- [ ] **Israel Fund — Emily verifies seeded grant totals** match her spreadsheet ground truth. 346 rows imported; numbers should match.
- [ ] **Israel Fund — drop `total_paid_out` + `paidOut` aliases** from `/api/development/israel-fund` response (UI now uses `total_disbursed` / `disbursed` exclusively).

---

## 🟡 Development Module

### Guardian Circle
- [ ] **Migrate Veracross link to `app.veracross.com/sar/{person_id}/273/general`** — current link uses `development-constituent` axiom path with `constituent_id` (works). Move requires `person_id` in `constituents_cache`; not currently synced.
- [ ] **Mobile column overflow** — Guardian Circle + Weekly Gifts donor tables: show only Name + Event/Fund on mobile, all others `hidden md:table-cell`; row tap opens existing sidebar.

### Cooper Fund / Israel Fund
- [ ] **"Today" filter pill** on both Cooper Fund and Israel Fund money-in sections (same first-pill pattern as Weekly Gifts).
- [ ] **Clickable event rows** on both pages: expand a money-in row to show individual gifts (constituent name, amount, date, Veracross link) + DonorAnnotations per gift.
- [ ] **Cooper Fund Slack channel mention** — `@CooperFundChannel` taggable in the @mention dropdown on Cooper Fund notes (blocker: channel ID from Emily).
- [ ] **Cooper Fund YoY category tracking** — current FY Column H vs prior year snapshot from `cooper_fund_categories`.
- [ ] **Source spreadsheet link** on Cooper Fund + Israel Fund pages (Heidi's suggestion), permission-gated.

### Overview / homepage
- [ ] **Lapsed Donors card** — decide whether to hide until Shavuot per Becca's note.

### Capital Campaign
- [ ] **Build out Capital Campaign tab content**. Fund: `Big Bold Future`. Sara sending Veracross queries — UNBLOCKED. Wants: overview buckets (designated vs undesignated), YoY, by constituent.

### Year-over-Year
- [ ] **Add last-year data alongside current year across all Development metrics** — total raised, donors by segment, lapsed count. Sara has 5+ years of data; can start with static/hardcoded prior year then build the snapshot system.

### Confirm with Leora
- [ ] Verify new Veracross events auto-show on Command Center with no manual step.

### Veracross API blocker (assigned to Veracross)
- [ ] **Veracross ticket: `/v3/development/gifts` historical gap** — full pull returns ~11k rows, earliest 2025-04-27. ~$703K Israel Fund history + 3 known Guardian Circle gifts ($28K) inaccessible via this endpoint. Ticket submitted 2026-06-03. Update `FLAGGED_RECORDS` in `GuardianCirclePage.tsx` as gifts resolve.

---

## 🟡 Other Modules

### Tasks
- [ ] **Due-Date Slack reminder** — Cloud Function at 8am ET → query `tasks WHERE due_date = today AND status != 'done'` → DM each assignee's Slack ID from MENTIONABLE_USERS.

### Simchas & Shivas
- [ ] **Send Note overhaul** — modal/inline form first with optional note text → task body (not just title) in Emily's queue with Hamakum-parsed family info + RBK's note → Slack DM Emily on task creation.

### Emails Page + Thank You workflow
- [ ] **"Action Items" / "To Send" section at top of All Emails** with three card types: Day of Learning thank yous, Guardian Circle thank yous (surface envelope-icon drafts), Condolence notes from the Simchas flow. Each card: donor/family, type, draft preview, Send + Edit.
- [ ] **Day of Learning thank you automation** — fund `OP: Sponsorships`, event `Day of Learning 25-26`. Add Veracross gift-notes (dedication text) to `gifts_cache` sync → auto-draft via Claude → surface in To Send cards. Leora maintains `day_of_learning_month` / `day_of_learning_day` profile codes.
- [ ] **Auto-BCC Veracross tracking on all thank yous sent from the app** — append `bcc=` to mailto/Gmail send payload.

### Calendar / Week at a Glance
- [ ] Verify Zoom/Meet/Teams link detection in prod (added 6/2).
- [ ] RSVP / Register link on calendar event cards if event has registration URL.
- [ ] Confirm calendar event grade tags working for all recurring events.

### Student Absences
- [ ] Confirm correct Veracross query ID for "Yesterday's Absences" — current link is placeholder `1473847`.
- [ ] User-education note: 8:15am high present rate is expected (default present until teacher submits). Discuss with Emily Gray before any code change.

### Attendance YTD
- [ ] Perfect-attendance students missing from tiers chart (not in `attendance_cache` by design).

### Communications
- [ ] Get Yael + Ilana into a meeting (Emily to push). RBK explicitly wants to use Communications.
- [ ] Monday.com Approvals Queue: raw API status value mismatch with `"Pending RBK Approval"`.

### Recruiting
- [ ] **Lever webhook activation** — manual step in Lever Settings → Webhooks. Triggers Slack DM to RBK for new non-HS applications.
- [ ] Walk RBK through the Lever page + notes flow (no build, just demo).
- [ ] **Recruiting HS toggle for Debra May** — Academy / HS / All (same pattern as enrollment).

### Admissions
- [ ] **Application Pipeline tab** — prospects (inquiry) vs applicants (full application). Blocked on Veracross field investigation.

### Infrastructure / cleanup
- [ ] Cloud Function workspace-awareness (reads credentials from DB vs env vars) — Phase G.
- [ ] Credential encryption (`pgsodium` / KMS for `workspace_integrations`) — Phase G.
- [ ] Google Tasks two-way sync (auth flow already scaffolded).
- [ ] Phase A-F regression test pass — RBK email signature, division filters, Tasks columns, Inbox sections, social tiles, geography drilldown.
- [ ] Weekly Gifts: filter out `constituent_name = 'SAR Academy'` internal $900K journal entries (1-line fix).

---

## 🟠 Blocked / Waiting on Stakeholders

### Debra May (Executive Director)
- [ ] **Transportation page** — bus route → stop mapping. Page shows student name, grade, stop, cost, outstanding balance. P&L per route. Academy + HS.
- [ ] **Scholarship button** — ParentLocker URL format per student. Button visible to all (privacy); only works for authorized.
- [ ] **After-school programs page** — Veracross endpoint. Enrollment per program + grade, drilldown like admissions.

### Joe Ali (Facilities/IT)
- [ ] **Facilities/IT ticket tracker** — Joe getting shared access to ticketing system. Surface (link or iframe) — don't rebuild.

### Leora Miller (Development)
- [ ] Day of Learning thank yous: Veracross field name for dedication/honoree text.

### Emily Gray (EA)
- [ ] Thank-you BCC email address for Veracross gift tracking.
- [ ] Cooper Fund Slack channel ID for `@CooperFundChannel` mention.

### Sara Hasson (Development)
- [ ] Veracross queries for Big Bold Future / Capital Campaign tab data.
- [ ] Campaign naming cleanup in Veracross — RBK wants fewer top-level campaigns with subcategories.

### Paycom (HR vendor)
- [ ] API credentials. Email sent to rep; awaiting response. Short-term workaround: Amy's Google Sheet (already populated by GAS scraping Paycom Slack messages).

### RBK
- [ ] Rise Vision / Digital Signage — screen URLs for 5–6 campus displays.
- [ ] App name decision — Becca + Debra May both dislike "Command Center". Becca suggested "Beacon" (Veracross uses that too). Ask RBK directly.

### Becca to gather
- [ ] HS principal email, name, title — for onboarding row in `workspace_members`.

### Veracross support
- [ ] `/v3/development/gifts` historical gap (ticket 2026-06-03).
- [ ] `grade_applying_for` / `student_group_applying_for` for re-enrolling students (second follow-up needed).

---

## 🟣 Non-Code Items

### Permissions to grant
- [ ] **Debra May**: add Development module + `guardian-circle` access via `/admin/permissions`.

### Manual steps
- [ ] **Lever webhook**: activate in Lever Settings → Integrations & API → Webhooks. URL `https://rbk-cmd-center.web.app/api/webhook/lever`, `applicationCreated` event.
- [ ] **Veracross ticket**: file ticket on the `/v3/development/gifts` historical gap if it hasn't been logged in their support system yet (initial outreach 2026-06-03).

### Sidebar / nav decisions
- [ ] Rename sidebar group "Community" → "Academics" (Simchas to move out of that group).
- [ ] Add **Student Logs page** to sidebar under Academics — link to Veracross Axiom query #1473847.

### Meetings needed
- [ ] Yael + Ilana (Communications team) — Emily to push.
- [ ] Sara Hasson — Capital Campaign + Big Bold Future query review.
- [ ] HS principal (when onboarded) + RBK — HS dashboard expansion proposal.

### Long-tail other
- [ ] Shabbos print queue concept — RBK drops article links during the week; Emily prints Friday.

---

## ✅ Completed Today (June 5, 2026)

_No new deploys today yet. The most recent ship was 2026-06-03 (`ssrrbkcmdcenter-00600-r46` — Israel Fund canEditGrants role-clause cleanup). Today's session is documentation only — Vision + Roadmap rewrite and master TODO restructure._

---

## ✅ Recently Shipped (last ~2 weeks)

_Items resolved more than two weeks ago have been pruned and now live in `CLAUDE_CONTEXT.md` Recent Changes._

- ✅ **Israel Fund — `israel_fund_editor` sub-permission** (`00598-4zw` → `00600-r46` cleanup, 2026-06-03). First real call site of `hasSubPermission()` in the codebase. Replaced hardcoded `isEmily` with sub-permission + email fallback. SUB_PERMISSIONS registry gained the entry; Becca grants new editors via /admin/permissions Users tab.
- ✅ **Israel Fund — grant CRUD UI** (`00594-lk8`, 2026-06-03). `IsraelFundTab.tsx` uses `total_disbursed` / `disbursed` everywhere (UI rename from `paidOut`). Expandable initiative table with sub-grants, viewer vs. editor column split, 480px Add/Edit slide-in panel with combobox initiative picker, Recharts horizontal bar chart.
- ✅ **Israel Fund — initial seed run** (2026-06-03). 346 grants imported via `npm run seed:israel-grants` from `data/master-eg.csv`. npm script switched from `ts-node` → `tsx` to fix `__dirname` under ESM.
- ✅ **Israel Fund — grants moved to first-class Supabase table** (`00592-2zt`, 2026-06-03). New `israel_fund_grants` schema + RLS; CRUD API (POST/GET list, PATCH/DELETE single); seed script `scripts/seed-israel-fund-grants.ts`. `fetchIsraelGrantsPaidOut` (Sheets) helper retained for rollback but no longer called.
- ✅ **Israel Fund — three fixes** (`00590-2f7`, 2026-06-03). FIX 1: grants sheet is dynamic whitelist (drops unrelated Veracross events). FIX 2: raised total switched to cash-received gift types `[1, 3, 5]`; deviates from Cooper's gift-type model (flagged in route comments). FIX 3: backfill route accepts `?start_date=YYYY-MM-DD` with client-side filter (Veracross rejected `date_from` and `query_string` params).
- ✅ **Guardian Circle — flagged-gifts data-quality callout** (`00584-mlk`, 2026-06-03). Amber collapsible at the top, data-driven from `FLAGGED_RECORDS` array; current total $28,671 across 3 gifts the Veracross API drops.
- ✅ **Israel Fund — live Money Out from Emily's grants sheet** (`00582-48g`, 2026-06-03). Initial Google Sheets pipeline (superseded later same day by the Supabase table). Money In filter widened to `fundraising_activity ILIKE '%External Funds%'`. `israel_fund_summary` snapshot table no longer read.
- ✅ **Feature Flags admin tab** (`00580-bcg`, 2026-06-03). `workspaces.promoted_features text[]` column + `canSeeTestingFeature()` helper. One-click Promote to Live (with confirm) / Move back to Testing.
- ✅ **Testing & Preview feature-flag system** (`00578-vf9`, 2026-06-03). `workspace_members.testing_features text[]` + `TESTING_FEATURES` registry + per-member 🧪 section in Admin → Users. Development Overview tab is first gated feature.
- ✅ **Development Overview landing tab** (`00570-9rz`, 2026-06-02). Default Development tab. Headline cards, segment cards by role, Campaign Giving YoY table, Lapsed Donors collapsible (top 100).
- ✅ **Guardian Circle — `constituents_cache` sync** (`00568-25k`, 2026-06-02). Veracross `/v3/development/constituents` + `/v3/students` joined nightly. 9,650 constituents → 4,213 with specific role, 911 with grade data, 89 flagged aging-out.
- ✅ **Guardian Circle — Sprint 4** (`00562-gfm`, 2026-06-02). BBF / Capital column, role pill + grade chips + aging-out 🚩, clickable donor name → sidebar drawer.
- ✅ **Guardian Circle — Veracross link fix** ("person record not found" bug, 2026-06-02). Switched to `development-constituent` / `organization-constituent` axiom path with `constituent_id`.
- ✅ **Guardian Circle — donor-count fix** (~250 → unique non-org donors, 2026-06-02).
- ✅ **Cooper Fund — event consolidation** (M Schreck variants, Cooper Yahrzeit + General → Cooper 25-26, Education Sayeret Matkal dropped) — 2026-06-02.
- ✅ **Cooper Fund — live Google Sheets Column G** (no hardcoded data, 2026-06-02).
- ✅ **Cooper Fund — DEV: / non-APL event prefix fix** (no longer filtering out, 2026-06-02).
- ✅ **Cooper Fund — Cooper 25-26 split into General Fund summary card** (2026-06-02).
- ✅ **Cooper Fund — bar + pie chart polish** (2026-06-02).
- ✅ **Student Absences — Academy-only at API layer** + grade-card layout (`00558-2kg`, 2026-06-02). HS grades dropped regardless of caller divisions; click card → expanded roster.
- ✅ **Admissions Pass 2 verified live** + ELC/LS card recolor (teal/blue/purple) — 2026-06-02.

---

*Note: "Debra Eis" = Admissions director feedback. "Debra May" = Executive Director feedback. Different people.*
