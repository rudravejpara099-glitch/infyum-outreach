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
  {
    id: 3,
    name: "anthropic_sonnet_55_verified_price",
    sql: `
INSERT INTO billing_model_rates(id,model,input_micros_per_million,output_micros_per_million,cache_read_micros_per_million,cache_write_micros_per_million,verified,source,created_at)
VALUES(100,'claude-sonnet-5-5',2000000,10000000,100000,NULL,1,'https://platform.claude.com/docs/en/about-claude/pricing','2026-10-22T00:00:00.000Z');
`,
  },
  {
    id: 4,
    name: "durable_apify_run_id",
    sql: "ALTER TABLE billing_reservations ADD COLUMN provider_run_id TEXT;",
  },
  {
    id: 5,
    name: "instagram_browser_mode",
    sql: "ALTER TABLE ig_accounts ADD COLUMN browser_mode TEXT NOT NULL DEFAULT 'isolated' CHECK (browser_mode IN ('isolated','chrome_read_only'))",
  },
  {
    id: 6,
    name: "company_workspaces",
    sql: `
CREATE TABLE workspace_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0,1))
);
CREATE UNIQUE INDEX workspace_one_legacy ON workspace_catalog(legacy) WHERE legacy=1;
CREATE TABLE workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member')),
  PRIMARY KEY (workspace_id,user_id)
);
CREATE UNIQUE INDEX workspace_one_owner ON workspace_memberships(workspace_id) WHERE role='owner';
CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE workspace_sessions (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX workspace_sessions_user ON workspace_sessions(user_id,workspace_id);
CREATE TABLE workspace_bootstrap (id INTEGER PRIMARY KEY CHECK (id=1));
`,
  },
  {
    id: 7,
    name: "customer_device_connector",
    sql: `
CREATE TABLE device_pairings (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE paired_devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspace_catalog(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  last_seen INTEGER,
  revoked_at INTEGER
);
CREATE INDEX paired_devices_workspace ON paired_devices(workspace_id);
CREATE TRIGGER revoke_removed_member_devices AFTER DELETE ON workspace_memberships BEGIN
  UPDATE paired_devices SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000
    WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id AND revoked_at IS NULL;
  DELETE FROM device_pairings WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
END;
CREATE TABLE account_devices (
  account_id INTEGER PRIMARY KEY REFERENCES ig_accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL
);
CREATE TABLE device_commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_attempt INTEGER NOT NULL,
  kind TEXT NOT NULL,
  args_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','done','failed','uncertain')),
  expires_at INTEGER NOT NULL,
  started_at INTEGER,
  result_json TEXT,
  error TEXT,
  callback_json TEXT,
  callback_response_json TEXT
);
CREATE INDEX device_commands_pending ON device_commands(device_id,status,expires_at);
CREATE UNIQUE INDEX device_commands_one_active ON device_commands(job_id,kind) WHERE status IN ('queued','running');
`,
  },
  {
    id: 8,
    name: "lead_fit_score",
    sql: `
ALTER TABLE leads ADD COLUMN fit_score INTEGER;
ALTER TABLE leads ADD COLUMN fit_reason TEXT NOT NULL DEFAULT '';
`,
  },
  {
    id: 9,
    name: "daily_actions",
    sql: `
CREATE TABLE daily_actions (
  account_id INTEGER NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('follow','like','comment')),
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day, kind)
);
`,
  },
  {
    id: 10,
    name: "user_google",
    sql: `
CREATE TABLE user_google (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
  },
];
