// NetClient.js - the connection to a game server.
//
// A thin wrapper over the Colyseus SDK that knows the room protocol from
// @segel/shared/types: it joins a battle room, hands out the welcome, relays
// server events, sends InputCommands and tells the session which ships
// appeared or vanished. No Three.js, no DOM - the same class runs in the
// browser and in the Node tests.

import { Client } from "@colyseus/sdk";
import { MSG, ROOMS } from "@segel/shared";

export const ROOM_BATTLE = ROOMS.battle;
export const ROOM_PRACTICE = ROOMS.practice;
export const ROOM_REGATTA = ROOMS.regatta;

/** The server's lobby route (see packages/server/src/index.ts). */
export const LOBBY_ROUTE = "/rooms";

/** ws://host:port -> http://host:port, wss -> https. */
export function httpUrlOf(wsUrl) {
   return String(wsUrl).replace(/^ws(s?):/i, "http$1:").replace(/\/+$/, "");
}

/**
 * The lobby list: battle rooms with a free seat, newest first. Fetched from
 * the server's /rooms route - the 0.18 SDK has no room-listing call.
 * @returns {Promise<Array<{roomId:string, clients:number, maxClients:number, metadata:object}>>}
 */
export async function listRooms(url, fetchFn = globalThis.fetch) {
   const res = await fetchFn(httpUrlOf(url) + LOBBY_ROUTE, { cache: "no-store" });
   if (!res.ok) throw new Error("lobby request failed: " + res.status);
   const rooms = await res.json();
   return (Array.isArray(rooms) ? rooms : [])
      .map((r) => ({ roomId: r.roomId, clients: r.clients, maxClients: r.maxClients, metadata: r.metadata || {} }))
      .sort((a, b) => (b.metadata.createdAt || 0) - (a.metadata.createdAt || 0));
}

/** Default server for a page served from `host`: same host, port 2567. */
export function defaultServerUrl(loc) {
   if (!loc) return "ws://127.0.0.1:2567";
   const proto = loc.protocol === "https:" ? "wss:" : "ws:";
   return `${proto}//${loc.hostname || "127.0.0.1"}:2567`;
}

export class NetClient {
   constructor(url) {
      this.url = url;
      this.client = new Client(url);
      this.room = null;
      this.welcome = null;
      this._events = [];
      this._known = new Set();
      this._onAdd = null;
      this._onRemove = null;
      this._onLeave = null;
   }

   get connected() {
      return !!this.room;
   }
   /** Our ship's id - the server uses the session id, known from the moment we join. */
   get shipId() {
      return this.room ? this.room.sessionId : this.welcome ? this.welcome.shipId : null;
   }
   get roomId() {
      return this.room ? this.room.roomId : null;
   }
   /** The synchronised GameState, or null before the first patch. */
   get state() {
      return this.room ? this.room.state : null;
   }

   /**
    * Join a room. `roomId` joins a specific one, otherwise the first with a
    * free seat is joined or a new one created; `create` (RoomCreateOptions:
    * enemies, wind, seeds) only applies when a room is created.
    * Resolves with the welcome message.
    */
   async join(opts = {}) {
      const joinOpts = { vesselId: opts.vesselId, name: opts.name };
      const create = { ...joinOpts, ...(opts.create || {}) };
      const room = opts.roomId
         ? await this.client.joinById(opts.roomId, joinOpts)
         : opts.mode === "practice"
           ? await this.client.create(ROOM_PRACTICE, create)
           : opts.mode === "regatta"
             ? await this.client.joinOrCreate(ROOM_REGATTA, create)
             : await this.client.joinOrCreate(ROOM_BATTLE, create);
      this.room = room;

      const welcome = new Promise((resolve, reject) => {
         room.onMessage(MSG.welcome, (w) => resolve(w));
         setTimeout(() => reject(new Error("no welcome from the server")), opts.timeoutMs ?? 5000);
      });
      room.onMessage(MSG.event, (e) => this._events.push(e));
      room.onLeave((code) => {
         this.room = null;
         if (this._onLeave) this._onLeave(code);
      });

      // The first state patch can land before the welcome. Ships are only
      // reported once the welcome is in, so the session knows who it is.
      this.welcome = await welcome;
      room.onStateChange(() => this._diffShips());
      this._diffShips();
      return this.welcome;
   }

   /** Called with (id, shipSchema) when a ship appears in the state. */
   onShipAdd(fn) {
      this._onAdd = fn;
      // Ships that arrived before the handler was set are reported now.
      if (this.state && this.state.ships) {
         for (const id of this._known) fn(id, this.state.ships.get(id));
      }
   }
   /** Called with (id) when a ship leaves the state. */
   onShipRemove(fn) {
      this._onRemove = fn;
   }
   /** Called with the close code when the room is gone. */
   onLeave(fn) {
      this._onLeave = fn;
   }

   /** Server events received since the last call. */
   drainEvents() {
      const e = this._events;
      this._events = [];
      return e;
   }
   /** The same, without taking them. */
   peekEvents() {
      return this._events;
   }

   /** Send one InputCommand. */
   send(cmd) {
      if (this.room) this.room.send(MSG.input, cmd);
   }

   async leave() {
      const r = this.room;
      this.room = null;
      if (r) await r.leave(true);
   }

   _diffShips() {
      const ships = this.state && this.state.ships;
      if (!ships) return;
      const seen = new Set();
      ships.forEach((ship, id) => {
         seen.add(id);
         if (!this._known.has(id)) {
            this._known.add(id);
            if (this._onAdd) this._onAdd(id, ship);
         }
      });
      for (const id of [...this._known]) {
         if (!seen.has(id)) {
            this._known.delete(id);
            if (this._onRemove) this._onRemove(id);
         }
      }
   }
}
