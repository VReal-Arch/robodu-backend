import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { CommandMsg, ServerMsg } from "./types";

interface Options {
  server: Server;
  onCommand: (cmd: CommandMsg) => void;
  getSnapshot: () => ServerMsg;
}

export class WsHub {
  private wss: WebSocketServer;

  constructor(private opts: Options) {
    this.wss = new WebSocketServer({ server: opts.server, path: "/ws" });

    this.wss.on("connection", (ws) => {
      console.log("[ws] client connected");
      // send current state immediately
      this.send(ws, opts.getSnapshot());

      ws.on("message", (raw) => {
        let data: any;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (data && data.type === "command" && data.robotId && data.action) {
          opts.onCommand(data as CommandMsg);
        }
      });

      ws.on("close", () => console.log("[ws] client disconnected"));
    });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  /** Push a message to every connected dashboard. */
  broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}
