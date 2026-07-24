# ROBODU Backend

Jembatan antara 5 trainer kit (ESP32) dan web dashboard.

```
ESP32 ×5  ──MQTT──►  Broker (Mosquitto)  ──►  Backend (ini)  ──WebSocket──►  Dashboard
          ◄─MQTT──                            + PostgreSQL
```

- **MQTT** untuk sisi device (ESP32 publish telemetry, subscribe command)
- **WebSocket** untuk sisi web (push telemetry real-time ke dashboard)
- **PostgreSQL** untuk menyimpan preset PID (opsional: log sesi & telemetry)
- **Fail-safe**: watchdog per robot, validasi/clamp command, e-stop broadcast

## Menjalankan

**1. Nyalakan broker + database** (paling gampang pakai Docker):

```bash
docker compose up -d      # Mosquitto :1883, PostgreSQL :5432
```

**2. Jalankan backend:**

```bash
cp .env.example .env
npm install
npm run dev               # REST + WebSocket di http://localhost:4000  (ws: /ws)
```

**3. Tes tanpa hardware** — jalankan 5 ESP32 palsu di terminal lain:

```bash
npm run mock              # publish telemetry + patuh command via MQTT
```

Buka dashboard → data langsung mengalir. Backend tetap jalan walau broker/DB belum nyala (MQTT auto-reconnect, preset nonaktif kalau DB mati).

## Struktur

```
src/
  index.ts       wiring semua: MQTT + WS + REST + watchdog
  config.ts      env config
  types.ts       kontrak pesan (telemetry / command / heartbeat)
  robots.ts      batas aman tiap robot (buat clamp)
  state.ts       state manager (single source of truth)
  failsafe.ts    validasi & clamp command
  mqtt.ts        MQTT client (subscribe telemetry, publish command)
  ws.ts          WebSocket hub (broadcast ke dashboard)
  db.ts          PostgreSQL (preset CRUD)
  sim-device.ts  5 ESP32 palsu buat testing
db/schema.sql    tabel PostgreSQL
docker-compose.yml
```

## Topic MQTT

| Topic                          | Arah                | Isi                     |
| ------------------------------ | ------------------- | ----------------------- |
| `robodu/{robotId}/telemetry`   | ESP32 → backend     | data sensor + output    |
| `robodu/{robotId}/heartbeat`   | ESP32 → backend     | penanda hidup (~1 Hz)   |
| `robodu/{robotId}/command`     | backend → ESP32     | setpoint, PID, start... |

`robotId`: `ball_beam`, `bi_rotor`, `lin_pend`, `rot_pend`, `humanoid`.

## REST API

| Method | Endpoint             | Fungsi                    |
| ------ | -------------------- | ------------------------- |
| GET    | `/health`            | status server + robot     |
| GET    | `/api/presets`       | daftar preset PID         |
| POST   | `/api/presets`       | simpan preset             |
| DELETE | `/api/presets/:id`   | hapus preset              |
| GET    | `/api/history`       | history perubahan data    |

Setiap perubahan data dari dashboard (setpoint, PID, start/stop, e-stop, gait)
otomatis direkam ke tabel `command_history` di PostgreSQL sebagai riwayat.

## WebSocket (dashboard ↔ backend)

- Backend → web: `telemetry`, `state` (snapshot), `status`, `estop`
- Web → backend: `command` (`set_setpoint` | `set_pid` | `start` | `stop` | `estop` | `set_gait`)

Semua command dari web divalidasi & di-clamp ke rentang aman sebelum diteruskan ke ESP32.

## Catatan firmware (ESP32)

Tiap ESP32 menjalankan loop PID sendiri (lokal, real-time). Backend hanya kirim
setpoint + gain dan menerima telemetry — **PID tidak dihitung di backend**.
Contoh pesan telemetry yang harus dipublish ESP32 ada di `src/types.ts`.
