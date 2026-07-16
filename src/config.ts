import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  mqttUrl: process.env.MQTT_URL || "mqtt://localhost:1883",
  mqttUsername: process.env.MQTT_USERNAME || undefined,
  mqttPassword: process.env.MQTT_PASSWORD || undefined,
  databaseUrl: process.env.DATABASE_URL || "postgres://robodu:robodu@localhost:5432/robodu",
  watchdogTimeoutMs: parseInt(process.env.WATCHDOG_TIMEOUT_MS || "3000", 10),
  topicPrefix: process.env.TOPIC_PREFIX || "robodu",
};
