# RBK Command Center — Session Handoff
**Date:** July 17, 2026
**Latest Revision:** Cloud Run revision # **unread since June 18** (gcloud reauth pending — see Known Issues). Last *numbered* revision on record: `ssrrbkcmdcenter-00690-5b6`. Latest **firebase hosting release: 2026-07-16**.
**Live URL:** https://rbk-cmd-center.web.app
**Backend:** https://ssrrbkcmdcenter-429508710310.us-east1.run.app
**Local Project:** `~/Desktop/DevProjects/RBK_Command_Center` (Mac Mini, `ai@ais-Mac-mini`)
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

### FY25 Campaign Giving by Fund → giving_history_cache + fund column (July 16) — NEW

The Veracross Operating Gift History Export CSV now includes a **Fund** column, and `giving_history_cache` gained a `fund text` column. The FY25 "Campaign Giving by Fund" column on the Development Overview now reads from `giving_history_cache` (complete FY25 history) instead of `gifts_cache` (which is missing pre-April-2025 gifts and understated the FY25 per-fund totals).

- **`lib/parseGivingHistoryCSV.ts`** — `GivingHistoryRow.fund` read from **column 12** (0-indexed `cols[11]`), default `''`. Fund's position was an **assumption** (appended last, after Constituent ID) because the build env can't read the GCS object (local `rglassberg@` ADC has bucket-list but not `storage.objects.get`); **post-sync verification confirmed it correct** — the `fund` column populated with real `OP: …` names (Guardian Circle, Anniversary Dinner, Grants, Shavuot Appeal, Sponsorships, …), not shifted/garbage data.
- **Ingest route** — added `fund: r.fund` to the upsert payload.
- **Overview route** — new **paginated** `giving_history_cache` query (`fundraising_activity='Operating 2024-2025'`, `gift_type IN (1,2)`, ~3.2k rows — over the 1000 cap, so paginated) builds `fundFY25History`; campaigns array uses `fundFY25Final = fundFY25History.size > 0 ? fundFY25History : fundFY25` (gifts_cache fallback). Soft credits excluded. **Deviation:** `giving_history_cache` has no `pledge_balance` (the CSV carries only `amount`), so FY25 type-2 pledges contribute face-value `amount` — FY26 (which reconciles with the headline) is untouched, still gifts_cache.
- **Re-sync ran:** `POST /api/development/giving-history/ingest` → **23,147 parsed / 22,137 upserted / 1,010 skipped** (`Operating_Gift_History.csv`, 2026-07-16). FY25 per-fund now complete (Guardian Circle FY25 $4.2M).

### Cross-module @Notify (July 14) — NEW FEATURE, interactive resolve LIVE

Lets any workspace member tag one or more teammates, fire a Slack **group DM** to them, and drop a task on each tagged member's task list — with a resolve loop back into the Slack thread. How it works end to end:

