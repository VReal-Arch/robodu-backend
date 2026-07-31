import { PID, RobotId } from "./types";

export const UNITS_PER_TYPE = 3;

export type RobotFamily = "ball_beam" | "bi_rotor" | "lin_pend" | "rot_pend" | "humanoid";

interface SafeRange {
  id: RobotId;
  family: RobotFamily;
  unit: number;
  type: "pid" | "humanoid";
  setMin: number;
  setMax: number;
  pidMax: PID;
}

// Safe bounds per TYPE; expanded into units below.
const TYPES: { family: RobotFamily; type: "pid" | "humanoid"; setMin: number; setMax: number; pidMax: PID }[] = [
  { family: "ball_beam", type: "pid", setMin: -12, setMax: 12, pidMax: { kp: 30, ki: 5, kd: 15 } },
  { family: "bi_rotor", type: "pid", setMin: -30, setMax: 30, pidMax: { kp: 25, ki: 8, kd: 12 } },
  { family: "lin_pend", type: "pid", setMin: -10, setMax: 10, pidMax: { kp: 40, ki: 5, kd: 12 } },
  { family: "rot_pend", type: "pid", setMin: -8, setMax: 8, pidMax: { kp: 45, ki: 5, kd: 14 } },
  { family: "humanoid", type: "humanoid", setMin: 0, setMax: 0, pidMax: { kp: 0, ki: 0, kd: 0 } },
];

export const SAFE: Record<string, SafeRange> = {};
for (const t of TYPES) {
  for (let u = 1; u <= UNITS_PER_TYPE; u++) {
    const id = `${t.family}_${u}`;
    SAFE[id] = { id, family: t.family, unit: u, type: t.type, setMin: t.setMin, setMax: t.setMax, pidMax: t.pidMax };
  }
}

export const ROBOT_IDS = Object.keys(SAFE) as RobotId[];

export function isKnownRobot(id: string): id is RobotId {
  return id in SAFE;
}
