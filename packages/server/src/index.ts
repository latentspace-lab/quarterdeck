// index.ts - the game server.
//
//   npm run server            listens on $PORT or 2567
//
// The same factory serves the tests, which start it on an ephemeral port.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOMS } from "@quarterdeck/shared";
import { BattleRoom } from "./rooms/BattleRoom.ts";
import { PracticeRoom } from "./rooms/PracticeRoom.ts";
import { RegattaRoom } from "./rooms/RegattaRoom.ts";

export const ROOM_BATTLE = ROOMS.battle;
export const ROOM_PRACTICE = ROOMS.practice;
export const ROOM_REGATTA = ROOMS.regatta;

export interface RunningServer {
   server: Server;
   port: number;
   url: string;
   shutdown(): Promise<void>;
}

export interface StartOptions {
   /** Print the Colyseus banner on start (off in tests). */
   greet?: boolean;
}

export async function startServer(
   port = 0,
   host = "127.0.0.1",
   opts: StartOptions = {},
): Promise<RunningServer> {
   const http = createHttpServer();
   const server = new Server({
      transport: new WebSocketTransport({ server: http }),
      greet: opts.greet ?? true,
   });
   server.define(ROOM_BATTLE, BattleRoom).sortBy({ clients: -1 });
   server.define(ROOM_PRACTICE, PracticeRoom);
   server.define(ROOM_REGATTA, RegattaRoom).sortBy({ clients: -1 });
   await server.listen(port, host);
   installLobbyRoute(http);
   const addr = http.address();
   const bound = typeof addr === "object" && addr ? addr.port : port;
   return {
      server,
      port: bound,
      url: `ws://${host}:${bound}`,
      shutdown: async () => {
         await server.gracefullyShutdown(false);
      },
   };
}

/** What the lobby shows per room. */
export interface RoomListing {
   roomId: string;
   clients: number;
   maxClients: number;
   metadata: Record<string, unknown>;
}

/** Battle and regatta rooms with a free seat, for the lobby. */
export async function listBattleRooms(): Promise<RoomListing[]> {
   const [battles, regattas] = await Promise.all([
      matchMaker.query({ name: ROOM_BATTLE, private: false, locked: false }),
      matchMaker.query({ name: ROOM_REGATTA, private: false, locked: false }),
   ]);
   return [...battles, ...regattas].map((r) => ({
      roomId: r.roomId,
      clients: r.clients,
      maxClients: r.maxClients,
      metadata: (r.metadata as Record<string, unknown>) || {},
   }));
}

/**
 * GET /rooms -> JSON RoomListing[]. The 0.18 SDK has no room-listing call and
 * the transport serves no such route, so the lobby fetches this. It is put in
 * front of the transport's own request handling so the two never both answer.
 */
export const LOBBY_ROUTE = "/rooms";
function installLobbyRoute(http: ReturnType<typeof createHttpServer>): void {
   const prior = http.listeners("request") as Array<(req: IncomingMessage, res: ServerResponse) => void>;
   http.removeAllListeners("request");
   http.on("request", (req: IncomingMessage, res: ServerResponse) => {
      const path = (req.url || "/").split("?")[0];
      if (path !== LOBBY_ROUTE) {
         for (const l of prior) l(req, res);
         return;
      }
      const headers = {
         "content-type": "application/json",
         "access-control-allow-origin": "*",
         "access-control-allow-methods": "GET, OPTIONS",
         "cache-control": "no-store",
      };
      if (req.method === "OPTIONS") {
         res.writeHead(204, headers);
         res.end();
         return;
      }
      listBattleRooms().then(
         (rooms) => {
            res.writeHead(200, headers);
            res.end(JSON.stringify(rooms));
         },
         (err) => {
            res.writeHead(500, headers);
            res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
         },
      );
   });
}

const runDirectly =
   process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (runDirectly) {
   const port = Number(process.env.PORT) || 2567;
   const host = process.env.HOST || "0.0.0.0";
   const running = await startServer(port, host);
   console.log(`quarterdeck server: ${running.url} (room "${ROOM_BATTLE}")`);
}
