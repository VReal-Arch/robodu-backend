import { Pool } from "pg";
import { config } from "./config";
import { CommandMsg, PID, Preset, RobotId } from "./types";

export class Db {
  private pool: Pool | null = null;
  ready = false;

  async init() {
    try {
      // Managed Postgres (Supabase, Neon, ...) requires TLS. Local Docker does not.
      const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
        max: 5, // stay well under Supabase's free-tier connection limit
      });
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS presets (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          robot_id   TEXT NOT NULL,
          kp         REAL NOT NULL,
          ki         REAL NOT NULL,
          kd         REAL NOT NULL,
          created_at BIGINT NOT NULL
        );
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS command_history (
          id        BIGSERIAL PRIMARY KEY,
          ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
          robot_id  TEXT NOT NULL,
          source    TEXT NOT NULL,
          action    TEXT NOT NULL,
          payload   JSONB
        );
      `);
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS idx_cmdhist_robot_ts ON command_history (robot_id, ts DESC);`
      );
      this.ready = true;
      console.log("[db] PostgreSQL connected");
    } catch (e) {
      this.ready = false;
      console.warn("[db] PostgreSQL unavailable - presets disabled:", (e as Error).message);
    }
  }

  async listPresets(robotId?: RobotId): Promise<Preset[]> {
    if (!this.pool) return [];
    const q = robotId
      ? await this.pool.query("SELECT * FROM presets WHERE robot_id=$1 ORDER BY created_at DESC", [robotId])
      : await this.pool.query("SELECT * FROM presets ORDER BY created_at DESC");
    return q.rows.map((r) => ({
      id: r.id,
      name: r.name,
      robotId: r.robot_id,
      pid: { kp: r.kp, ki: r.ki, kd: r.kd },
      createdAt: Number(r.created_at),
    }));
  }

  async addPreset(name: string, robotId: RobotId, pid: PID): Promise<Preset> {
    const preset: Preset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      robotId,
      pid,
      createdAt: Date.now(),
    };
    if (this.pool) {
      await this.pool.query(
        "INSERT INTO presets(id,name,robot_id,kp,ki,kd,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [preset.id, preset.name, preset.robotId, pid.kp, pid.ki, pid.kd, preset.createdAt]
      );
    }
    return preset;
  }

  async deletePreset(id: string): Promise<void> {
    if (this.pool) await this.pool.query("DELETE FROM presets WHERE id=$1", [id]);
  }

  /** Record a data change (command) as history. */
  async logChange(cmd: CommandMsg): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        "INSERT INTO command_history(robot_id, source, action, payload) VALUES($1,$2,$3,$4)",
        [cmd.robotId, cmd.source, cmd.action, cmd.payload ? JSON.stringify(cmd.payload) : null]
      );
    } catch {
      /* never let logging crash the command path */
    }
  }

  async listHistory(robotId?: RobotId, limit = 100) {
    if (!this.pool) return [];
    const q = robotId
      ? await this.pool.query(
          "SELECT robot_id, source, action, payload, ts FROM command_history WHERE robot_id=$1 ORDER BY ts DESC LIMIT $2",
          [robotId, limit]
        )
      : await this.pool.query(
          "SELECT robot_id, source, action, payload, ts FROM command_history ORDER BY ts DESC LIMIT $1",
          [limit]
        );
    return q.rows;
  }
}