1. **NotifyButton** (`app/components/shared/NotifyButton.tsx`) — an understated `@` icon button + popover. Rendered once at the top-right of every module's content area (context set by `activeNav` via a `NOTIFY_CONTEXT_LABELS` map in `Dashboard.tsx`), and again inside each of the 7 Admissions drilldown "Notes & Tags" panels (context `"Admissions: <name>"`). Popover: editable message textarea (pre-fillable), searchable multi-select person picker (avatar initial + name + role badge, selected people become removable chips), Notify send button (disabled until ≥1 person + non-empty message).
2. **Admissions note pre-fill** — the candidate NotifyButton pre-fills its message with whatever the user typed in the note field (ref-based: `DonorAnnotations`/`NotesList` expose `onDraftChange` → `admissionsNoteDraftRef` in Dashboard; `NotifyButton` reads `getMessage()` on open). Saving the note and notifying stay two separate actions.
3. **`POST /api/notify`** — resolves the sender (session email), the tagged members (by id), and each tagged member's **assistant** (members whose `assistant_to` = a tagged id). Participant list = sender + tagged + assistants, deduped by `slack_user_id`, dropping anyone with no Slack id. Opens the group DM via `conversations.open` with a **comma-separated string** of user IDs → `channel.id` → `chat.postMessage` (Block Kit). Stores `slack_thread_ts` + `slack_channel_id`. Inserts one `tasks` row per tagged member (`source='notify'`, `source_ref=context`, `assigned_to = assignee_key ?? display_name ?? email`, `title = "<Sender> needs your input"`). Slack is best-effort — a failure never blocks task creation (needs ≥2 Slack participants for an MPIM).
4. **Slack message** — Block Kit section (headline + message) + an `actions` block with two buttons: **Open in Command Center** (url button → `/?nav=tasks`) and **✓ Mark Resolved** (interactive, `action_id: notify_mark_resolved`) + a context footer.
5. **In-app surface** — a **"Needs Your Reply"** group in the Tasks column (`source='notify'`, matched to the current user by `assignee_key` OR `display_name`). The **Tasks page is now visible to all users** — viewers (whose full Daily sidebar section is hidden) get a standalone Tasks nav block, and the Add-User form defaults `tasks: true` in `allowed_modules`.
6. **Resolve loop** — marking a notify task done posts `✓ <name> marked this resolved` into the Slack thread. Two entry points: (a) `PATCH /api/tasks` (Command Center), (b) the Slack **Mark Resolved** button → **`POST /api/slack/interactions`**. The interactions route resolves the clicking Slack user → member, finds *their* open notify task on that thread (`slack_thread_ts` = the button message's ts — precise even though Slack reuses one MPIM channel id across repeat DMs), marks it done, posts the reply. Each member resolves only their own task. Always acks Slack `200`.
7. **Slack signature verification** — `verifySlackSignature` on the interactions route (HMAC-SHA256 `v0=` over `v0:{timestamp}:{rawBody}` with `process.env.SLACK_SIGNING_SECRET`, length-guarded `timingSafeEqual` + 5-min replay guard). **Non-fatal when the secret is unset** (skip + warn); once `SLACK_SIGNING_SECRET` is set, a bad/stale signature → 401.
8. **Slack Interactivity Request URL is now CONFIGURED** in api.slack.com/apps → Command Center app → Interactivity & Shortcuts → `https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/interactions`. So the interactive button reaches the backend. (`SLACK_SIGNING_SECRET` on Cloud Run is still pending — see Known Issues.)

**Migration** (`scripts/migrations/tasks-slack-thread.sql`, applied live): added `tasks.slack_thread_ts` + `tasks.slack_channel_id`; **dropped `tasks_assigned_to_check`** (was hard-limited to the 5 assignee keys). `assigned_to` stays NOT NULL.

### Board Member Overrides — joint-record trustees (June 19)

Some SAR trustees give via a **joint household record** that carries no "Trustee" in its own `roles_raw`, so the segment classifier put them in Parent / Parents of Alumni / Alumni instead of Board Members.

- **Table `board_member_overrides`** (`workspace_id`, `constituent_id`, `constituent_name`, `added_by`, `added_at`, `UNIQUE(workspace_id, constituent_id)`). DDL in `scripts/migrations/board-member-overrides.sql` (created + seeded externally).
- **6 seeded SAR rows** — constituent_ids **4262, 5271, 5750, 7775, 8878, 9688** — verified to have FY26 Operating gifts and NO "Trustee" in their own `roles_raw`.
- Read by `overview/route.ts` + `segment-donors/route.ts`: `segmentOf(cid)` returns `'Board Members'` if the cid is in the override set, else falls through to the existing Trustee-`roles_raw` `classifySegment`. Board Members card gained a ❓ tooltip.

### Development Overview — segment / soft-credit accuracy (June 25–28)

Rules now in force:
- **Soft-credit twin dedup:** a `gift_type=3` soft credit is an excluded Veracross twin **only** when its `hard_credit_gift_id` matches the record `id` of one of that constituent's own type-1 gifts; otherwise it's a separate-source gift (their DAF/foundation gave directly) and IS counted. `received = SUM(type-1 amount) + SUM(non-twin soft-credit amount)`. (Verified: Luxenberg 17707 → $101,360, Tsigutkin 9458 → $55,000; 131 donors gained +$827,885.)
- **"Other" segment** excludes foundations/DAFs already represented via a soft credit to a named-segment individual. Superseded the earlier grants-only (`OP: Grants`) filter.
- **FY27-pledge leak defense:** overview gifts query hardened to `.in([FY25_CAMPAIGN, FY26_CAMPAIGN])` so `Operating 2026-2027` rows are never fetched (output byte-identical).
- **Board Members drilldown** shows a per-trustee `secondaryRole` pill + a summary bar (total giving + trustee count per secondary segment).

### giving_history_cache — manual "Sync Gift History" button (June 25)

The nightly auto-ingest (`ingestGivingHistory` Cloud Function, 8am ET) was **deleted**. The GCS ingest route + parser are unchanged but now triggered **only by the admin** from the Development Overview via a bordered **"↓ Sync Gift History"** button (spinner → persistent `✓ Synced {N} records from {file} · file dated {modified}` / `✗ {message}`). FY25 baseline (for lapsed/new/retained AND the FY25 per-fund column, as of July 16) reads `giving_history_cache`, gifts_cache fallback.

### Admissions applicant Veracross links (June 23)

The 11 Veracross deep-links in the Admissions module now route **applicants** (not-yet-enrolled) to `…/detail/admission-candidate/{id}/3052-general` and **enrolled / re-enrolling** students to `…/detail/student-ls/{id}/273-general`, via a new `veracrossAdmissionUrl(personId, isEnrolled)` helper in `Dashboard.tsx`. Default is admission-candidate. `AfterSchoolTab.tsx` + all non-Admissions Veracross links untouched.

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
| Development — Overview | ✅ Live | Segment/soft-credit/board-override fixes; FY25 Campaign-by-Fund now uses giving_history_cache |
| Development — Capital Campaign | ⚠️ Empty | Fund = "Big Bold Future"; Sara sending queries — UNBLOCKED, not yet wired |
| Recruiting | ✅ Live | |
| Communications | ⚠️ Partial | Monday.com status-string mismatch |
| Buzz AI (Slack) | ✅ Live (test mode) | 7:30am schedule still commented out |
| Projects | ✅ Live | |
| **@Notify (cross-module)** | ✅ **Live** | Slack group DM + tasks + interactive Mark Resolved; Interactivity URL configured; SLACK_SIGNING_SECRET pending |

---

## Known Issues / Pending

### ⚠️ gcloud auth reauth (recurring blocker)
`./deploy.sh`'s **firebase step ships fine** every time (SSR function updated, hosting released), but the **gcloud-only tail steps abort** on `Reauthentication failed. cannot prompt during non-interactive execution`. Consequences: (a) the exact Cloud Run revision number has been **unreadable since June 18**; (b) **Cloud Run logs can't be read** (so the @Notify Slack diagnostic output is waiting to be read); (c) the build env can't read GCS objects (only list). **Fix:** run `gcloud auth login` as `rglassberg@saracademy.org` once, interactively. The skipped gcloud steps have been redundant on recent runs — firebase finalizes its own release.

### ⚠️ SLACK_SIGNING_SECRET not yet on Cloud Run
The `/api/slack/interactions` endpoint currently runs **unverified** (non-fatal by design — the Interactivity URL is configured and the button works). Add `SLACK_SIGNING_SECRET` to the Cloud Run env to enable HMAC signature verification and reject spoofed requests.

### ⚠️ SFTP VM `PasswordAuthentication yes` — mild security risk to revisit
The Veracross SFTP VM has `PasswordAuthentication yes` in its sshd/SFTP config (required because Veracross authenticates to the drop with username+password, not a key). This is a mild security risk (password-based auth is brute-forceable). Mitigations in place: chrooted `internal-sftp`, dedicated `sftpusers` group, non-shell account. Revisit if Veracross ever supports key-based auth, or lock down further (fail2ban / IP allowlist for Veracross's egress).

### @Notify — group DM may still fail if bot token lacks mpim:write
`[NOTIFY SLACK ERROR]` logging is deployed to reveal `missing_scope`/`needed: mpim:write` — read Cloud Run logs after a test @Notify (needs gcloud reauth). If so, reconnect Slack in Admin → Integrations to pick up the new token/scope.

### Capital Campaign tab not yet wired
Empty until built. Fund = `Big Bold Future`. Sara is sending the Veracross queries (designated vs undesignated buckets, YoY, by constituent) — **UNBLOCKED**, just not implemented.

### FY2025 accuracy items (Heidi flagged)
The June 25–28 Development Overview work (soft-credit twin dedup, "Other" foundation/DAF exclusion, board overrides, FY27-pledge leak defense) + the July 16 FY25 Campaign-by-Fund switch to `giving_history_cache` all came out of Heidi's QA of FY25/FY26 totals. Remaining open item: the **Cooper Fund ~$38K gap** (Leora's ground truth $350,294 vs page $388,804 — root cause TBD) plus the Cooper event-bucket relabels.

### Other pending (from master TODO)
- Cooper/Israel Fund: "Today" filter pill, clickable event rows, source-spreadsheet link.
- Year-over-year data across all Development metrics (Sara has 5+ years).
- Guardian Circle mobile column overflow; Veracross `person_id` link migration (needs `constituents_cache` person_id).
- Veracross ticket: `/v3/development/gifts` historical gap (~$703K Israel history + 3 GC gifts inaccessible; ticket 2026-06-03).
- Lever webhook activation. Recruiting HS toggle for Debra May.
- HS principal onboarding row in `workspace_members` (Becca to gather email/name/title).
- App-name decision (Becca + Debra dislike "Command Center"; "Beacon" suggested — ask RBK).

---

## SFTP Infrastructure (Veracross giving-history pipeline)

Delivers the nightly Operating gift-history CSV that powers `giving_history_cache` (FY25 baseline for lapsed/new/retained AND the FY25 Campaign-by-Fund column). **Fully automated end to end — Veracross-side fingerprint trust is resolved.**

- **VM:** `veracross-sftp`, e2-micro, **`us-east1-c`**, static IP **35.196.57.61**
- **GCS bucket:** `gs://rbk-cmd-center-sftp/` (giving-history under `veracross/giving-history/`; file `Operating_Gift_History.csv`)
- **Service account:** `veracross-sftp-writer@rbk-cmd-center.iam.gserviceaccount.com` (objectAdmin); the Cloud Run compute SA has `roles/storage.objectViewer` on the bucket (needed for `file.download()`). NOTE: the local `rglassberg@` ADC can LIST but not GET objects — read the bucket from Cloud Run, not the build env.
- **gcsfuse mount:** `--uid=1001 --gid=1004 --file-mode=664 --dir-mode=775 **-o allow_other**`
- **`/etc/fuse.conf`:** `user_allow_other` enabled (required for non-root FUSE access)
- **SFTP chroot:** `/data/sftp`, `sftpusers` group, `ForceCommand internal-sftp`
- **`PasswordAuthentication yes`** — REQUIRED for Veracross (it authenticates with username+password, not a key). See Known Issues (mild security risk to revisit).
- **Startup service:** `/etc/systemd/system/gcsfuse-sftp.service` **enabled**, with a **10-second startup delay** (`ExecStartPre=/bin/sleep 10` — lets networking/metadata settle before gcsfuse mounts on boot). Survives reboot.
- **Credentials:** username `veracross`, password `mOb0iG0sKzjIHW5el6W5hPNjc7rpw`
- **Veracross Data Package:** query 1494094, CSV, 3am daily → `/upload/veracross/giving-history/`. Query filter: Gift Date after 07/01/2023 (avoids "query threshold exceeded"). **The CSV now includes a Fund column** (col 12, appended last).
- **✅ RESOLVED:** Veracross (Bart, case 01309503) trusted the SFTP host fingerprint `SHA256:1Lc6Wq39saYxpnDHLkkaaPJHHTNE9stmaSV7cVCo7Wc` for `35.196.57.61`. The nightly push lands in GCS automatically; the admin "Sync Gift History" button ingests the newest CSV on demand.

---

## Critical Technical Facts

### Soft Credits (Must Always Follow)
- A `gift_type=3` soft credit is an excluded **Veracross twin** ONLY when its `hard_credit_gift_id` = the record `id` of one of the constituent's own type-1 gifts. Otherwise it's a separate-source gift (their DAF/foundation) and IS counted.
- Veracross writes TWO soft-credit rows per gift (`soft_credit_type=1` + `=2`) sharing the same `hard_credit_gift_id` — dedup by that id, not amount.
- Soft pool is `gift_type=3` (sc 1/2). `gift_type=5` is a separate representation of the same pledge — never add it (double-counts).
- Applies to segment totals, lapsed/new/retained, drilldowns, Israel Fund.

### Veracross API Quirks
- Programs API paginates by headers (`X-Page-Size`/`X-Page-Number`, default 2/page), no `X-Total-Count`; `school_year` = FALL year (2026 = AY 26-27).
- Programs client CANNOT read students — use the **admissions** client for `/v3/students/{id}`.
- `/v3/development/gifts` returns only ~April 2025+ — use `giving_history_cache` for FY25 (baseline AND per-fund).
- Attendance: caps at 1000/page, always paginate.
- Grade numbers: 40=Infant/Toddler, 35=2YN, 30=3YN, 25=Pre-K, 20=K, 1-8=1st-8th, 9-12=HS.

### giving_history_cache (Veracross gift-history CSV)
- Columns: `gift_record_id` (UNIQUE per workspace), `constituent_id`, `constituent_name`, `amount`, `gift_type`, `gift_type_text`, `gift_date`, `campaign`, `fundraising_activity`, `fiscal_year`, `soft_credit_type_text`, `studio_hard_credit_id`, **`fund` (added July 16)**. NO `pledge_balance` column (CSV carries only `amount`).
- CSV column order (1-indexed): 1 Constituent, 2 Record ID, 3 Gift Type, 4 Date, 5 Amount, 6 Campaign, 7 Soft Credit Type, 8 Studio Hard Credit ID, 9 Fiscal Year, 10 Fundraising Activity, 11 Constituent ID, **12 Fund** (assumed-last; verified via post-sync data).
- Parser: `lib/parseGivingHistoryCSV.ts` (RFC-4180, MM/DD/YY dates, gift-type text→numeric, "FY 05"→"FY05").

### gift_type Codes
1=Donation, 2=Pledge (use `pledge_balance` in gifts_cache), 3=Soft Credit Donation, 4=Pledge Installment, 5=Soft Credit Pledge.

### Cloud Run Deploy
- Always `--no-cpu-throttling --memory=512Mi`; `firebase.json` `frameworksBackend.memory: "512MiB"`.
- Logs: `gcloud run services logs read ssrrbkcmdcenter --region=us-east1 --project=rbk-cmd-center` (needs gcloud reauth).

### Tasks / @Notify
- `tasks.assigned_to` no longer has a CHECK constraint (dropped for @Notify); still NOT NULL. Any `assignee_key` or `display_name` is valid.
- Notify tasks: `source='notify'`, `source_ref=context`, `slack_thread_ts`+`slack_channel_id` set. Matched to a user by `assignee_key` OR `display_name`.
- Slack group DM = `conversations.open` (comma-separated user IDs) → `channel.id` → `chat.postMessage`. Needs ≥2 participants with Slack IDs.

---

## Infrastructure Reference

### @Notify / Slack interactions
- Notify: `POST /api/notify` (auth-gated). Interactive button: `POST /api/slack/interactions` (Slack-signed, middleware-excluded).
- Slack app config (DONE): Interactivity Request URL → `https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/interactions`.

### Giving-history ingest (manual re-sync)
```bash
set -a && source .env.local && set +a
curl -X POST https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/development/giving-history/ingest \
  -H "X-Internal-Secret: ${INTERNAL_SYNC_SECRET}" -H "Content-Type: application/json"
```

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
- `RBKCC_HANDOFF_2026-07-14.md` / `RBKCC_HANDOFF_2026-06-18.md` — Previous session handoffs
- `app/components/shared/NotifyButton.tsx` — @Notify button + popover
- `app/api/notify/route.ts` — @Notify: group DM + task creation
- `app/api/slack/interactions/route.ts` — Slack interactive-button handler (Mark Resolved) + signature verification
- `lib/slackNotifications.ts` — Slack helpers (`sendSlackDM`, `sendTaskSlack`, `openGroupDm`, `postSlackMessage`)
- `lib/parseGivingHistoryCSV.ts` — Veracross gift-history CSV parser (now reads `fund`, col 12)
- `app/api/development/giving-history/ingest/route.ts` — GCS CSV ingestion (admin-triggered; stores `fund`)
- `app/api/development/overview/route.ts` — Segment classification + lapsed/new/retained + board overrides + FY25 per-fund from giving_history_cache
- `app/api/development/overview/segment-donors/route.ts` — Segment drilldown
- `scripts/migrations/tasks-slack-thread.sql` — tasks slack_thread_ts/channel_id + dropped assignee CHECK
- `scripts/migrations/board-member-overrides.sql` — board_member_overrides DDL
- `app/components/development/OverviewTab.tsx` — Development Overview UI
- `app/admin/permissions/page.tsx` — Admin permissions (By User / By Module)
- `app/components/Dashboard.tsx` — Main UI (~9,100 lines; all module views)
- `app/components/Sidebar.tsx` — Sidebar nav (Tasks now shown to all users)
