# RBK Command Center — Session Handoff
**Date:** July 14, 2026
**Latest Revision:** Cloud Run revision # **unread since June 18** (gcloud reauth pending — see Known Issues). Last *numbered* revision on record: `ssrrbkcmdcenter-00690-5b6`. Latest **firebase hosting release: 2026-07-14e**.
**Live URL:** https://rbk-cmd-center.web.app
**Backend:** https://ssrrbkcmdcenter-429508710310.us-east1.run.app
**Local Project:** `~/Projects/DevProjects/RBK_Command_Center` (Mac Mini, `ai@ais-Mac-mini`)
**GitHub:** `rglassberg-cmyk/rbk-command-center`, branch: `backup/wip-2026-06-12`
**gcloud Auth:** `rglassberg@saracademy.org` (⚠️ token expired — needs `gcloud auth login`)
**Deploy:** `./deploy.sh` → always followed by `git add -A && git commit -m "..." && git push origin backup/wip-2026-06-12`
**Source of truth:** `CLAUDE.md`
**TODO file:** `RBKCC_MASTER_TODO 6:5:26.md` (spaces and colons in filename)

---

## What This Is

Next.js SaaS operations dashboard for SAR Academy (K-8 Jewish day school). Primary users: Rabbi Krauss (RBK / "Bini"), Head of School, and Emily Gray, his EA. Built and maintained by Becca Glassberg, Director of Technology. Deployed on Firebase Hosting + Cloud Run. Database: Supabase with RLS. Multi-tenant SaaS architecture under Lhasa LLC — SAR is tenant #1.

