import mqtt, { MqttClient } from "mqtt";
import { config } from "./config";
import { CommandMsg, HeartbeatMsg, RobotId, TelemetryMsg } from "./types";
import { isKnownRobot } from "./robots";

interface Handlers {
  onTelemetry: (msg: TelemetryMsg) => void;
  onHeartbeat: (msg: HeartbeatMsg) => void;
}

const P = config.topicPrefix;

export class MqttBridge {
  private client: MqttClient;

  constructor(handlers: Handlers) {
    this.client = mqtt.connect(config.mqttUrl, {
      username: config.mqttUsername,
      password: config.mqttPassword,
      reconnectPeriod: 2000,
    });

    this.client.on("connect", () => {
      console.log(`[mqtt] connected to ${config.mqttUrl}`);
      this.client.subscribe([`${P}/+/telemetry`, `${P}/+/heartbeat`], (err) => {
        if (err) console.error("[mqtt] subscribe error", err);
        else console.log(`[mqtt] subscribed to ${P}/+/telemetry, ${P}/+/heartbeat`);
      });
    });

    this.client.on("error", (e) => console.error("[mqtt] error", e.message));
    this.client.on("reconnect", () => console.log("[mqtt] reconnecting..."));

    this.client.on("message", (topic, buf) => {
      const parts = topic.split("/"); // robodu/{id}/{kind}
      const id = parts[1];
      const kind = parts[2];
      if (!isKnownRobot(id)) return;
      let data: any;
      try {
        data = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (kind === "telemetry") {
        handlers.onTelemetry({ ...data, type: "telemetry", robotId: id as RobotId });
      } else if (kind === "heartbeat") {
        handlers.onHeartbeat({ type: "heartbeat", robotId: id as RobotId, ts: data.ts ?? Date.now() });
      }
    });
  }

  publishCommand(cmd: CommandMsg) {
    const topic = `${P}/${cmd.robotId}/command`;
    this.client.publish(topic, JSON.stringify(cmd), { qos: 1 });
  }

  /** Broadcast an e-stop command to every robot. */
  broadcastEstop(ids: RobotId[]) {
    for (const id of ids) {
      this.publishCommand({ type: "command", robotId: id, source: "web", action: "estop" });
    }
  }
}
