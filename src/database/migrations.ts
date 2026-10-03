export type Migration={ version:number; name:string; sql:string; down:string };

export const MIGRATIONS:Migration[]=[
 {version:1,name:"core",sql:`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guilds (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_settings (
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 key TEXT NOT NULL,
 value TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (guild_id, key)
);

CREATE TABLE IF NOT EXISTS members (
 guild_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 joined_at TEXT NOT NULL,
 messages INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_key ON guild_settings(key);
`,
  down:`
DROP INDEX IF EXISTS idx_settings_key;
DROP INDEX IF EXISTS idx_members_user;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS guild_settings;
DROP TABLE IF EXISTS guilds;
DROP TABLE IF EXISTS users;
`},
 {version:2,name:"audit",sql:`
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT,
 actor_id TEXT,
 action TEXT NOT NULL,
 target_id TEXT,
 result TEXT NOT NULL,
 detail TEXT,
 created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_guild_time ON audit_logs(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
`,
  down:`
DROP INDEX IF EXISTS idx_audit_action;
DROP INDEX IF EXISTS idx_audit_guild_time;
DROP TABLE IF EXISTS audit_logs;
`},
 {version:3,name:"system_logs",sql:`
CREATE TABLE IF NOT EXISTS system_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 level TEXT NOT NULL,
 scope TEXT NOT NULL,
 message TEXT NOT NULL,
 created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_logs_level_time ON system_logs(level, created_at);
`,
  down:`
DROP INDEX IF EXISTS idx_system_logs_level_time;
DROP TABLE IF EXISTS system_logs;
`},
 {version:4,name:"platform",sql:`
CREATE TABLE IF NOT EXISTS setup_state (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 started_at TEXT NOT NULL,
 finished_at TEXT,
 results TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS api_keys (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 hash TEXT NOT NULL UNIQUE,
 prefix TEXT NOT NULL,
 scopes TEXT NOT NULL,
 guild_id TEXT,
 created_at TEXT NOT NULL,
 expires_at TEXT,
 last_used_at TEXT,
 revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(hash);

CREATE TABLE IF NOT EXISTS security_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 level TEXT NOT NULL,
 count INTEGER NOT NULL,
 detail TEXT,
 created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_guild_time ON security_events(guild_id, created_at);

CREATE TABLE IF NOT EXISTS raid_incidents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guild_id TEXT NOT NULL,
 level TEXT NOT NULL,
 trigger_kind TEXT NOT NULL,
 member_count INTEGER NOT NULL,
 actions TEXT NOT NULL,
 opened_at TEXT NOT NULL,
 resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_raid_guild_time ON raid_incidents(guild_id, opened_at);
`,
  down:`
DROP INDEX IF EXISTS idx_raid_guild_time;
DROP TABLE IF EXISTS raid_incidents;
DROP INDEX IF EXISTS idx_security_guild_time;
DROP TABLE IF EXISTS security_events;
DROP INDEX IF EXISTS idx_api_keys_hash;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS setup_state;
`},
 {version:5,name:"features",sql:`
CREATE TABLE IF NOT EXISTS economy_accounts (
 user_id TEXT PRIMARY KEY,
 balance INTEGER NOT NULL DEFAULT 0,
 lifetime_earned INTEGER NOT NULL DEFAULT 0,
 lifetime_spent INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS economy_transactions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 amount INTEGER NOT NULL,
 balance_after INTEGER NOT NULL,
 reason TEXT NOT NULL,
 ref TEXT,
 created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_econ_tx_user ON economy_transactions(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_econ_tx_ref ON economy_transactions(ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS xp (
 guild_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 xp INTEGER NOT NULL DEFAULT 0,
 level INTEGER NOT NULL DEFAULT 0,
 messages INTEGER NOT NULL DEFAULT 0,
 last_xp_at TEXT,
 PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_xp_guild ON xp(guild_id, xp DESC);

CREATE TABLE IF NOT EXISTS moderation_cases (
 case_id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 moderator_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 evidence TEXT,
 duration_sec INTEGER,
 created_at TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cases_guild ON moderation_cases(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_user ON moderation_cases(guild_id, user_id);

CREATE TABLE IF NOT EXISTS polls (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 channel_id TEXT,
 question TEXT NOT NULL,
 options TEXT NOT NULL,
 multiple INTEGER NOT NULL DEFAULT 0,
 anonymous INTEGER NOT NULL DEFAULT 0,
 ends_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 closed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
 poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
 voter_id TEXT NOT NULL,
 option_index INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY (poll_id, voter_id, option_index)
);

CREATE TABLE IF NOT EXISTS giveaways (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 channel_id TEXT,
 title TEXT NOT NULL,
 winners INTEGER NOT NULL,
 requirements TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 drawn INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
 giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 channel_id TEXT,
 user_id TEXT NOT NULL,
 subject TEXT NOT NULL,
 status TEXT NOT NULL,
 claimed_by TEXT,
 created_at TEXT NOT NULL,
 closed_at TEXT,
 last_activity_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id, status);
`,
  down:`
DROP INDEX IF EXISTS idx_tickets_guild;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS giveaway_entries;
DROP TABLE IF EXISTS giveaways;
DROP TABLE IF EXISTS poll_votes;
DROP TABLE IF EXISTS polls;
DROP INDEX IF EXISTS idx_cases_user;
DROP INDEX IF EXISTS idx_cases_guild;
DROP TABLE IF EXISTS moderation_cases;
DROP INDEX IF EXISTS idx_xp_guild;
DROP TABLE IF EXISTS xp;
DROP INDEX IF EXISTS idx_econ_tx_ref;
DROP INDEX IF EXISTS idx_econ_tx_user;
DROP TABLE IF EXISTS economy_transactions;
DROP TABLE IF EXISTS economy_accounts;
`},
 {version:6,name:"integrations",sql:`
CREATE TABLE IF NOT EXISTS webhook_endpoints (
 id TEXT PRIMARY KEY,
 guild_id TEXT,
 url TEXT NOT NULL,
 secret_hash TEXT NOT NULL,
 events TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 endpoint_id TEXT NOT NULL,
 event TEXT NOT NULL,
 attempt INTEGER NOT NULL,
 status_code INTEGER,
 ok INTEGER NOT NULL,
 error TEXT,
 duration_ms INTEGER NOT NULL,
 created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_endpoint ON webhook_logs(endpoint_id, created_at);

CREATE TABLE IF NOT EXISTS plugins (
 name TEXT PRIMARY KEY,
 version TEXT NOT NULL,
 author TEXT NOT NULL,
 description TEXT NOT NULL,
 permissions TEXT NOT NULL,
 manifest TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0,
 installed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_settings (
 plugin TEXT NOT NULL,
 key TEXT NOT NULL,
 value TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (plugin, key)
);
`,
  down:`
DROP TABLE IF EXISTS plugin_settings;
DROP TABLE IF EXISTS plugins;
DROP INDEX IF EXISTS idx_webhook_logs_endpoint;
DROP TABLE IF EXISTS webhook_logs;
DROP TABLE IF EXISTS webhook_endpoints;
`}
];