**Supabase project ID:** `ftjppqvxthxcvhokrhfw`
**SAR Workspace ID:** `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
**SYNC_SECRET:** `rbk-sync-2026`
**INTERNAL_SYNC_SECRET:** `0395162bea09e40d074331d0d7da73adb5abc94e04f08a46442b761f9c964dc3`

---

## Key People

Slack IDs are now populated on `workspace_members` for **every active member** (only outgoing Heidi Greenbaum lacks one). This is what unblocked @Notify group DMs.

| Person | Role | Email | Slack ID |
|---|---|---|---|
| RBK / Rabbi Krauss / Bini | Head of School (primary user) | kraussb@saracademy.org | U04NBR22Y |
| Emily Gray | Development Assistant / EA | egray@saracademy.org | U05M5KT86GK |
| Becca Glassberg | Director of Technology (you) | rglassberg@saracademy.org | U04PVHXSD |
| Debra May | Executive Director | debra@saracademy.org | U04RZ9K59 |
| Sara Hasson | Director of Development | sara.hasson@saracademy.org | U04NB3YP3 |
| Heidi Greenbaum | Outgoing Director of Development | hgreenbaum@saracademy.org | — (none) |
| Leora Miller | Development Associate, Cooper Fund | leora.miller@saracademy.org | U05M4L1RY6Q |
| Pearl Magence | Finance | pmagence@saracademy.org | U04MU2Y77 |
| Debra Eis | Director of Admissions / Registrar | deis@saracademy.org | U04M568P8 |
| Emily Daniel | Director of Admissions | edaniel@saracademy.org | U03P3KDMRLM |
| Amy Hyman | HR | ahyman@saracademy.org | U1T0RFJR1 |
| Kayla Moerdler | Staff | kmoerdler@saracademy.org | U07A80X373N |
| Melissa Rothwax | Staff | mrothwax@saracademy.org | UMUAC9W6S |
| Sarah Jabbour | Staff | sjabbour@saracademy.org | U07ANHC8Y6R |
| Shira Kroll | After School / ELC Director | skroll@saracademy.org | UCDJXC7SN |
| Yael Baker | Communications | ybaker@saracademy.org | U01G07UH18T |
| Randy Esulto | Media Director | resulto@saracademy.org | U03TBMX4HUK |

**Assignee keys** (used by Tasks columns / `[@RBK]` tags / notify task assignment): RBK, Emily, Sara, Leora, Becca. All other members have `assignee_key = null` and are matched by `display_name` instead.

---

## Tech Stack

- **Frontend:** Next.js 16 + React 19 + Tailwind CSS v4 + Tiptap
- **Database:** Supabase (RLS enabled, service role for syncs)
- **Hosting:** Firebase Hosting + Cloud Run (`us-east1`, service `ssrrbkcmdcenter`)
- **Cloud Functions:** Firebase Functions (`us-central1`)
- **Integrations:** Veracross (SIS + programs API), Lever (recruiting), Slack (Buzz AI + @Notify), Monday.com, Anthropic (Buzz), Google Calendar/Gmail (per-user OAuth), GCS (`rbk-cmd-center-sftp` bucket)
- **CRITICAL deploy flags:** Always `--no-cpu-throttling --memory=512Mi` on Cloud Run. `firebase.json` must have `frameworksBackend.memory: "512MiB"`. Without these, Buzz AI (and any fire-and-forget background work like @Notify Slack calls) fails silently.

---

## What Was Built / Fixed Since June 18, 2026

### Cross-module @Notify (July 14) — NEW FEATURE

Lets any workspace member tag one or more teammates, fire a Slack **group DM** to them, and drop a task on each tagged member's task list — with a resolve loop back into the Slack thread. How it works end to end:

1. **NotifyButton** (`app/components/shared/NotifyButton.tsx`) — an understated `@` icon button + popover. Rendered once at the top-right of every module's content area (context set by `activeNav` via a `NOTIFY_CONTEXT_LABELS` map in `Dashboard.tsx`), and again inside each of the 7 Admissions drilldown "Notes & Tags" panels (context `"Admissions: <name>"`). The popover has an editable message textarea (pre-fillable), a searchable multi-select person picker (avatar initial + name + role badge, selected people become removable chips), and a Notify send button (disabled until ≥1 person + non-empty message).
2. **Admissions note pre-fill** — the candidate NotifyButton pre-fills its message with whatever the user has typed in the note field. Implemented ref-based (no re-render churn): `DonorAnnotations`/`NotesList` expose an optional `onDraftChange` → written to `admissionsNoteDraftRef` in Dashboard; `NotifyButton` reads `getMessage()` on open. Saving the note and notifying stay two separate actions.
3. **`POST /api/notify`** — loads all workspace members; resolves the sender (session email), the tagged members (by id), and each tagged member's **assistant** (members whose `assistant_to` = a tagged id). Builds the group-DM participant list = sender + tagged + assistants, deduped by `slack_user_id`, dropping anyone with no Slack id. Opens the group DM via `conversations.open` with a **comma-separated string** of user IDs → `channel.id` → `chat.postMessage` with a Block Kit message. Stores `slack_thread_ts` + `slack_channel_id`. Then inserts one `tasks` row per tagged member (`source='notify'`, `source_ref=context`, `assigned_to = assignee_key ?? display_name ?? email`, `title = "<Sender> needs your input"`). Slack is best-effort — a Slack failure never blocks task creation (needs ≥2 Slack participants for an MPIM).
4. **Slack message** — Block Kit section (headline + message) + an `actions` block with two buttons: **Open in Command Center** (url button → `/?nav=tasks`) and **✓ Mark Resolved** (interactive, `action_id: notify_mark_resolved`) + a context footer.
5. **In-app surface** — a **"Needs Your Reply"** group in the Tasks column (`source='notify'`, matched to the current user by `assignee_key` OR `display_name`). The **Tasks page is now visible to all users** — viewers (whose full Daily sidebar section is hidden) get a standalone Tasks nav block, and the Add-User form defaults `tasks: true` in `allowed_modules`.
6. **Resolve loop** — marking a notify task done posts `✓ <name> marked this resolved` into the Slack thread. Two entry points: (a) `PATCH /api/tasks` (Command Center), (b) the Slack **Mark Resolved** button → **`POST /api/slack/interactions`** (new route). The interactions route resolves the clicking Slack user → member, finds *their* open notify task on that thread (`slack_thread_ts` = the button message's ts — precise even though Slack reuses one MPIM channel id across repeat DMs), marks it done, and posts the reply. Each member resolves only their own task. Always acks Slack `200` so it won't retry.
7. **Slack signature verification (STEP 2D)** — `verifySlackSignature` on the interactions route: HMAC-SHA256 `v0=` over `v0:{x-slack-request-timestamp}:{rawBody}` using `process.env.SLACK_SIGNING_SECRET`, length-guarded `timingSafeEqual` + 5-minute replay guard. **Non-fatal when the secret is unset** (returns true / logs a warning); once `SLACK_SIGNING_SECRET` is set on Cloud Run, a bad/stale signature is rejected 401.

**Migration** (`scripts/migrations/tasks-slack-thread.sql`, applied live): added `tasks.slack_thread_ts` + `tasks.slack_channel_id`; **dropped `tasks_assigned_to_check`** (was hard-limited to the 5 assignee keys — @Notify must assign to any member by display_name). `assigned_to` stays NOT NULL.

**New/changed files:** `app/components/shared/NotifyButton.tsx`, `app/api/notify/route.ts`, `app/api/slack/interactions/route.ts`, `lib/slackNotifications.ts` (`openGroupDm` + `postSlackMessage` helpers + `[NOTIFY SLACK ERROR]` logging), `app/components/Dashboard.tsx`, `app/components/Sidebar.tsx`, `app/components/development/DonorAnnotations.tsx`, `app/admin/permissions/page.tsx`, `app/api/workspace/mentionable-users/route.ts` (now returns `role`), `middleware.ts` (excludes `api/slack/interactions`).

**Manual steps still needed (see Known Issues):** set the Slack Interactivity Request URL, and optionally add `SLACK_SIGNING_SECRET` to Cloud Run.

### Board Member Overrides — joint-record trustees (June 19)

Some SAR trustees give via a **joint household record** that carries no "Trustee" in its own `roles_raw`, so the segment classifier put them in Parent / Parents of Alumni / Alumni instead of Board Members.

- **Table `board_member_overrides`** (`workspace_id`, `constituent_id`, `constituent_name`, `added_by`, `added_at`, `UNIQUE(workspace_id, constituent_id)`). DDL saved to `scripts/migrations/board-member-overrides.sql` (table created + seeded externally).
- **6 seeded SAR rows** — constituent_ids **4262, 5271, 5750, 7775, 8878, 9688** — verified to have FY26 Operating gifts and NO "Trustee" in their own `roles_raw`.
- Read by `overview/route.ts` + `segment-donors/route.ts`: `segmentOf(cid)` returns `'Board Members'` if the cid is in the override set, else falls through to the existing Trustee-`roles_raw` `classifySegment`. The Trustee check still handles the majority; overrides are additive. Board Members card gained a ❓ tooltip.

### Development Overview — segment / soft-credit accuracy (June 25–28)

Multiple rounds tightening the "Giving by Segment · FY26" cards + drilldowns. Net rules now in force:
- **Soft-credit twin dedup:** a `gift_type=3` soft credit is an excluded Veracross twin **only** when its `hard_credit_gift_id` matches the record `id` of one of that constituent's own type-1 gifts; otherwise it's a separate-source gift (their DAF/foundation gave directly) and IS counted. `received = SUM(type-1 amount) + SUM(non-twin soft-credit amount)`. (Verified live: Luxenberg 17707 → $101,360, Tsigutkin 9458 → $55,000; 131 donors gained +$827,885 workspace-wide.)
- **"Other" segment** excludes foundations/DAFs already represented via a soft credit to a named-segment individual (record each FY26 type-1/2 gift's `id`→owner; exclude an Other cid whose gift has a FY26 type-3 soft credit pointing back from a DIFFERENT constituent). Superseded the earlier grants-only (`OP: Grants`) filter.
- **FY27-pledge leak defense:** overview gifts query hardened to `.in([FY25_CAMPAIGN, FY26_CAMPAIGN])` so `Operating 2026-2027` rows are never fetched (output byte-identical; segment-donors was already exact).
- **Board Members drilldown** shows a per-trustee `secondaryRole` pill + a summary bar (one pill per secondary segment with total giving + trustee count).

### giving_history_cache — manual "Sync Gift History" button (June 25)

The nightly auto-ingest (`ingestGivingHistory` Cloud Function, 8am ET) was **deleted** (from source + GCP via `functions:delete`). The GCS ingest route + parser are unchanged but now triggered **only by the admin** (rglassberg@) from the Development Overview via a bordered **"↓ Sync Gift History"** button (spinner → persistent `✓ Synced {N} records from {file} · file dated {modified}` / `✗ {message}`). The ingest route returns `file_modified` (CSV's GCS `metadata.updated`). FY25 baseline (for lapsed/new/retained) reads `giving_history_cache`, gifts_cache fallback.

### Admissions applicant Veracross links (June 23)

The 11 Veracross deep-links in the Admissions module now route **applicants** (not-yet-enrolled) to `…/detail/admission-candidate/{id}/3052-general` and **enrolled / re-enrolling** students to `…/detail/student-ls/{id}/273-general`, via a new `veracrossAdmissionUrl(personId, isEnrolled)` helper in `Dashboard.tsx`. Default is admission-candidate for anyone not confirmed enrolled. `AfterSchoolTab.tsx` + all non-Admissions Veracross links untouched.

### This Week at SAR — iframe host moved (July 14)

`ThisWeekCard.tsx` `IFRAME_URL`: `thisweek-sar.netlify.app` → `this-week-at-sar.vercel.app`. Required a rebuild + deploy (client-component constant is bundled at build time).

---

## Current Module Status

| Module | Status | Notes |
|---|---|---|
| Home / Today | ✅ Live | |
| Email Inbox | ✅ Live | |
| Meeting Agenda | ✅ Live | |
| Tasks | ✅ Live | Now visible to ALL users (viewers included); "Needs Your Reply" @Notify group |
| Student Absences | ✅ Live | Academy-only at API layer |
| Student Logs | ✅ Live | |
| After School Programs | ✅ Live | |
| Admissions | ✅ Live | Applicant vs student Veracross links fixed |
| Simchas & Shivas | ✅ Live | |
| Development — Weekly Gifts | ✅ Live | |
| Development — Guardian Circle | ✅ Live | |
| Development — Cooper Fund | ✅ Live | ~$38K accuracy gap still open (see Known Issues) |
| Development — Israel Fund | ✅ Live | Total Raised de-inflated to gift_type=1 |
| Development — Overview | ✅ Live | Segment/soft-credit/board-override fixes; FY27 leak hardened |
| Development — Capital Campaign | ⚠️ Empty | Fund = "Big Bold Future"; Sara sending queries — UNBLOCKED, not yet wired |
| Recruiting | ✅ Live | |
| Communications | ⚠️ Partial | Monday.com status-string mismatch |
| Buzz AI (Slack) | ✅ Live (test mode) | 7:30am schedule still commented out |
| Projects | ✅ Live | |
| **@Notify (cross-module)** | ✅ **Live** | Slack group DM + tasks + resolve loop; interactive button pending manual Slack setup |

---

## Known Issues / Pending

### ⚠️ gcloud auth reauth (recurring blocker)
`./deploy.sh`'s **firebase step ships fine** every time (SSR function updated, hosting released), but the **gcloud-only tail steps abort** on `Reauthentication failed. cannot prompt during non-interactive execution`. Consequences: (a) the exact Cloud Run revision number has been **unreadable since June 18**; (b) **Cloud Run logs can't be read** (so the @Notify Slack diagnostic output is waiting to be read). **Fix:** run `gcloud auth login` as `rglassberg@saracademy.org` once, interactively, in the terminal. The skipped gcloud steps (manual hosting finalize, allUsers IAM restore, forced revision update + env re-apply) have been redundant on recent runs — firebase finalizes its own release — but reauth is needed to restore full visibility.

### ⚠️ @Notify — manual Slack setup outstanding
1. **Interactivity Request URL** — api.slack.com/apps → Command Center app → **Interactivity & Shortcuts → turn ON → Request URL `https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/interactions` → Save.** Until set, the "✓ Mark Resolved" button posts nothing (the "Open in Command Center" url button still works).
2. **`SLACK_SIGNING_SECRET`** not yet on Cloud Run → the interactions endpoint currently runs **unverified** (non-fatal by design). Add it to enable signature verification.
3. **Group DM may still fail** if the stored Slack bot token predates the `mpim:write` scope reinstall. `[NOTIFY SLACK ERROR]` logging is deployed to reveal `missing_scope`/`needed: mpim:write` — read Cloud Run logs after a test @Notify (needs gcloud reauth). If so, reconnect Slack in Admin → Integrations to pick up the new token/scope.

### Capital Campaign tab not yet wired
Empty until built. Fund = `Big Bold Future`. Sara is sending the Veracross queries (designated vs undesignated buckets, YoY, by constituent) — **UNBLOCKED**, just not implemented.

### FY2025 numbers Heidi flagged
The June 25–28 Development Overview work (soft-credit twin dedup, "Other" foundation/DAF exclusion, board overrides, FY27-pledge leak defense) all came out of Heidi's QA of FY25/FY26 segment totals. The remaining open data-accuracy item is the **Cooper Fund ~$38K gap** (Leora's ground truth $350,294 vs page $388,804 — root cause TBD) plus the Cooper event-bucket relabels (Schreck/Yahrzeit/General → Cooper 25-26, drop Sayeret Matkal). See the 🔴 Immediate list in the master TODO.

### Other pending (from master TODO)
- Cooper/Israel Fund: "Today" filter pill, clickable event rows, source-spreadsheet link.
- Year-over-year data across all Development metrics (Sara has 5+ years).
- Guardian Circle mobile column overflow; Veracross `person_id` link migration (needs `constituents_cache` sync of person_id).
- Veracross ticket: `/v3/development/gifts` historical gap (~$703K Israel history + 3 GC gifts inaccessible; ticket 2026-06-03).
- Lever webhook activation (manual step in Lever). Recruiting HS toggle for Debra May.
- HS principal onboarding row in `workspace_members` (Becca to gather email/name/title).
- App-name decision (Becca + Debra dislike "Command Center"; "Beacon" suggested — ask RBK).

---

## SFTP Infrastructure (Veracross giving-history pipeline)

Delivers the nightly Operating gift-history CSV that powers `giving_history_cache` (the FY25 baseline for lapsed/new/retained). **Now fully automated end to end — the Veracross-side fingerprint trust is resolved.**

- **VM:** `veracross-sftp`, e2-micro, **`us-east1-c`**, static IP **35.196.57.61**
- **GCS bucket:** `gs://rbk-cmd-center-sftp/` (giving-history under `veracross/giving-history/`)
- **Service account:** `veracross-sftp-writer@rbk-cmd-center.iam.gserviceaccount.com` (objectAdmin); Cloud Run compute SA has `roles/storage.objectViewer` on the bucket (needed for `file.download()`)
- **gcsfuse mount:** `--uid=1001 --gid=1004 --file-mode=664 --dir-mode=775 **-o allow_other**`
- **`/etc/fuse.conf`:** `user_allow_other` enabled (required for non-root FUSE access)
- **SFTP chroot:** `/data/sftp`, `sftpusers` group, `ForceCommand internal-sftp`
- **Startup service:** `/etc/systemd/system/gcsfuse-sftp.service` **enabled** (survives reboot)
- **Credentials:** username `veracross`, password `mOb0iG0sKzjIHW5el6W5hPNjc7rpw`
- **Veracross Data Package:** query 1494094, CSV, 3am daily → `/upload/veracross/giving-history/`. Query filter: Gift Date after 07/01/2023 (avoids "query threshold exceeded").
- **✅ RESOLVED:** Veracross (Bart, case 01309503) has **trusted the SFTP host fingerprint** `SHA256:1Lc6Wq39saYxpnDHLkkaaPJHHTNE9stmaSV7cVCo7Wc` for `35.196.57.61`. The nightly push now lands in GCS automatically; the admin "Sync Gift History" button ingests the newest CSV into `giving_history_cache` on demand.

