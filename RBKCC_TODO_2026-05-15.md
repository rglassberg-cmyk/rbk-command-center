# ARCHIVED — superseded by RBKCC_MASTER_TODO.md (June 2, 2026)

# RBK Command Center — To-Do & Roadmap
_Updated: May 15, 2026 — after Becca + Emily Gray session_

---

## 🚨 FIX NOW (Blocking)

### 1. iOS crash on Emily's phone
Same "Application error: client-side exception" as before. Back after the latest deploy (donor notes / @mention / DonorAnnotations). Most likely: the `MentionText` component or `DonorAnnotations` caret-detection logic touches a DOM API during SSR, causing a hydration mismatch on iOS Safari.
- Wrap all caret/DOM logic in `typeof window !== 'undefined'` guards
- Ensure `DonorAnnotations.tsx` is imported with `next/dynamic` + `{ ssr: false }` if it uses any browser APIs
- Test on iOS Safari after fix

---

## 🔴 HIGH PRIORITY

### 2. Mobile: Development page — columns cut off
On mobile, the constituent/gift table is squished and donor names are cut off. Event/fund column not visible at all.
- On mobile, show only 2 columns: **Name** + **Event/Fund**
- All other columns hidden on mobile (`hidden md:table-cell`)
- Tapping a row opens the full side panel (already works)
- Apply same pattern to Guardian Circle constituent table

### 3. Guardian Circle → Move into Development tabs
Currently Guardian Circle is a separate sidebar item. Move it to be a tab within the Development page.
- **New tab order:** Weekly Gifts → Campaign Giving by Fund → Guardian Circle → Cooper Fund → Israel Fund
- Remove "Guardian Circle" from the sidebar
- Keep any existing "View Guardian Circle" shortcut links from Campaign Giving page as-is
- Guardian Circle tab should be identical to what's there now, just accessed from within Development

### 4. Simchas & Shivas — Send Note overhaul
Currently "Send Note" just marks as sent with no context, no undo, no way to direct Emily.
- When RBK clicks "Send Note" on a Shiva, show a small modal/inline form first: "Add a note for Emily (optional)" with a text input
- That note becomes the task body in Emily's Tasks page (not just the title "Draft condolence note for [family]")
- The task should include: family name, relationship info from the email (parse from the Hamakum email body), and RBK's note
- Slack Emily when the task is created: "📋 Draft condolence note for [Family]. RBK's note: [note text]"
- Add undo/cancel option before finalizing the send

### 5. Tasks — Due date Slack reminder
Any task with a due date should automatically Slack the assigned person on that day.
- Needs a Cloud Function scheduled to run daily (e.g., 8am ET)
- Query tasks where `due_date = today` and `status != 'done'`
- For each task, look up assigned user's Slack ID from MENTIONABLE_USERS
- Send DM: "📅 Task due today: [task title]"

---

## 🟡 MEDIUM PRIORITY

### 6. Emails page — "Action Items" section at top
Restructure the All Emails page so RBK sees his action queue first, inbox below.

**New layout:**
- **Top section: "To Send"** — AI-drafted notes waiting for RBK to review + send
  - Card type 1: **Day of Learning thank yous** (see item 7)
  - Card type 2: **Guardian Circle thank yous** (already built as envelope icon — surface them here too)
  - Card type 3: **Condolence notes** (from Simchas & Shivas send note flow)
