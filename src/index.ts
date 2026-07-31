import http from "http";
import express from "express";
import cors from "cors";
import { config } from "./config";
import { StateManager } from "./state";
import { MqttBridge } from "./mqtt";
import { WsHub } from "./ws";
import { Db } from "./db";
import { sanitizeCommand } from "./failsafe";
import { ROBOT_IDS, isKnownRobot } from "./robots";
import { CommandMsg, RobotId } from "./types";

async function main() {
  const state = new StateManager();
  const db = new Db();
  await db.init();

  // ---- MQTT (device side) ----
  const mqtt = new MqttBridge({
    onTelemetry: (msg) => {
      state.applyTelemetry(msg);
      hub.broadcast(msg); // forward live telemetry to dashboards
    },
    onHeartbeat: (msg) => {
      const before = state.snapshot()[msg.robotId]?.connected;
      state.touch(msg.robotId);
      if (!before) hub.broadcast({ type: "status", robotId: msg.robotId, connected: true });
    },
  });

  // ---- HTTP + REST (presets) ----
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      db: db.ready,
      mqtt: mqtt.connected,
      mqttUrl: config.mqttUrl.replace(/\/\/.*@/, "//"), // no credentials
      mqttError: mqtt.lastError,
      robots: state.snapshot(),
      estop: state.estop,
    });
  });

  app.get("/api/presets", async (req, res) => {
    const robotId = req.query.robotId as RobotId | undefined;
    res.json(await db.listPresets(robotId && isKnownRobot(robotId) ? robotId : undefined));
  });

  app.post("/api/presets", async (req, res) => {
    const { name, robotId, pid } = req.body || {};
    if (!name || !isKnownRobot(robotId) || !pid) {
      return res.status(400).json({ error: "name, robotId, pid required" });
    }
    res.json(await db.addPreset(name, robotId, pid));
  });

  app.delete("/api/presets/:id", async (req, res) => {
    await db.deletePreset(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/history", async (req, res) => {
    const robotId = req.query.robotId as RobotId | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "100", 10) || 100, 500);
    res.json(await db.listHistory(robotId && isKnownRobot(robotId) ? robotId : undefined, limit));
  });

  const server = http.createServer(app);

  // ---- WebSocket (web side) ----
  const hub = new WsHub({
    server,
    getSnapshot: () => ({ type: "state", robots: state.snapshot() }),
    onCommand: (cmd) => handleWebCommand(cmd),
  });

  function handleWebCommand(cmd: CommandMsg) {
    if (cmd.action === "estop") {
      state.estop = true;
      for (const id of ROBOT_IDS) state.setDesired(id, { running: false, gait: "idle" });
      mqtt.broadcastEstop(ROBOT_IDS);
      hub.broadcast({ type: "estop", active: true });
      hub.broadcast({ type: "state", robots: state.snapshot() });
      db.logChange(cmd);
      console.log("[cmd] E-STOP broadcast to all robots");
      return;
    }

    const clean = sanitizeCommand(cmd);
    if (!clean) {
      console.warn("[cmd] rejected", cmd.action, cmd.robotId);
      return;
    }

    // reflect desired state locally
    if (clean.action === "set_setpoint" && clean.payload?.setpoint !== undefined) {
      state.setDesired(clean.robotId, { setpoint: clean.payload.setpoint });
    } else if (clean.action === "set_pid") {
      state.setDesired(clean.robotId, {
        pid: { kp: clean.payload!.kp!, ki: clean.payload!.ki!, kd: clean.payload!.kd! },
      });
    } else if (clean.action === "start") {
      state.setDesired(clean.robotId, { running: true });
    } else if (clean.action === "stop") {
      state.setDesired(clean.robotId, { running: false });
    } else if (clean.action === "set_gait" && clean.payload?.gait) {
      state.setDesired(clean.robotId, { gait: clean.payload.gait });
    }

    mqtt.publishCommand(clean); // forward to ESP32
    db.logChange(clean); // record the change as history
    hub.broadcast({ type: "state", robots: state.snapshot() });
  }

  // ---- Watchdog: auto-disconnect robots that stop reporting ----
  setInterval(() => {
    const dropped = state.markStale(Date.now(), config.watchdogTimeoutMs);
    for (const id of dropped) {
      console.warn(`[watchdog] ${id} went stale -> safe-stop`);
      mqtt.publishCommand({ type: "command", robotId: id, source: "web", action: "stop" });
      hub.broadcast({ type: "status", robotId: id, connected: false });
    }
    if (dropped.length) hub.broadcast({ type: "state", robots: state.snapshot() });
  }, 1000);

  server.listen(config.port, () => {
    console.log(`[http] REST + WebSocket on http://localhost:${config.port} (ws path /ws)`);
  });
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