---

## Critical Technical Facts

### Soft Credits (Must Always Follow)
- A `gift_type=3` soft credit is an excluded **Veracross twin** ONLY when its `hard_credit_gift_id` = the record `id` of one of the constituent's own type-1 gifts. Otherwise it came from a separate source (their DAF/foundation) and IS counted.
- Veracross writes TWO soft-credit rows per gift (`soft_credit_type=1` + `=2`) sharing the same `hard_credit_gift_id` — dedup by that id, not amount.
- Soft pool is `gift_type=3` (sc 1/2). `gift_type=5` is a separate representation of the same pledge — never add it (double-counts).
- Applies to segment totals, lapsed/new/retained, drilldowns, Israel Fund.

### Veracross API Quirks
- Programs API paginates by headers (`X-Page-Size`/`X-Page-Number`, default 2/page), no `X-Total-Count`; `school_year` = FALL year (2026 = AY 26-27).
- Programs client CANNOT read students — use the **admissions** client for `/v3/students/{id}`.
- `/v3/development/gifts` returns only ~April 2025+ — use `giving_history_cache` for FY25 baseline.
- Attendance: caps at 1000/page, always paginate.
- Grade numbers: 40=Infant/Toddler, 35=2YN, 30=3YN, 25=Pre-K, 20=K, 1-8=1st-8th, 9-12=HS.

