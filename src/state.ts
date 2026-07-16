import { Gait, PID, PublicRobotState, RobotId, TelemetryMsg } from "./types";
import { ROBOT_IDS, SAFE } from "./robots";

interface Internal extends PublicRobotState {
  lastSeen: number;
}

/** Single source of truth for the live state of all robots. */
export class StateManager {
  private robots: Record<RobotId, Internal>;
  estop = false;

  constructor() {
    this.robots = {} as Record<RobotId, Internal>;
    for (const id of ROBOT_IDS) {
      this.robots[id] = {
        robotId: id,
        connected: false,
        running: false,
        gait: "idle",
        setpoint: 0,
        pid: { ...SAFE[id].pidMax, kp: 0, ki: 0, kd: 0 },
        lastSeen: 0,
      };
    }
  }

  applyTelemetry(msg: TelemetryMsg) {
    const r = this.robots[msg.robotId];
    if (!r) return;
    r.connected = true;
    r.lastSeen = Date.now();
    r.setpoint = msg.setpoint;
    r.pid = msg.pid;
    r.running = msg.state === "balancing";
    r.last = msg;
  }

  touch(id: RobotId) {
    const r = this.robots[id];
    if (r) {
      r.connected = true;
      r.lastSeen = Date.now();
    }
  }

  setDesired(id: RobotId, patch: Partial<Pick<PublicRobotState, "setpoint" | "pid" | "running" | "gait">>) {
    const r = this.robots[id];
    if (!r) return;
    Object.assign(r, patch);
  }

  setConnected(id: RobotId, connected: boolean) {
    const r = this.robots[id];
    if (r) r.connected = connected;
  }

  markStale(now: number, timeoutMs: number): RobotId[] {
    const dropped: RobotId[] = [];
    for (const id of ROBOT_IDS) {
      const r = this.robots[id];
      if (r.connected && r.lastSeen > 0 && now - r.lastSeen > timeoutMs) {
        r.connected = false;
        r.running = false;
        r.gait = "idle";
        dropped.push(id);
      }
    }
    return dropped;
  }

  snapshot(): Record<string, PublicRobotState> {
    const out: Record<string, PublicRobotState> = {};
    for (const id of ROBOT_IDS) {
      const { lastSeen, ...pub } = this.robots[id];
      out[id] = pub;
    }
    return out;
  }
}
