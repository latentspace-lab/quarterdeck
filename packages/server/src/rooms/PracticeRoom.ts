// PracticeRoom.ts - one player against the server's AI.
//
// The same room as a battle - same simulation, same gunnery, same captains -
// with a single seat, so nobody can join your practice, and kept out of the
// lobby list. It is the single-player "battle" played on the server: the
// way to try the multiplayer game alone, and a fallback when no one else is
// online.

import { BattleRoom } from "./BattleRoom.ts";
import type { RoomCreateOptions } from "@quarterdeck/shared";

export class PracticeRoom extends BattleRoom {
   maxClients = 1;
   protected mode = "practice" as const;

   onCreate(options: RoomCreateOptions = {}) {
      super.onCreate(options);
      this.setPrivate(true);
   }
}