### gift_type Codes
1=Donation, 2=Pledge (use `pledge_balance`), 3=Soft Credit Donation, 4=Pledge Installment, 5=Soft Credit Pledge.

### Cloud Run Deploy
- Always `--no-cpu-throttling --memory=512Mi`; `firebase.json` `frameworksBackend.memory: "512MiB"`.
- Logs: `gcloud run services logs read ssrrbkcmdcenter --region=us-east1 --project=rbk-cmd-center` (needs gcloud reauth).

### Tasks / @Notify
- `tasks.assigned_to` no longer has a CHECK constraint (dropped for @Notify) — any `assignee_key` or `display_name` is valid; still NOT NULL.
- Notify tasks: `source='notify'`, `source_ref=context`, `slack_thread_ts`+`slack_channel_id` set. Matched to a user by `assignee_key` OR `display_name`.
- Slack group DM = `conversations.open` (comma-separated user IDs) → `channel.id` → `chat.postMessage`. Needs ≥2 participants with Slack IDs.

---

## Infrastructure Reference

### @Notify / Slack interactions
- Notify: `POST /api/notify` (auth-gated). Interactive button: `POST /api/slack/interactions` (Slack-signed, middleware-excluded).
- Slack app manual config: Interactivity Request URL → `https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/interactions`.

