-- Cross-module @Notify feature (2026-07-14)
--
-- 1. slack_thread_ts / slack_channel_id: store the Slack group-DM thread
--    coordinates for tasks created by POST /api/notify so the task
--    completion handler (PATCH /api/tasks) can post a "✓ resolved" reply
--    back into the same thread. Both are needed — chat.postMessage with
--    thread_ts requires the channel id, and an MPIM (group DM) channel id
--    is not reconstructable from thread_ts alone.
--
-- 2. Relax tasks_assigned_to_check: the old constraint hard-limited
--    assigned_to to the 5 keys ['RBK','Emily','Sara','Leora','Becca'].
--    @Notify must be able to create a task for ANY workspace member
--    (most of whom have no assignee_key and are stored by display_name),
--    so the enum-style CHECK is dropped. assigned_to stays NOT NULL.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS slack_thread_ts text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS slack_channel_id text;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_check;
