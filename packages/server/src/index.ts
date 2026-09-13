// index.ts - the game server.
//
//   npm run server            listens on $PORT or 2567
//
// The same factory serves the tests, which start it on an ephemeral port.

import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BattleRoom } from "./rooms/BattleRoom.ts";

export const ROOM_BATTLE = "battle";

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
   server.define(ROOM_BATTLE, BattleRoom);
   await server.listen(port, host);
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

const runDirectly =
   process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (runDirectly) {
   const port = Number(process.env.PORT) || 2567;
   const host = process.env.HOST || "0.0.0.0";
   const running = await startServer(port, host);
   console.log(`segel-simulator server: ${running.url} (room "${ROOM_BATTLE}")`);
}