### Buzz Trigger
```bash
curl -X POST https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/morning-briefing-internal \
  -H "X-Internal-Secret: 0395162bea09e40d074331d0d7da73adb5abc94e04f08a46442b761f9c964dc3" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
```

### Monday.com
- RBK's to-do board: `4230192042`
- Communications board: `4035548140`

---

## Two-Environment Workflow

- **This chat (planning env):** Planning, architecture, SQL, prompt-writing, DB changes via Supabase MCP.
- **Claude Code CLI (implementation env):** Implementation. Always reads `CLAUDE.md` first.
- **Global CLI flag:** `--dangerously-skip-permissions` set via `claude config set --global dangerouslySkipPermissions true`
- **Every CLI prompt starts with:** `IMPORTANT: Do not ask for confirmation at any point. If you encounter an ambiguity or can't complete a specific step, note the problem clearly, skip that step, and continue with everything else. Never stop and ask for confirmation — make your best judgment call and document what you did and why.`
- **Every CLI prompt ends with:** `Run npx tsc --noEmit, fix errors, npm run build, deploy when clean. After deploying: git add -A && git commit -m "..." && git push origin backup/wip-2026-06-12. Update CLAUDE.md with revision number and what shipped. Update RBKCC_MASTER_TODO_6_5_26.md accordingly.`

