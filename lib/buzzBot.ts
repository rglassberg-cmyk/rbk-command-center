// Buzz — the SAR Command Center AI assistant persona. Sends morning
// briefings via Slack DM and (Phase 2) handles conversational replies.
//
// Final name choice pending Becca confirmation — placeholder emoji 🐝
// is a friendly default; change here once the persona art lands.

export const BOT_NAME = 'Buzz';
export const BOT_EMOJI = '🐝';

// Test-mode gate. While true, generateAllBriefings() filters the
// member list down to BUZZ_TEST_USERS so morning runs only reach
// Becca + Emily. Flip to false (and remove or expand the list) once
// the full rollout is approved.
export const BUZZ_TEST_MODE = true;

export const BUZZ_TEST_USERS = [
  'rglassberg@saracademy.org',
  'egray@saracademy.org',
  'resulto@saracademy.org',
];

export const ONBOARDING_MESSAGE = (firstName: string): string =>
  `Hey ${firstName}! I'm Buzz ${BOT_EMOJI} — your SAR Command Center assistant.

Every morning before school, I'll send you a quick briefing with what's on your plate: calendar, tasks, and whatever matters most for your role.

Before I start, let me ask you a few things so I can be actually useful:

*1. Where do you keep your tasks and to-dos?*
(Command Center, Monday.com, Google Tasks, email, a mix — or somewhere else?)

*2. Should I scan your email for reminders and important items to surface in your morning briefing?*
(yes / no / sometimes)

*3. Is your Google Calendar up to date, or do you track things somewhere else too?*

*4. What's the one thing you most want to know first thing in the morning?*

Reply here with whatever comes naturally — you don't need to answer in order. I'll figure it out. ${BOT_EMOJI}`;

export const ONBOARDING_SAVED_MESSAGE = (firstName: string): string =>
  `Got it, ${firstName}! I'll keep that in mind every morning.

You'll get your first briefing tomorrow at 7:30am. If you ever want to update your preferences or ask me something, just DM me here. 👋`;

export const PHASE_2_PLACEHOLDER_MESSAGE = `Thanks! Conversational features are coming soon. ${BOT_EMOJI}`;

// First name helper — picks the first whitespace-delimited token from
// a display_name, falling back to the local part of the email when
// display_name is empty. Used by both the briefing greeting and the
// onboarding flow.
export function firstNameOf(displayName: string | null | undefined, email: string): string {
  if (displayName && displayName.trim()) {
    const tok = displayName.trim().split(/\s+/)[0];
    if (tok) return tok;
  }
  const local = (email || '').split('@')[0] || 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
}
