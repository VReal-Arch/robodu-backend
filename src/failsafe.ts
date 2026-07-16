import { CommandMsg, RobotId } from "./types";
import { SAFE } from "./robots";

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Validate & clamp a command payload to safe ranges before it is forwarded to
 * the ESP32. Returns a sanitized command, or null if it should be rejected.
 */
export function sanitizeCommand(cmd: CommandMsg): CommandMsg | null {
  const safe = SAFE[cmd.robotId];
  if (!safe) return null;

  const out: CommandMsg = { ...cmd, payload: { ...cmd.payload } };
  const p = out.payload!;

  switch (cmd.action) {
    case "set_setpoint":
      if (typeof p.setpoint !== "number" || Number.isNaN(p.setpoint)) return null;
      p.setpoint = clamp(p.setpoint, safe.setMin, safe.setMax);
      return out;

    case "set_pid":
      if (safe.type !== "pid") return null;
      p.kp = clamp(num(p.kp), 0, safe.pidMax.kp);
      p.ki = clamp(num(p.ki), 0, safe.pidMax.ki);
      p.kd = clamp(num(p.kd), 0, safe.pidMax.kd);
      return out;

    case "set_gait":
      if (safe.type !== "humanoid") return null;
      if (!p.gait) return null;
      return out;

    case "start":
    case "stop":
    case "estop":
      return out;

    default:
      return null;
  }
}

function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0;
}