---

## Key Files

- `CLAUDE.md` — Source of truth for CLI
- `RBKCC_MASTER_TODO 6:5:26.md` — Master todo (spaces + colons in filename)
- `RBKCC_VISION_AND_ROADMAP.md` — Strategic roadmap
- `RBKCC_HANDOFF_2026-06-18.md` — Previous session handoff
- `app/components/shared/NotifyButton.tsx` — @Notify button + popover
- `app/api/notify/route.ts` — @Notify: group DM + task creation
- `app/api/slack/interactions/route.ts` — Slack interactive-button handler (Mark Resolved) + signature verification
- `lib/slackNotifications.ts` — Slack helpers (`sendSlackDM`, `sendTaskSlack`, `openGroupDm`, `postSlackMessage`)
- `scripts/migrations/tasks-slack-thread.sql` — tasks slack_thread_ts/channel_id + dropped assignee CHECK
- `scripts/migrations/board-member-overrides.sql` — board_member_overrides DDL
- `app/api/development/overview/route.ts` — Segment classification + lapsed/new/retained + board overrides
- `app/api/development/overview/segment-donors/route.ts` — Segment drilldown
- `app/api/development/giving-history/ingest/route.ts` — GCS CSV ingestion (admin-triggered)
- `lib/parseGivingHistoryCSV.ts` — CSV parser for Veracross gift history
- `lib/israelFundNormalization.ts` — Israel Fund event name normalization
- `app/components/development/OverviewTab.tsx` — Development Overview UI
- `app/admin/permissions/page.tsx` — Admin permissions (By User / By Module)
- `app/components/Dashboard.tsx` — Main UI (~9,100 lines; all module views)
- `app/components/Sidebar.tsx` — Sidebar nav (Tasks now shown to all users)
