export type RobotId = "ball_beam" | "bi_rotor" | "lin_pend" | "rot_pend" | "humanoid";
export type Gait = "idle" | "stand" | "balance" | "walk";
export type RobotState = "balancing" | "idle" | "fault";

export interface PID {
  kp: number;
  ki: number;
  kd: number;
}

/** Published by ESP32 -> broker -> backend on robodu/{robotId}/telemetry */
export interface TelemetryMsg {
  type: "telemetry";
  robotId: RobotId;
  ts: number;
  setpoint: number;
  actual: number;
  error: number;
  output: number;
  pid: PID;
  imu?: { roll: number; pitch: number };
  state: RobotState;
  health?: { sensor: boolean; motor: boolean };
}

/** Published by ESP32 on robodu/{robotId}/heartbeat (~1 Hz). */
export interface HeartbeatMsg {
  type: "heartbeat";
  robotId: RobotId;
  ts: number;
}

export type CommandAction =
  | "set_setpoint"
  | "set_pid"
  | "start"
  | "stop"
  | "estop"
  | "set_gait";

/** Web -> backend, then backend -> broker -> ESP32 on robodu/{robotId}/command */
export interface CommandMsg {
  type: "command";
  robotId: RobotId;
  source: "web" | "keypad" | "analog";
  action: CommandAction;
  payload?: {
    setpoint?: number;
    kp?: number;
    ki?: number;
    kd?: number;
    gait?: Gait;
  };
}

/** Backend -> web (WebSocket). */
export type ServerMsg =
  | TelemetryMsg
  | { type: "state"; robots: Record<string, PublicRobotState> }
  | { type: "status"; robotId: RobotId; connected: boolean }
  | { type: "estop"; active: boolean };

export interface PublicRobotState {
  robotId: RobotId;
  connected: boolean;
  running: boolean;
  gait: Gait;
  setpoint: number;
  pid: PID;
  last?: TelemetryMsg;
}

export interface Preset {
  id: string;
  name: string;
  robotId: RobotId;
  pid: PID;
  createdAt: number;
}