- **Below:** Existing inbox sections (Action, Emily's Queue, Important, FYI, etc.) — unchanged

Each "To Send" card shows: donor/family name, note type, draft preview, Send + Edit buttons.

### 7. Day of Learning thank you notes (automation)
Emily currently manually drafts these every day using the Day of Learning email as input. This is time-consuming.

**What we know:**
- Day of Learning gifts come in as fund `OP: Sponsorships` with event `Day of Learning 25-26` (or similar)
- Veracross has a **gift notes field** on the donation record with dedication text (e.g., "Please dedicate the learning on 13th of Shvat in memory of...")
- Leora sets **profile codes** on constituent records: `day_of_learning_month` and `day_of_learning_day` for recurring annual sponsors

**Plan:**
1. Talk to Leora to confirm: which Veracross field holds the dedication/honoree info on Day of Learning gifts
2. Add that field to the `gifts_cache` sync (likely a `notes` or `gift_notes` field on the gift record)
3. When a Day of Learning gift comes in, auto-generate a thank you draft using Claude, pre-filled with dedication text
4. Surface the draft in the "To Send" section on the Emails page

**Blocked on:** Leora confirmation of the Veracross field name

### 8. Thank you notes — auto-BCC Veracross tracking email
When any thank you note is sent from the app (Guardian Circle envelope button, Day of Learning, etc.), automatically BCC the Veracross tracking email address.
- Emily currently does this manually
- Sara mentioned this tracking email in a meeting
- Get the BCC address from Emily/Sara and hardcode it into the send flow
- The `mailto:` link should include `bcc=veracross-tracking@saracademy.org` (confirm exact address)

### 9. Cooper Fund + Israel Fund — "Today" filter
Same as the "Today" pill we added to Weekly Gifts.
- Add "Today" as first filter pill on both Cooper Fund and Israel Fund money-in sections

### 10. Cooper Fund + Israel Fund — Clickable event rows
The money-in by event sections currently show aggregated totals. Add drilldown:
- Clicking an event row expands it to show individual gift details (constituent name, amount, date, Veracross link)
- Same pattern as Weekly Gifts gift rows
- Add the `DonorAnnotations` component (@mention notes + tags) to each gift row

### 11. Cooper Fund → Slack channel integration
RBK often notifies Emily/Sara/Leora about expected gifts via the Cooper Fund Slack channel. This is messy.
- Add `@CooperFundChannel` as a taggable option in the @mention dropdown on Cooper Fund notes
- When `@CooperFundChannel` is mentioned, post the note to the Cooper Fund Slack channel (not just a DM)
- Get the Cooper Fund Slack channel ID from Emily
- This replaces the Slack channel as the communication method, keeping everything in the dashboard

### 12. Admissions — @mention notes on drilldown panels
When RBK or Emily Daniel are in the enrollment drilldown (Registered, Pending Review, Waitlisted, etc.), they should be able to add a note with @mention, same as Development.
- Add `DonorAnnotations` (or a renamed `PanelAnnotations` version) to the enrollment student detail panels
- Mentionable users for Admissions: RBK, Emily Gray, Emily Daniel, Debra Eis
- Notes tagged to student by name; @RBK mention creates a task

---

## 🟢 NICE TO HAVE / ROADMAP

### 13. SAR Academy $900K filter on Weekly Gifts
Filter out internal journal entries where `constituent_name = 'SAR Academy'` from Weekly Gifts feed.
- One-line fix in `/api/development/weekly-gifts/route.ts`

### 14. Communications page — team adoption
The Communications page is built but the communications team isn't using it. The Monday status text also has a mismatch (pending approvals not showing).
- Follow up with communications team to get them onboarded
- Fix Monday API status text mismatch (raw API value ≠ "Pending RBK Approval")

### 15. Lever — test with RBK
RBK needs to test the Lever recruiting page and notes functionality. Nothing to build; just needs a walkthrough.

### 16. App name
RBK may not love "Command Center" or "RBK." Consider asking him directly what he'd prefer the app to be called. Options to explore: his name (Rabbi Krauss / Bini), a Hebrew name, something school-specific.

### 17. Multi-year giving history per donor
On the Guardian Circle constituent detail, show giving history across multiple years.

### 18. Email draft BCC → Veracross auto-tracking
When Emily or RBK sends any email draft from the app, auto-BCC the Veracross tracking address so it logs in Veracross automatically.

### 19. Cooper Fund year-over-year category tracking
Compare this year's disbursements vs last year by category.

---

## ✅ COMPLETED (since last summary — May 15, 2026)

- [x] Guardian Circle formula fixed (donations + pledge_balance = correct Veracross match)
- [x] Outstanding pledges: $531,008 ✅
- [x] 3 new fields synced: thank_you_letter_date, payment_frequency, primary_development_role
- [x] ConstituentTable: Frequency + Thank You columns, role filter pills
- [x] Thank You Note generator (Claude-powered, envelope icon on donor rows)
- [x] ANTHROPIC_API_KEY live on Cloud Run
- [x] Pisgah grade bucket fix (students stay in correct grade row)
- [x] Pisgah drilldown shows correct students
- [x] Waitlist drilldown pullout added
- [x] Shimmer skeleton screens (all major pages)
- [x] Lazy loading on all heavy pages (activeNav + useRef pattern)
- [x] Decoupled stat cards from table data (Guardian Circle ?view=summary)
- [x] PWA: manifest.json, icons, theme color, installable on iPhone
- [x] Mobile sidebar: hamburger menu + X close button + backdrop
- [x] Viewport accessibility fix (removed userScalable: false)
- [x] iOS Safari crash fix (shimmer rewritten to animate-pulse)
- [x] Cooper Fund money-in by event section
- [x] Israel Fund money-in by event section (collapsible, searchable)
- [x] Israel Fund initiatives table: all 35 initiatives populated
- [x] "Today" filter on Weekly Gifts
- [x] Donor notes system (donor_notes table, @mention, Slack DMs)
- [x] Donor tagging (5 predefined tags, colored pills)
- [x] @mention autocomplete (5 users, dropdown on @ keystroke)
- [x] Slack DMs on @mention (all 5 users wired with Slack IDs)
- [x] Task auto-creation when @RBK mentioned (source: development)
- [x] Tasks page: "From Development" + "From Admissions" sections
- [x] Sara Hasson + Leora Miller: viewer access with Development module
- [x] RBK email corrected to kraussb@saracademy.org
- [x] UI & Performance Standards documented in CLAUDE_CONTEXT.md
- [x] PWA icon: SAR-inspired colorful segmented circle with triangle
