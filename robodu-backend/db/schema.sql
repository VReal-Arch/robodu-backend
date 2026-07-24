-- PostgreSQL schema for ROBODU backend
CREATE TABLE IF NOT EXISTS presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  robot_id   TEXT NOT NULL,
  kp         REAL NOT NULL,
  ki         REAL NOT NULL,
  kd         REAL NOT NULL,
  created_at BIGINT NOT NULL
);

-- Optional: session + telemetry history for analysis / reports
CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  robot_id   TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telemetry_log (
  id         BIGSERIAL PRIMARY KEY,
  robot_id   TEXT NOT NULL,
  ts         BIGINT NOT NULL,
  setpoint   REAL,
  actual     REAL,
  error      REAL,
  output     REAL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_robot_ts ON telemetry_log (robot_id, ts);

-- History of data changes (commands from the dashboard)
CREATE TABLE IF NOT EXISTS command_history (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  robot_id  TEXT NOT NULL,
  source    TEXT NOT NULL,
  action    TEXT NOT NULL,
  payload   JSONB
);
CREATE INDEX IF NOT EXISTS idx_cmdhist_robot_ts ON command_history (robot_id, ts DESC);
