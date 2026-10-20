/** Migration 2; append-only once shipped. No existing records become billable. */
export const billingSchema = `
CREATE TABLE billing_profiles (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), ceiling_micros INTEGER NOT NULL DEFAULT 0 CHECK(ceiling_micros>=0),
 consented_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE billing_assignments (
 resource_kind TEXT NOT NULL CHECK(resource_kind IN ('campaign','account')), resource_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL REFERENCES users(id), assigned_at TEXT NOT NULL,
 PRIMARY KEY(resource_kind,resource_id)
);
CREATE TABLE billing_config (
 id INTEGER PRIMARY KEY AUTOINCREMENT, markup_percent INTEGER NOT NULL CHECK(markup_percent BETWEEN 0 AND 100),
 fee_bps INTEGER NOT NULL CHECK(fee_bps BETWEEN 0 AND 9999), fixed_fee_micros INTEGER NOT NULL CHECK(fixed_fee_micros>=0 AND fixed_fee_micros%10000=0),
 minimum_cents INTEGER NOT NULL CHECK(minimum_cents>=1), proxy_seed_micros INTEGER NOT NULL CHECK(proxy_seed_micros>=0),
 hosting_seed_micros INTEGER NOT NULL CHECK(hosting_seed_micros>=0), created_at TEXT NOT NULL
);
INSERT INTO billing_config VALUES(1,0,290,300000,50,10000000,600000,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE billing_model_rates (
 id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, input_micros_per_million INTEGER NOT NULL CHECK(input_micros_per_million>=0),
 output_micros_per_million INTEGER NOT NULL CHECK(output_micros_per_million>=0), cache_read_micros_per_million INTEGER CHECK(cache_read_micros_per_million>=0),
 cache_write_micros_per_million INTEGER CHECK(cache_write_micros_per_million>=0), verified INTEGER NOT NULL CHECK(verified IN (0,1)), source TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO billing_model_rates(model,input_micros_per_million,output_micros_per_million,verified,source,created_at)
 VALUES('placeholder-update-provider-prices',3000000,15000000,0,'update from the provider''s price page',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE billing_resource_costs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), account_id INTEGER,
 kind TEXT NOT NULL CHECK(kind IN ('proxy_share','hosting_share')), cadence TEXT NOT NULL CHECK(cadence IN ('month','day')),
 amount_micros INTEGER NOT NULL CHECK(amount_micros>=0), start_date TEXT NOT NULL, end_date TEXT,
 reference TEXT NOT NULL CHECK(length(reference)>0), confirmed_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 CHECK((kind='proxy_share' AND account_id IS NOT NULL AND cadence='month') OR (kind='hosting_share' AND account_id IS NULL AND cadence='day'))
);
CREATE TABLE billing_reservations (
 operation_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), provider TEXT NOT NULL CHECK(provider IN ('ai','apify')),
 max_cost_micros INTEGER NOT NULL CHECK(max_cost_micros>0), period_start TEXT NOT NULL, source_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','settled','released')), created_at TEXT NOT NULL,
 actual_cost_micros INTEGER CHECK(actual_cost_micros>=0)
);
CREATE INDEX billing_holds ON billing_reservations(user_id,status);
CREATE TABLE billing_usage_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id), occurred_at TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('apify','ai_input_tokens','ai_output_tokens','proxy_share','hosting_share')),
 quantity INTEGER NOT NULL CHECK(quantity>=0), unit_cost_micros INTEGER NOT NULL CHECK(unit_cost_micros>=0), unit_quantity INTEGER NOT NULL CHECK(unit_quantity>0),
 cost_micros INTEGER NOT NULL CHECK(cost_micros>=0), provider_ref TEXT NOT NULL CHECK(length(provider_ref)>0), source_json TEXT NOT NULL,
 operation_id TEXT REFERENCES billing_reservations(operation_id), created_at TEXT NOT NULL
);
CREATE INDEX billing_usage_user_date ON billing_usage_events(user_id,occurred_at);
CREATE TABLE billing_adjustments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), event_key TEXT NOT NULL UNIQUE,
 cost_micros INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE billing_statements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 breakdown_json TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK(total_cents>=0), carry_micros INTEGER NOT NULL,
 previous_id INTEGER UNIQUE REFERENCES billing_statements(id), created_at TEXT NOT NULL, UNIQUE(user_id,period_start)
);
CREATE TABLE billing_statement_usage (statement_id INTEGER NOT NULL REFERENCES billing_statements(id), event_id INTEGER NOT NULL UNIQUE REFERENCES billing_usage_events(id), PRIMARY KEY(statement_id,event_id));
CREATE TABLE billing_statement_adjustments (statement_id INTEGER NOT NULL REFERENCES billing_statements(id), adjustment_id INTEGER NOT NULL UNIQUE REFERENCES billing_adjustments(id), PRIMARY KEY(statement_id,adjustment_id));
CREATE TABLE billing_checkout_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, statement_id INTEGER NOT NULL REFERENCES billing_statements(id), attempt INTEGER NOT NULL,
 session_id TEXT UNIQUE, session_url TEXT, status TEXT NOT NULL CHECK(status IN ('creating','open','expired','paid')),
 created_at TEXT NOT NULL, UNIQUE(statement_id,attempt)
);
CREATE UNIQUE INDEX billing_one_open_checkout ON billing_checkout_attempts(statement_id) WHERE status IN ('creating','open');
CREATE TABLE billing_webhook_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL);
CREATE TABLE billing_payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, statement_id INTEGER NOT NULL UNIQUE REFERENCES billing_statements(id),
 session_id TEXT NOT NULL UNIQUE, payment_intent_id TEXT NOT NULL UNIQUE, charge_id TEXT UNIQUE,
 amount_cents INTEGER NOT NULL, estimated_fee_micros INTEGER NOT NULL, received_at TEXT NOT NULL
);
CREATE TABLE billing_fee_reconciliations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL UNIQUE REFERENCES billing_payments(id),
 balance_transaction_id TEXT NOT NULL UNIQUE, actual_fee_micros INTEGER NOT NULL CHECK(actual_fee_micros>=0), created_at TEXT NOT NULL
);
CREATE TABLE billing_integration_ack (id INTEGER PRIMARY KEY CHECK(id=1), commit_sha TEXT NOT NULL, acknowledged_by TEXT NOT NULL, verified_at TEXT NOT NULL);
`;

export const immutableBillingTables = ["billing_assignments", "billing_config", "billing_model_rates", "billing_resource_costs", "billing_usage_events", "billing_adjustments", "billing_statements", "billing_statement_usage", "billing_statement_adjustments", "billing_payments", "billing_fee_reconciliations", "billing_webhook_events"];
export const billingImmutability = immutableBillingTables.map(table => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Billing history is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Billing history is append-only'); END;`).join("\n");
