-- Schema for Sun City Review Spiffs (Cloudflare D1 / SQLite).
-- Money is integer cents. Dates are 'YYYY-MM-DD'. Timestamps are ISO-8601 UTC strings.

CREATE TABLE departments (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  spiff_type  TEXT    NOT NULL CHECK (spiff_type IN ('install', 'service', 'none')),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE spiff_rules (
  id                   INTEGER PRIMARY KEY,
  spiff_type           TEXT    NOT NULL CHECK (spiff_type IN ('install', 'service')),
  solo_amount_cents    INTEGER NOT NULL CHECK (solo_amount_cents >= 0),
  shared_amount_cents  INTEGER NOT NULL CHECK (shared_amount_cents >= 0),
  effective_from       TEXT    NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at           TEXT    NOT NULL,
  created_by           TEXT    NOT NULL,
  UNIQUE (spiff_type, effective_from)
);

CREATE TABLE employees (
  id             INTEGER PRIMARY KEY,
  full_name      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  department_id  INTEGER NOT NULL REFERENCES departments(id),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT    NOT NULL
);
CREATE INDEX idx_employees_department ON employees(department_id);

CREATE TABLE employee_aliases (
  id           INTEGER PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id),
  alias        TEXT    NOT NULL,
  alias_norm   TEXT    NOT NULL UNIQUE
);
CREATE INDEX idx_aliases_employee ON employee_aliases(employee_id);

CREATE TABLE reviews (
  id                INTEGER PRIMARY KEY,
  customer_name     TEXT    NOT NULL,
  posted_date       TEXT    NOT NULL CHECK (posted_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  review_raw        TEXT    NOT NULL DEFAULT '',
  review_text       TEXT    NOT NULL DEFAULT '',
  review_hash       TEXT,
  word_count        INTEGER NOT NULL DEFAULT 0,
  reply_ai_text     TEXT,
  reply_final_text  TEXT    NOT NULL,
  star_rating       INTEGER CHECK (star_rating IS NULL OR star_rating BETWEEN 1 AND 5),
  job_type_guess    TEXT    NOT NULL DEFAULT 'unknown' CHECK (job_type_guess IN ('install', 'service', 'unknown')),
  services_text     TEXT,
  needs_attention   INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention IN (0, 1)),
  attention_reason  TEXT,
  already_answered  INTEGER NOT NULL DEFAULT 0 CHECK (already_answered IN (0, 1)),
  request_id        TEXT    UNIQUE,
  created_at        TEXT    NOT NULL,
  created_by        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  updated_by        TEXT    NOT NULL
);
CREATE INDEX idx_reviews_posted_date ON reviews(posted_date);
CREATE INDEX idx_reviews_hash ON reviews(review_hash);

CREATE TABLE review_mentions (
  id                        INTEGER PRIMARY KEY,
  review_id                 INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  employee_id               INTEGER NOT NULL REFERENCES employees(id),
  employee_name_snapshot    TEXT    NOT NULL,
  department_name_snapshot  TEXT    NOT NULL,
  spiff_type_snapshot       TEXT    NOT NULL CHECK (spiff_type_snapshot IN ('install', 'service', 'none')),
  mention_text              TEXT,
  amount_cents              INTEGER NOT NULL CHECK (amount_cents >= 0),
  rule_note                 TEXT    NOT NULL DEFAULT '',
  UNIQUE (review_id, employee_id)
);
CREATE INDEX idx_mentions_employee ON review_mentions(employee_id);

CREATE TABLE ai_requests (
  request_id        TEXT    PRIMARY KEY,
  created_at        TEXT    NOT NULL,
  claimed_at        TEXT    NOT NULL,
  created_by        TEXT    NOT NULL,
  status            TEXT    NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  model             TEXT,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  review_hash       TEXT,
  example_ids_used  TEXT,
  response_json     TEXT,
  error             TEXT
);
CREATE INDEX idx_ai_requests_user_time ON ai_requests(created_by, created_at);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT NOT NULL
);

CREATE TABLE reply_examples (
  id             INTEGER PRIMARY KEY,
  customer_name  TEXT,
  review_text    TEXT    NOT NULL,
  reply_text     TEXT    NOT NULL,
  word_count     INTEGER NOT NULL,          -- word count of review_text (drives the length bucket)
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT    NOT NULL
);

CREATE TABLE change_log (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL,
  user_email   TEXT    NOT NULL,
  entity_type  TEXT    NOT NULL CHECK (entity_type IN ('review', 'review_mention', 'employee', 'employee_alias', 'department', 'spiff_rule', 'setting', 'reply_example')),
  entity_id    TEXT,
  action       TEXT    NOT NULL CHECK (action IN ('create', 'update', 'delete', 'deactivate')),
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  summary      TEXT    NOT NULL
);
CREATE INDEX idx_change_log_at ON change_log(at);
CREATE INDEX idx_change_log_user ON change_log(user_email);

-- change_log is append-only: the database itself refuses UPDATE and DELETE.
CREATE TRIGGER change_log_no_update BEFORE UPDATE ON change_log
BEGIN
  SELECT RAISE(ABORT, 'change_log is append-only');
END;

CREATE TRIGGER change_log_no_delete BEFORE DELETE ON change_log
BEGIN
  SELECT RAISE(ABORT, 'change_log is append-only');
END;
