# RBK Command Center — Master TODO

> ⚠️ THIS IS THE ONLY TODO FILE. Update this after every session. Do not create new TODO or action item files. Archive any other planning docs by adding an ARCHIVED header. Phase build plans are reference-only.

*Last updated: June 10, 2026*

For the longer roadmap + horizon items + architecture history, see `RBKCC_VISION_AND_ROADMAP.md`. For implementation detail, see `CLAUDE_CONTEXT.md` ("Recent Changes" section).

---

## ✅ Shipped this session (June 10, 2026) — DEPLOYED (rev `ssrrbkcmdcenter-00653-2sb`)

> Live as of 2026-06-10 via `./deploy.sh` (revision `ssrrbkcmdcenter-00653-2sb`, site verified UP). Build was clean (`tsc --noEmit` + `npm run build`); a `npm ci` was needed to restore missing `lightningcss` / `@tailwindcss/oxide` native binaries.

- ✅ **Israel Fund — `procurify_number` now saves.** Was missing from `PATCHABLE_FIELDS` in `grants/[id]` PATCH; added.
- ✅ **Israel Fund — manual raised top-up.** New `manual_raised` + `manual_raised_note` columns on `israel_fund_raised_cache`; route shows effective raised = raised + manual everywhere; editor pencil → inline edit panel; info-icon tooltip for all viewers. `raised-cache/[id]` PATCH extended.
- ✅ **Israel Fund — 8 non-Veracross initiatives seeded** with `raised_cache` rows (Project 24 - Alumim, Boots, Golda Ice Cream, Chanukah Gifts, Chayalim and Hostage Families Support, Adi Negev, SAR Account at Local Restaurants, Dog Tags) so they show their disbursed totals and are editable.
- ✅ **Israel Fund — 7 initiative name mismatches reconciled in DB** (Hummus, Israel Mission, Ceramic Vests Israel, Connections Israel - Purim 24, Nova Festival Exhibit, Israel Bar Mitzvah, Ginzberg Projects) so raised + disbursed join on one row.
- ✅ **Guardian Circle donor count** — confirmed the correct count (151, distinct non-org, gift_type 1+2) is already implemented; the live ~758 was a raw COUNT(*) from a stale deploy. **Deploying fixes it** — no code change.
- ✅ **Dev Overview — 7-segment breakdown w/ pledges.** Segment classification reads `roles_raw` (Parent / Grandparent / Parents of Alumni / Program & Future Families / Alumni / Faculty / Other); segment totals now include gift_type=2 outstanding pledges. Parent now ~$1.46M ($1.06M received + $397K pledged) — matches Heidi's ~$1.5M.
- ✅ **Dev Overview — segment cards show Received + Pledged lines**; FY25 YoY % badges removed (gifts_cache missing Jul'24–Mar'25) → "FY25 comparison pending"; New Donors uses server value.
- ✅ **Dev Overview — drill-downs.** New `/api/development/overview/segment-donors` route; clicking a segment card opens a donor drawer (Donor→Veracross link / Received / Pledged / Total, searchable). Lapsed Donors card also opens a drawer (Heidi's request).
- ✅ **`fy_baseline_donors` seeded** (DB-only, `npm run seed:fy-baseline`) — FY25 (1,656 / $10.52M) + FY26 (1,747 / $8.67M) donor rosters from Veracross query 918871 (D+SC). Derived: lapsed 451, new 542, retained 1,205. Amounts include soft credits → use ID lists, not amounts.

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
- [ ] **Clickable event rows** on both pages: expand a money-in row to show individual gifts (constituent name, amount, date, Veracross link) + DonorAnnotations per gift. On Israel Fund this needs to read from `gifts_cache` directly since `israel_fund_raised_cache` is aggregated — the cache gives the per-event row, gifts_cache gives the breakdown.
- [ ] **Cooper Fund Slack channel mention** — `@CooperFundChannel` taggable in the @mention dropdown on Cooper Fund notes (blocker: channel ID from Emily).
- [ ] **Cooper Fund YoY category tracking** — current FY Column H vs prior year snapshot from `cooper_fund_categories`.
- [ ] **Source spreadsheet link** on Cooper Fund + Israel Fund pages (Heidi's suggestion), permission-gated.
- [ ] **Buzz: align `israelFundBalance` with `israel_fund_raised_cache`**. `lib/buzzConversation.ts` still derives the Israel Fund balance from a live `gifts_cache` ILIKE — small cleanup so morning-briefing / Q&A numbers match the page after the 2026-06-08 raised_cache switchover.

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

### Media (Randy's page) *(new)*
- [ ] **Build Media rollup page for Randy** — reads from Monday Communications board filtered to media requests (flyer / graphics / video / screens checked). Shows: pending requests, in-progress, due this week. Rise Vision queue section (once URLs from RBK). Active media projects rollup from Monday Projects. Does NOT rebuild Monday — surfaces what Randy needs today.
- ✅ **Randy added as `workspace_member`** (2026-06-05). `resulto@saracademy.org` (verify with Becca — placeholder email), Slack `U03TBMX4HUK`, role `viewer`, divisions `['academy','hs']`, title "Media Director". **Verify Randy's email address before any user-visible reference.**
- [ ] **Confirm Randy's Monday board column / status mapping** for the media-request filter — meeting needed to confirm workflow before building.

### Projects (rebuild)
- [ ] **Retire internal Projects kanban, rebuild as Monday rollup view.** The Supabase kanban was never fully adopted and predates the Monday-as-system-of-record architecture. Replacement reads from the Monday API on load, shows each user the items relevant to them, grouped by board. No Supabase storage for this view.

### Slack AI Assistant — Buzz 🐝 *(highest leverage)*
- ✅ **Phase 1 + Phase 2 onboarding shipped behind `DRY_RUN = true`** (rev 00602-w8w, 2026-06-05). `lib/morningBriefing.ts` core logic, preview endpoint (admin-only), internal endpoint (shared-secret), Slack events webhook (DM handler with signature verification), onboarding management endpoint, Cloud Function HTTPS trigger (schedule commented), Admin → Morning Briefings tab with Briefings + Onboarding sub-tabs. New `user_briefing_preferences` Supabase table. Randy seeded as `workspace_member`. No Slack sends until Becca approves.
- ✅ **Phase 2 conversational Q&A shipped** (2026-06-02). DM any question to Buzz; replies use a permission-scoped context snapshot (calendar, tasks, module data gated by `allowed_modules`/role) + last 10 turns of `buzz_conversation_history`. Sends to Claude `claude-sonnet-4-20250514` (max_tokens 400). Two special commands: `reset` (clears history) and `briefing` (forces an on-demand briefing for the requesting user via `generateAllBriefings({ singleUserEmail })`). Phase 2 uses a static context bundle — Phase 2.5 will replace this with Claude `tool_use` for on-demand queries.
- ✅ **Phase 2.5 write-back shipped** (`00613-frd`, 2026-06-08). Buzz can mark Monday.com board items and Command Center tasks (`tasks` table) as done from a DM. New `lib/mondayActions.ts` (`markMondayItemDone`, with "Done" → "Completed" label retry); CC tasks go through `supabaseAdmin` directly. `lib/buzzConversation.ts` system prompt instructs Claude to emit `<monday_action>{...}</monday_action>` or `<cc_action>{...}</cc_action>` markers at the end of the reply; `applyWriteBacks` parses, executes, strips, and appends ✅ / ⚠️ confirmation lines. `MondayTask` carries `statusColumnId` (captured by detecting `column.id.includes('status')` / `type === 'color'` / `type === 'status'`); `TaskRow` carries `id`. Failures degrade to the ⚠️ fallback — Monday outages never break the conversation.
- [ ] **Becca: review preview output** at `/admin/permissions` → Morning Briefings → Generate Preview. Confirm each user's briefing reads correctly before enabling live sends.
- [ ] **Configure Slack Event Subscriptions** in `api.slack.com/apps`: Request URL `https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/events`; subscribe to `message.im`; save and reinstall the app. **Until this is done, Buzz can send messages but cannot receive replies — onboarding flow sends the intro but can't capture the response.**
- [ ] **Upload Slack `signingSecret`** to `workspace_integrations.slack.credentials.signingSecret` via Admin → Integrations. Until present, the events webhook degrades to unverified-but-warned mode; once uploaded, signature mismatch → 401.
- [ ] **Review onboarding message copy** in `lib/buzzBot.ts` — `ONBOARDING_MESSAGE` and `ONBOARDING_SAVED_MESSAGE` constants. Confirm tone matches Becca's voice.
- [ ] **Confirm bot name "Buzz" + emoji 🐝** are final, or swap in `lib/buzzBot.ts` (BOT_NAME, BOT_EMOJI). Two constants in one file.
- [ ] **Verify Randy's email** — `resulto@saracademy.org` was used as the placeholder. Confirm with Becca; update the `workspace_members` row + the `email` field in `user_briefing_preferences` rows if different.
- [ ] **Enable scheduled morning sends**: (1) set `DRY_RUN = false` in `lib/morningBriefing.ts`; (2) uncomment `scheduledMorningBriefings` in `functions/src/index.ts`; (3) redeploy Cloud Run and Functions. Schedule is `'30 7 * * 1-5'` (7:30am ET school days).
- [ ] **Collect `slack_user_id` for all active users** — already set for RBK (`U04NBR22Y`), Emily (`U05M5KT86GK`), Randy (`U03TBMX4HUK`). Still need Becca, Debra May, Debra Eis, Heidi, Sara, Leora, Amy, future HS Principal. One-off Slack admin lookup.
- [ ] **Remove the `BUZZ_TEST_MODE` allowlist** — flip the constant in `lib/buzzBot.ts` to `false` once Becca and Emily have approved the rollout. Until then, only those two emails receive briefings even with `DRY_RUN = false`.
- [ ] **Collect Monday board IDs** for Emily Gray and Randy Esulto when ready to expand the Monday-board pulldown beyond Becca's row. Set via SQL or the Admin → Onboarding tab (board-ID column TBD). Becca's board ID `4230192042` is already wired.

#### Horizon — Buzz Phase 3 (deferred, no schedule yet)

- [ ] **Phase 3 — Buzz creation actions** — extend the marker-based write-back pattern from Phase 2.5 to support *creating* Monday items and Google Calendar events from a Slack DM. Two flavors: (a) `@Buzz add a task to ...` → Buzz creates a new item on the user's Monday board (`create_item` mutation, status defaulted to first label, due date parsed from the message); (b) `@Buzz schedule a 30-min meeting with Sara Tuesday at 2pm` → Buzz creates the event on the requester's primary calendar via `getValidGoogleToken` and invites attendees. Same defense pattern as Phase 2.5: Claude emits `<monday_create>` / `<calendar_create>` markers; `applyWriteBacks` parses and executes; ✅ / ⚠️ confirmation appended. Disambiguation prompt for ambiguous board/calendar targets.
- [ ] **Two-way task sync via Monday webhook** — already-shipped Phase 2.5 marks Monday items done from Buzz; the reverse (Monday webhook → Command Center `tasks.status = 'done'`) is still pending. Pairs with the Projects rebuild as a Monday rollup.
- [ ] **Email scanning in morning briefing** — opt-in (per the new onboarding question #2). Surface reminders + flagged items the user explicitly told Buzz to watch for. Requires Gmail API per-user OAuth, already scaffolded.
- [ ] **Buzz `tool_use` upgrade** — replace the static context snapshot with Claude `tool_use` so the model can pull on-demand data: arbitrary date ranges for attendance/gifts, search by donor/student name, calendar lookups beyond the default 5-day window, Monday board queries by status, etc. Today Phase 2 pre-loads a fixed bundle; the upgrade lets Buzz answer "what was last Tuesday's absence count in 6th grade?" without bloating every prompt with historical data. (Phase 2.5 was claimed by the write-back deploy on 2026-06-08; this lands later as its own phase.)

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
- [ ] `slack_user_id` for Becca, Debra May, Debra Eis, Heidi, Sara, Leora, Amy, Randy, future HS Principal — prerequisite for Slack AI Assistant Phase 1 briefings. RBK (`U04NBR22Y`) and Emily (`U05M5KT86GK`) already in hand.

### Randy (Media Director) — meeting needed
- [ ] **Meeting with Randy to confirm Monday workflow** — what columns/statuses identify a media request on the Comms board, how he currently triages, what he most needs surfaced. Blocks the Media page build.

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

## ✅ Completed Today (June 9, 2026)

- ✅ **Development Overview corrected** (`00650-qz5`, 2026-06-09). `/api/development/overview` rewritten: scoped to `fundraising_activity ILIKE 'Operating %'`, `gift_type IN (1, 2)` (drops soft credits 3 + 5), FY assignment by exact campaign string (not gift date), Total Raised = `type-1 amount + type-2 pledge_balance` (Veracross "Donation & Pledge Balance"). Segments + lapsed scoped to type-1 only. New donor count added as a real server-computed field (`newDonorsFY26`). Live verification: $6,297,616.75 raised, 1,738 unique FY26 donors (was $17.8M / 2,159 before). Overview tab still gated by the testing-features flag — not promoted.
- ✅ **Contextual "Send via Slack" modal — Tasks + Agenda** (`00648-vz2`, 2026-06-09). New `app/components/shared/SlackSendModal.tsx` + new `POST /api/slack/send-message`. Per-task-card Slack icon (hover-reveal next to the urgent toggle) and a "Send to Slack" button in the Meeting Agenda header build the context payload client-side; modal fetches workspace members via `/api/workspace/mentionable-users`, recipient picks a Slack user, message sends as `"{context}\n\n{message}"`. Out of scope still: grants, emails, projects, donor notes.
- ✅ **Four Slack notification triggers** (`00646-wkt`, 2026-06-09):
  - `lib/slackNotifications.ts` extended: new `sendSlackDM(slackUserId, message, botToken)` + `getSlackUserIdByEmail(email, wsId, supabase)`. `sendTaskSlack` gained an `actorEmail` param for self-skip + a `notes` field on the task shape.
  - Task assignment: `/api/tasks` POST + PATCH pass `session.user.email` → no more self-DMs when you assign a task to yourself; description forwarded as truncated `notes`.
  - Grant wire-sent: `/api/development/israel-fund/grants/[id]` PATCH detects `wire_was_sent` false→true and DMs RBK + Emily with initiative / recipient / amount / Procurify #.
  - Major gift ≥ $1,000: `lib/syncGifts.ts` snapshots existing gift IDs pre-upsert, identifies newly inserted gifts after, filters to amount ≥ $1k AND not External Funds, batches into a single DM to Sara Hasson (`U04NB3YP3`) per sync.
  - Daily absence alert: new scheduled Cloud Function `dailyAbsenceAlert` (`30 9 * * 1-5 America/New_York`, ENABLED) → new `/api/absences/threshold-alert-internal` route → identifies students whose YTD absence count equals exactly 5 or 10 today and DMs RBK. Silent on no-crossing days.

## ✅ Completed Yesterday (June 8, 2026)

- ✅ **Student Logs page + YTD attendance rate fix** (`00636-bws`, 2026-06-08). Student Logs (Axiom #1473847) reordered to sit under Student Absences in the sidebar, role-gated to owner/assistant only, with an iframe attempt at the new `/sar/reports/1473847` URL and an honest "if it doesn't load, use the button" caption. YTD attendance-rate denominator in `/api/absences?view=ytd` rewritten to count distinct dates from `attendance_cache` (no category/grade filter) starting from `2025-09-03` — fixes RBK's flag that students were misclassified into worse tiers because days with no absent/tardy events were silently dropped from the denominator.
- ✅ **Attendance sync hardening** (`00634-ksh`, 2026-06-08). `deploy.sh` `SYNC_SECRET=rbk-sync-2026` (was the long internal hex, which 401-ed every nightly cron). `app/api/absences/sync/route.ts` now stamps `workspace_id` on every upsert (closes the ~3-month NULL-workspace_id gap). `attendance_cache` backfilled via `scripts/backfill-attendance.ts` (paginated, sets workspace_id) — 138,216 SAR rows across 2025-09-03 → 2026-06-05.
- ✅ **Three RBK-requested features** (`00629-nk8`, 2026-06-08):
  - **Slack "ping Emily" button on Today's Schedule cards**. New `POST /api/slack/notify-emily` route (owner/assistant gate). `Dashboard.tsx` per-event Slack icon, optimistic checkmark + bottom-right toast.
  - **Attendance previous/next day nav**. New `GET /api/absences/historical?date=YYYY-MM-DD` reads from `attendance_cache`. `Dashboard.tsx` Student Absences page gained ← / → arrows + "Historical" label, weekends skipped automatically.
  - **Israel Fund donor drill-down**. New `GET /api/development/israel-fund/donors?initiative=NAME` returns up to 100 most-recent gifts. `IsraelFundTab.tsx` expanded-row block now ends with a "Donors" subsection (lazy-loaded, session-cached, anonymity-respecting).
- ✅ **Israel Fund — `is_excluded` column + per-initiative hide/restore toggle** (`00627-cws`, 2026-06-08). Migration adds `is_excluded boolean NOT NULL DEFAULT false` to `israel_fund_raised_cache`; pre-marks the 5 non-Israel events that kept polluting the cache (Cong. Sons of Israel - Purim 25/26, Faculty Mishloach Manot - Purim 25/26, KCI Food Pantry). Public route filters `is_excluded = false`; new editor-only `GET /raised-cache` + `PATCH /raised-cache/[id]` endpoints back the UI eye-icon toggle and "Show hidden" view. Sync writes `is_excluded: false` on insert only; never touches existing rows.
- ✅ **Israel Fund — grant form simplified** (`00621-dvc`, 2026-06-08). `IsraelFundTab.tsx` add/edit panel + expanded sub-table no longer show `confirmed_payment`, `wire_status`, `date_wire_sent`, or `grant_not_given`. New "Procurify #" text field (`procurify_number` column, already in DB) placed next to "Submitted to Procurify". DB schema unchanged — aggregation/sort logic still reads the hidden fields; only the form payload + visible columns shrank. Column counts: shared 6→5, editor extras 10→8.
- ✅ **Israel Fund — money-in source switched to `israel_fund_raised_cache`** (`00619-zsl`, 2026-06-08). New Supabase table seeded with 43 rows / $1,841,649.79 from Veracross query 1077990 (historical data Veracross's API can no longer return). `seed_raised` / `raised` pattern guarantees the baseline survives even when Veracross rolls older gifts off its API window. New `lib/israelFundNormalization.ts` consolidates all event-name rules in one place; new `lib/syncIsraelFundRaised.ts` (`syncIsraelFundRaisedCache`) runs at the end of `syncGiftsForWorkspace` so the hourly/daily gifts Cloud Functions keep the cache fresh. `app/api/development/israel-fund/route.ts` rewritten — `fetchIsraelGrantsPaidOut` Google Sheets helper, `fetchMoneyIn` paginated reader, `stripPrefixes`, `parseSheetAmount`, and the `grantsKeySet` whitelist are all gone. Response shape unchanged so `IsraelFundTab.tsx` keeps rendering.
- ✅ **Buzz Phase 2.5 — Monday + CC task write-back** (`00613-frd`, 2026-06-08). New `lib/mondayActions.ts` (`markMondayItemDone`). `lib/morningBriefing.ts` `fetchMondayTasks` now captures `statusColumnId` via the column-type heuristic. `lib/buzzConversation.ts` system prompt teaches Claude to emit `<monday_action>` / `<cc_action>` markers; `applyWriteBacks` parses, executes, strips, and appends ✅ / ⚠️ confirmations. Never throws — Monday/Supabase failures degrade to the ⚠️ line. No changes to morning briefing schedule, onboarding flow, or any non-Buzz file.
- ✅ **Slack events dedup** (`00615-drh`, 2026-06-08). `/api/slack/events` POST handler now drops duplicate Slack redeliveries by `event_id` (module-level bounded `Set<string>`, FIFO trim at 100 entries).
- ✅ **Buzz weekly gifts query relaxed** (`00617-vcp`, 2026-06-08). `lib/morningBriefing.ts` `fetchModuleData` no longer filters by `fundraising_activity` or `gift_type` — last-7-days only, matching the Weekly Gifts page default.

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
