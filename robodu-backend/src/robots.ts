import { PID, RobotId } from "./types";

interface SafeRange {
  id: RobotId;
  type: "pid" | "humanoid";
  setMin: number;
  setMax: number;
  pidMax: PID;
}

/** Safe bounds used by the fail-safe engine to clamp incoming commands. */
export const SAFE: Record<RobotId, SafeRange> = {
  ball_beam: { id: "ball_beam", type: "pid", setMin: -12, setMax: 12, pidMax: { kp: 30, ki: 5, kd: 15 } },
  bi_rotor: { id: "bi_rotor", type: "pid", setMin: -30, setMax: 30, pidMax: { kp: 25, ki: 8, kd: 12 } },
  lin_pend: { id: "lin_pend", type: "pid", setMin: -10, setMax: 10, pidMax: { kp: 40, ki: 5, kd: 12 } },
  rot_pend: { id: "rot_pend", type: "pid", setMin: -8, setMax: 8, pidMax: { kp: 45, ki: 5, kd: 14 } },
  humanoid: { id: "humanoid", type: "humanoid", setMin: 0, setMax: 0, pidMax: { kp: 0, ki: 0, kd: 0 } },
};

export const ROBOT_IDS = Object.keys(SAFE) as RobotId[];

export function isKnownRobot(id: string): id is RobotId {
  return id in SAFE;
}
