// NetClient.js - the connection to a game server.
//
// A thin wrapper over the Colyseus SDK that knows the room protocol from
// @segel/shared/types: it joins a battle room, hands out the welcome, relays
// server events, sends InputCommands and tells the session which ships
// appeared or vanished. No Three.js, no DOM - the same class runs in the
// browser and in the Node tests.

import { Client } from "@colyseus/sdk";
import { MSG } from "@segel/shared";

export const ROOM_BATTLE = "battle";

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
      const room = opts.roomId
         ? await this.client.joinById(opts.roomId, joinOpts)
         : await this.client.joinOrCreate(ROOM_BATTLE, { ...joinOpts, ...(opts.create || {}) });
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
