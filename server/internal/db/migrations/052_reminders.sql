-- Study reminders (#137-#139). Contract: docs/contracts/reminders/.
--
-- reminder_facts: the derived study snapshot one client published per
-- workspace (due counts, goal and streak state, vacation dates). A cache the
-- planner reads; the server has no scheduler of its own, so it cannot derive it.
-- push_subscriptions: one browser's Web Push subscription. The endpoint and keys
-- are credentials (never logged, never returned); the endpoint alone is useless
-- without the VAPID private key, which is sealed below. One endpoint belongs to
-- one account at a time (a device that signs in as someone else takes it over).
-- reminder_deliveries: the delivery log, one row per (account, channel, kind,
-- learner day), written before the send so a restart cannot send twice. It holds
-- no message text.
-- push_vapid: the instance's VAPID key pair; the private scalar is sealed with
-- QINQIN_SECRET like the other server secrets and never leaves this table.

CREATE TABLE reminder_facts (
    user_id INTEGER NOT NULL REFERENCES users(id),
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
    as_of TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_success_at TEXT,
    failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE reminder_deliveries (
    user_id INTEGER NOT NULL REFERENCES users(id),
    channel TEXT NOT NULL CHECK (channel IN ('email', 'push')),
    kind TEXT NOT NULL CHECK (kind IN ('due', 'goal', 'streak')),
    day TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('claimed', 'sent', 'failed')),
    PRIMARY KEY (user_id, channel, kind, day)
);

CREATE TABLE push_vapid (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_ct BLOB NOT NULL,
    private_nonce BLOB NOT NULL,
    secret_fp TEXT NOT NULL,
    created_at TEXT NOT NULL
);
