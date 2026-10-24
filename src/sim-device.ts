/**
 * Mock ESP32 fleet for testing the pipeline without hardware.
 * Each virtual robot runs the PID plant sim locally (as the real firmware
 * would), publishes telemetry over MQTT, and obeys incoming commands.
 *
 *   npm run mock
 */
import mqtt from "mqtt";
import { config } from "./config";
import { CommandMsg, Gait, PID, RobotId, RobotState, TelemetryMsg } from "./types";

const P = config.topicPrefix;
const DT = 0.05;

// Homing mirrors the master firmware: kits whose id starts with one of these types
// must be homed before START is accepted (HOMING_TYPES in robodu-master.ino).
//   MOCK_HOMING_TYPES  comma list of types      (default "rot_pend")
//   MOCK_HOMING_MS     how long homing takes    (default 4000)
//   MOCK_HOMING_FAIL   comma list of robot ids whose homing always fails, to test
//                      the failure path        (e.g. "rot_pend_2")
const HOMING_TYPES = (process.env.MOCK_HOMING_TYPES ?? "rot_pend").split(",").map((x) => x.trim()).filter(Boolean);
const HOMING_MS = parseInt(process.env.MOCK_HOMING_MS || "4000", 10);
const HOMING_FAIL = (process.env.MOCK_HOMING_FAIL ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface PlantCfg {
  id: RobotId;
  type: "pid" | "humanoid";
  yMin: number;
  yMax: number;
  uMax: number;
  unstable: number;
  ctrl: number;
  damp: number;
  vMax: number;
  iMax: number;
  pidDef: PID;
  dist: number;
}

const TYPE_PLANTS: PlantCfg[] = [
  { id: "ball_beam", type: "pid", yMin: -15, yMax: 15, uMax: 30, unstable: 0, ctrl: 1.6, damp: 0.35, vMax: 70, iMax: 40, pidDef: { kp: 4, ki: 0.2, kd: 2.6 }, dist: 7 },
  { id: "bi_rotor", type: "pid", yMin: -40, yMax: 40, uMax: 100, unstable: 0, ctrl: 0.9, damp: 0.85, vMax: 130, iMax: 60, pidDef: { kp: 3, ki: 0.5, kd: 1.4 }, dist: 16 },
  { id: "lin_pend", type: "pid", yMin: -25, yMax: 25, uMax: 100, unstable: 9, ctrl: 1.2, damp: 0.25, vMax: 220, iMax: 30, pidDef: { kp: 13, ki: 0, kd: 3 }, dist: 10 },
  { id: "rot_pend", type: "pid", yMin: -25, yMax: 25, uMax: 100, unstable: 11, ctrl: 1.3, damp: 0.22, vMax: 240, iMax: 30, pidDef: { kp: 15, ki: 0, kd: 3.4 }, dist: 9 },
  { id: "humanoid", type: "humanoid", yMin: -15, yMax: 15, uMax: 0, unstable: 0, ctrl: 0, damp: 0, vMax: 0, iMax: 0, pidDef: { kp: 0, ki: 0, kd: 0 }, dist: 0 },
];

// expand each type into 3 units: ball_beam_1, ball_beam_2, ...
const UNITS_PER_TYPE = 3;
const PLANTS: PlantCfg[] = TYPE_PLANTS.flatMap((t) =>
  Array.from({ length: UNITS_PER_TYPE }, (_, i) => ({ ...t, id: `${t.id}_${i + 1}` }))
);

interface Sim {
  cfg: PlantCfg;
  setpoint: number;
  pid: PID;
  running: boolean;
  gait: Gait;
  y: number;
  yd: number;
  I: number;
  pe: number;
  u: number;
  disturb: number;
  roll: number;
  pitch: number;
  needsHoming: boolean;
  homed: boolean;
  homingActive: boolean;
  homingFailed: boolean;
  homingStart: number;
}

const sims: Record<string, Sim> = {};
for (const cfg of PLANTS) {
  const needsHoming = HOMING_TYPES.some((t) => cfg.id.startsWith(t));
  sims[cfg.id] = {
    cfg,
    setpoint: 0,
    pid: { ...cfg.pidDef },
    // a kit that needs homing starts stopped, like the real firmware
    running: cfg.type === "pid" && !needsHoming,
    gait: "balance",
    y: (Math.random() - 0.5) * 2,
    yd: 0,
    I: 0,
    pe: 0,
    u: 0,
    disturb: (Math.random() - 0.5) * cfg.dist,
    roll: 0,
    pitch: 0,
    needsHoming,
    homed: false,
    homingActive: false,
    homingFailed: false,
    homingStart: 0,
  };
}

const client = mqtt.connect(config.mqttUrl, {
  username: config.mqttUsername,
  password: config.mqttPassword,
  reconnectPeriod: 2000,
});

client.on("connect", () => {
  console.log(`[mock] connected to ${config.mqttUrl}`);
  client.subscribe(`${P}/+/command`);
});

client.on("message", (topic, buf) => {
  const id = topic.split("/")[1];
  const s = sims[id];
  if (!s) return;
  let cmd: CommandMsg;
  try {
    cmd = JSON.parse(buf.toString());
  } catch {
    return;
  }
  const p = cmd.payload || {};
  switch (cmd.action) {
    case "set_setpoint":
      if (typeof p.setpoint === "number") s.setpoint = p.setpoint;
      break;
    case "set_pid":
      s.pid = { kp: p.kp ?? s.pid.kp, ki: p.ki ?? s.pid.ki, kd: p.kd ?? s.pid.kd };
      break;
    case "homing":
      // same refusals as the firmware: not a homing kit / already homing / running
      if (!s.needsHoming || s.homingActive || s.running) break;
      s.homed = false;
      s.homingFailed = false;
      s.homingActive = true;
      s.homingStart = Date.now();
      console.log(`[mock] ${id}: homing started`);
      break;
    case "start":
      if (s.needsHoming && !s.homed) break; // firmware: "start ditolak: belum homing"
      s.running = true;
      break;
    case "stop":
    case "estop":
      if (s.homingActive) {
        // stop cancels a running homing and drops the zero position
        s.homingActive = false;
        s.homed = false;
        console.log(`[mock] ${id}: homing cancelled`);
      }
      s.running = false;
      if (s.cfg.type === "humanoid") s.gait = "idle";
      break;
    case "set_gait":
      if (p.gait) s.gait = p.gait;
      break;
  }
});

function stepPid(s: Sim) {
  const c = s.cfg;
  if (s.homingActive) {
    // the slave drives the arm to the reference point: settle toward zero
    s.yd *= 0.9;
    s.y *= 0.97;
    s.u = 0;
    return;
  }
  if (!s.running) {
    if (c.unstable > 0) {
      const ydd = c.unstable * s.y - c.damp * s.yd;
      s.yd += ydd * DT;
      s.y = clamp(s.y + s.yd * DT, c.yMin * 1.25, c.yMax * 1.25);
    } else {
      s.yd *= 0.94;
      s.y = clamp(s.y + s.yd * DT, c.yMin * 1.25, c.yMax * 1.25);
    }
    s.u = 0;
    return;
  }
  const e = s.setpoint - s.y;
  const sat = Math.abs(s.u) >= c.uMax * 0.99;
  if (!(sat && Math.sign(e) === Math.sign(s.I))) s.I = clamp(s.I + e * DT, -c.iMax, c.iMax);
  const de = (e - s.pe) / DT;
  s.pe = e;
  s.u = clamp(s.pid.kp * e + s.pid.ki * s.I + s.pid.kd * de, -c.uMax, c.uMax);
  const ydd = c.unstable * s.y + c.ctrl * s.u - c.damp * s.yd + s.disturb;
  s.disturb *= 0.82;
  s.yd = clamp(s.yd + ydd * DT, -c.vMax, c.vMax);
  s.y = clamp(s.y + s.yd * DT, c.yMin * 1.3, c.yMax * 1.3);
}

// physics @ 20 Hz
setInterval(() => {
  for (const s of Object.values(sims)) {
    if (s.homingActive && Date.now() - s.homingStart >= HOMING_MS) {
      s.homingActive = false;
      if (HOMING_FAIL.includes(s.cfg.id)) {
        s.homed = false;
        s.homingFailed = true;
        console.log(`[mock] ${s.cfg.id}: homing FAILED (simulated)`);
      } else {
        s.homed = true;
        console.log(`[mock] ${s.cfg.id}: homing done`);
      }
    }
    if (s.cfg.type === "pid") stepPid(s);
    else {
      const active = s.gait !== "idle";
      s.roll = active ? clamp(s.roll + (Math.random() - 0.5) * 2 - s.roll * 0.12, -14, 14) : s.roll * 0.9;
      s.pitch = active ? clamp(s.pitch + (Math.random() - 0.5) * 2 - s.pitch * 0.12, -14, 14) : s.pitch * 0.9;
    }
  }
}, DT * 1000);

// disturbance impulses
setInterval(() => {
  for (const s of Object.values(sims)) {
    if (s.cfg.type === "pid" && s.running && Math.random() < 0.5) {
      s.disturb += (Math.random() - 0.5) * s.cfg.dist;
    }
  }
}, 3500);

// publish telemetry @ 20 Hz + heartbeat @ 1 Hz
setInterval(() => {
  for (const s of Object.values(sims)) {
    const state: RobotState =
      s.cfg.type === "humanoid"
        ? s.gait === "idle" ? "idle" : "balancing"
        : s.homingActive ? "homing"
        : s.running ? "balancing"
        : "idle";
    const msg: TelemetryMsg = {
      type: "telemetry",
      robotId: s.cfg.id,
      ts: Date.now(),
      setpoint: s.setpoint,
      actual: s.cfg.type === "humanoid" ? s.roll : s.y,
      error: s.cfg.type === "humanoid" ? 0 : s.setpoint - s.y,
      output: s.u,
      pid: s.pid,
      imu: { roll: s.roll, pitch: s.pitch },
      state,
      health: { sensor: true, motor: true },
    };
    // like the firmware: only kits that need homing report these two fields
    if (s.needsHoming) {
      msg.homed = s.homed;
      msg.homingFailed = s.homingFailed;
    }
    client.publish(`${P}/${s.cfg.id}/telemetry`, JSON.stringify(msg));
  }
}, DT * 1000);

setInterval(() => {
  for (const s of Object.values(sims)) {
    client.publish(`${P}/${s.cfg.id}/heartbeat`, JSON.stringify({ type: "heartbeat", robotId: s.cfg.id, ts: Date.now() }));
  }
}, 1000);

console.log("[mock] 5 virtual ESP32 robots running - publishing telemetry");
if (HOMING_TYPES.length) console.log(`[mock] homing required before start: ${HOMING_TYPES.join(", ")} (${HOMING_MS} ms)`);
