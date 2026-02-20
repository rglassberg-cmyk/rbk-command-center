# RBK Command Center - Design Cleanup Plan

## Current Issues Identified

### 1. Confusing Section Names
- **"Urgent Needs Your Action"** on dashboard shows ALL RBK action emails, not just urgent ones
- There's a separate "urgent" action status that can be applied to emails
- These two concepts are being conflated

### 2. Button/Action Inconsistency
- Different buttons appear in different places for similar actions
- Status buttons, action buttons, and quick actions are mixed together
- Not always clear what each button does

### 3. Sections Without Clear Purpose
- Some sections overlap in functionality
- Dashboard vs. All Emails page have similar content but different layouts

---

## Proposed Information Architecture

### Dashboard (Home View)
**Purpose:** Quick overview, take immediate action on most important items

| Section | What It Shows | Actions Available |
|---------|---------------|-------------------|
| **Needs Attention** | Emails marked as URGENT only (action_status = 'urgent') | View, Mark Done |
| **Today's Schedule** | Calendar events for selected day | Join meeting, Navigate days, Add event |
| **My Tasks** | Tasks assigned to RBK (incomplete) | Mark complete, View email |
| **Quick Links** | Static links to folders | Click to open |
| **Meeting Agenda** | Emails flagged for meeting | View count, Open full list |
| **Drafts Ready** | Emails with approved drafts ready to send | Send, View |

### All Emails Page
**Purpose:** Process and triage all emails by category

| Section | What It Shows | Actions Available |
|---------|---------------|-------------------|
| **RBK Action** | Emails needing Rabbi Krauss's action | Full email management |
| **Emily Action** | Emails for Emily to handle | Full email management |
| **Important** | Important but no action needed | Mark done, Archive |
| **Review** | Needs review but not urgent | Mark done, Archive |
| **Invitations** | Event invitations | Mark done, Archive |
| **FYI** | Informational only | Mark done, Archive |

### Meeting Agenda Page
**Purpose:** Prepare for and run meetings

| Section | What It Shows | Actions Available |
|---------|---------------|-------------------|
| **Agenda Items** | Emails flagged for discussion | Mark discussed, Add notes, Remove |

### Tasks Page
**Purpose:** Track action items

| Section | What It Shows | Actions Available |
|---------|---------------|-------------------|
| **RBK Tasks** | Tasks assigned to RBK | Mark complete, View email |
| **Emily Tasks** | Tasks assigned to Emily | Mark complete, View email |

---

## Design Principles

### 1. Consistent Button Styling
- **Primary actions** (Send, Mark Done): Solid colored buttons
- **Secondary actions** (Edit, View): Outlined or gray buttons
- **Danger actions** (Delete, Archive): Red or muted

### 2. Consistent Button Placement
- **Status changes**: Always in the same spot within email cards
- **Quick actions**: Grouped together, same order everywhere
- **Navigation**: Top of sections

### 3. Clear Visual Hierarchy
- Most important info/actions at top
- Progressive disclosure (expand for more)
- Color coding consistent across app

### 4. Reduce Cognitive Load
- Fewer choices visible at once
- Group related actions
- Clear labels (no jargon)

---

## Specific Changes Needed

### Phase 1: Fix Confusion (High Priority)

1. **Rename "Urgent Needs Your Action"** → **"Needs Attention"** or just remove
   - Only show emails with `action_status === 'urgent'`
   - If none, don't show this section
   - OR: Remove from dashboard entirely, urgent items appear in All Emails with a banner

2. **Clarify Action Status vs Priority**
   - Priority = AI-assigned category (RBK Action, Emily Action, etc.)
   - Action Status = User-assigned flag (Urgent, Send, Remind Me, etc.)
   - Make these visually distinct

3. **Standardize Email Card Layout**
   - Same info in same places across all views
   - Same buttons available in same order

### Phase 2: Visual Consistency (Medium Priority)

4. **Button Audit**
   - List all buttons across the app
   - Standardize colors, sizes, placement
   - Remove redundant buttons

5. **Color Palette**
   - Define exact colors for each category
   - Use consistently everywhere

6. **Typography**
   - Consistent heading sizes
   - Consistent text colors for different info types

### Phase 3: Polish (Lower Priority)

7. **Empty States**
   - Nice messages when sections are empty
   - Consistent styling

8. **Loading States**
   - Consistent spinners/skeletons
   - Smooth transitions

9. **Mobile Optimization**
   - Test on tablet
   - Adjust layouts as needed

---

## Questions to Decide Together

1. **Dashboard content:** What should RBK see first thing? Just urgent items? Or a broader overview?

2. **"Urgent" concept:** Should this be:
   - A separate prominent section?
   - Just a red badge on emails in their normal category?
   - A banner alert that appears when there are urgent items?

3. **Action buttons:** Which actions are most used? Those should be most prominent.

4. **Meeting Agenda:** Should this live on the dashboard or be its own page only?

5. **Tasks:** Are tasks being used? Should they be more prominent or simplified?

---

## Next Session Tasks

Pick from these based on priority:

- [ ] Fix the "Urgent" section to only show actually-urgent emails
- [ ] Audit and standardize all buttons
- [ ] Create consistent email card component
- [ ] Define and document color palette
- [ ] Simplify dashboard to most essential items
- [ ] Test with Rabbi Krauss and get feedback

---

*This is a living document - update as decisions are made!*
