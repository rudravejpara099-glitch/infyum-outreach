import { billingSchema, billingImmutability } from "@/lib/billing/schema";
// Append-only. Never edit a migration that has shipped: add a new one.
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ig_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  profile_dir TEXT NOT NULL,
  daily_cap INTEGER NOT NULL DEFAULT 35,
  ramp_start TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','blocked')),
  status_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  niches TEXT NOT NULL DEFAULT '[]',
  audience_text TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'United States',
  min_followers INTEGER NOT NULL DEFAULT 2000,
  max_followers INTEGER NOT NULL DEFAULT 150000,
  booking_link TEXT NOT NULL DEFAULT '',
  approval_required INTEGER NOT NULL DEFAULT 1,
  followups_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE campaign_accounts (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, account_id)
);

-- One row per Instagram handle across the whole app: this is the global dedupe.
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,
  followers INTEGER,
  niche TEXT NOT NULL DEFAULT '',
  country TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  stage TEXT NOT NULL DEFAULT 'found',
  skip_reason TEXT NOT NULL DEFAULT '',
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES ig_accounts(id) ON DELETE SET NULL,
  followups_sent INTEGER NOT NULL DEFAULT 0,
  next_followup_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX leads_stage ON leads(stage);
CREATE INDEX leads_campaign ON leads(campaign_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES ig_accounts(id) ON DELETE SET NULL,   -- the sender
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  kind TEXT NOT NULL CHECK (kind IN ('dm','reply','followup','incoming')),
  parts TEXT NOT NULL,                  -- JSON array of strings; a first DM has three
  status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','sent','failed','rejected')),
  approval_reasons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX messages_lead ON messages(lead_id);
CREATE INDEX messages_status ON messages(status);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES ig_accounts(id) ON DELETE SET NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  run_after TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX jobs_due ON jobs(status, run_after);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,                  -- a user email, "worker" or "system"
  action TEXT NOT NULL,
  lead_id INTEGER,
  account_id INTEGER,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX activity_ts ON activity(ts);

CREATE TABLE do_not_contact (
  handle TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  { id: 2, name: "billing_at_cost", sql: billingSchema + billingImmutability },
];
