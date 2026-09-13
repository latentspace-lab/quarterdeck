// ServerBattery.ts - a ship's guns as the server runs them.
//
// The client's Battery does two jobs: it decides (salvo, flight, hit) and it
// shows (flash, smoke, splash, thunder). This is the deciding half only, on
// the shared ballistics. What it produces for the clients are events: a
// `salvo` when the order is given, `shots` with exact origins and velocities
// as the guns go off, and the hit itself comes back through the target ship.

import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import {
   AMMO,
   AMMO_ORDER,
   clamp,
   spawnSalvo,
   dischargeShots,
   stepProjectile,
   checkProjectileHits,
   rangeToTarget,
   muzzlePositions,
   muzzleHeightOf,
   type Rng,
   type Side,
   type Vessel,
   type GunSpec,
   type SalvoShot,
   type Projectile,
   type ProjectileHit,
   type TargetBox,
   type SeaHeightFn,
   type XYZ,
} from "@segel/shared";

const SIDES: Side[] = ["PORT", "STBD"];

export interface BatteryUpdateContext {
   /** sea surface as the guns see it (0.9 scale, like the client) */
   seaHeight: SeaHeightFn;
   /** every ship that can be hit, including the owner (it is skipped by id) */
   targets: TargetBox[];
   /** world matrix of the owner's heeler frame for this tick */
   ownMatrix: Matrix4;
   onShots?(shots: Projectile[]): void;
   onHit?(hit: ProjectileHit): void;
}

export class ServerBattery {
   readonly ownerId: string;
   readonly spec: GunSpec | null;
   readonly enabled: boolean;
   readonly maxRange: number;
   readonly ballWeight: number;
   private readonly muzzles: { PORT: XYZ[]; STBD: XYZ[] };
   private readonly muzzleHeight: number;
   private readonly rng: Rng;

   reload: Record<Side, number> = { PORT: 0, STBD: 0 };
   reloadTime: number;
   ammo = "ball";
   /** share of guns per side still served (damage x crew) */
   effectiveness: Record<Side, number> = { PORT: 1, STBD: 1 };
   shotsFired = 0;
   broadsides = 0;
   /** heel impulse from the recoil (deg) and which way it rolls */
   rollKick = 0;
   rollKickSide = 1;

   private pending: SalvoShot[] = [];
   private shots: Projectile[] = [];
   private readonly _v = new Vector3();
   private readonly _out = new Vector3();

   constructor(ownerId: string, vessel: Vessel, rng: Rng) {
      this.ownerId = ownerId;
      this.rng = rng;
      this.spec = vessel.guns;
      this.enabled = !!(this.spec && this.spec.decks.length);
      this.reloadTime = this.spec ? this.spec.reload : 10;
      this.maxRange = this.spec ? this.spec.range || 500 : 500;
      const lbs = this.spec ? this.spec.decks.map((d) => parseInt(d.calibre, 10) || 12) : [12];
      this.ballWeight = Math.max(...lbs);
      this.muzzles = this.enabled ? muzzlePositions(vessel) : { PORT: [], STBD: [] };
      this.muzzleHeight = this.enabled ? muzzleHeightOf(vessel) : 2.5;
   }

   gunsPerSide(): number {
      return this.muzzles.PORT.length;
   }
   gunsReady(side: Side): number {
      return Math.round(this.gunsPerSide() * clamp(this.effectiveness[side] ?? 1, 0, 1));
   }
   ready(side: Side): boolean {
      return this.enabled && this.reload[side] <= 0;
   }
   setAmmo(id: string): string {
      if (AMMO[id]) this.ammo = id;
      return this.ammo;
   }
   cycleAmmo(): string {
      const i = AMMO_ORDER.indexOf(this.ammo);
      this.ammo = AMMO_ORDER[(i + 1) % AMMO_ORDER.length];
      return this.ammo;
   }
   ammoSpec() {
      return AMMO[this.ammo] || AMMO.ball;
   }
   inFlight(): number {
      return this.shots.length;
   }

   /**
    * Give the order. Returns the salvo (one entry per gun that will fire) or
    * null when the side is not ready or knocked out.
    */
   fire(side: Side, gunnery: number, ownMatrix: Matrix4, targets: Iterable<TargetBox>): SalvoShot[] | null {
      if (!this.ready(side)) return null;
      const muzzleCount = this.muzzles[side].length;
      if (!muzzleCount) return null;
      const nReady = this.gunsReady(side);
      if (nReady <= 0) return null;

      const salvo = spawnSalvo(
         {
            side,
            ammo: this.ammo,
            muzzleCount,
            readyCount: nReady,
            spread: this.spec?.spread || 0.3,
            gunnery,
            rangeToTarget: rangeToTarget(ownMatrix, side, targets, this.maxRange, this.ownerId),
            maxRange: this.maxRange,
            muzzleHeight: this.muzzleHeight,
         },
         this.rng,
      );
      for (const sh of salvo) this.pending.push(sh);

      this.reload[side] = this.reloadTime;
      this.broadsides++;
      this.rollKick = (this.spec?.rollKick || 2) * (nReady / muzzleCount);
      this.rollKickSide = side === "STBD" ? -1 : 1; // the recoil heels her the other way
      return salvo;
   }

   update(dt: number, ctx: BatteryUpdateContext): void {
      if (dt <= 0) return;
      for (const side of SIDES) {
         if (this.reload[side] > 0) this.reload[side] = Math.max(0, this.reload[side] - dt);
      }
      if (this.rollKick > 0.001) this.rollKick = Math.max(0, this.rollKick - dt * 4.2);

      // Guns go off one after another along the side.
      let fired: Projectile[] | null = null;
      for (let i = this.pending.length - 1; i >= 0; i--) {
         const p = this.pending[i];
         p.at -= dt;
         if (p.at > 0) continue;
         this.pending.splice(i, 1);
         if (!this.enabled) continue;
         const out = this.discharge(p, ctx.ownMatrix);
         if (!fired) fired = [];
         fired.push(...out);
      }
      if (fired && fired.length && ctx.onShots) ctx.onShots(fired);

      // Flight and hit test.
      for (let i = this.shots.length - 1; i >= 0; i--) {
         const b = this.shots[i];
         stepProjectile(b, dt);
         const hit = checkProjectileHits(b, ctx.targets, this.maxRange, this.rng, this.ownerId);
         if (hit) {
            this.shots.splice(i, 1);
            if (ctx.onHit) ctx.onHit(hit);
            continue;
         }
         const life = ((b as Projectile & { life?: number }).life ?? 0) + dt;
         (b as Projectile & { life?: number }).life = life;
         if (b.pos.y <= ctx.seaHeight(b.pos.x, b.pos.z) || life > 18) this.shots.splice(i, 1);
      }
   }

   private discharge(p: SalvoShot, ownMatrix: Matrix4): Projectile[] {
      const local = this.muzzles[p.side][p.idx];
      const world = this._v.set(local.x, local.y, local.z).applyMatrix4(ownMatrix);
      // Starboard is -x in the ship frame (bow +z, up +y).
      const out = this._out.set(p.side === "STBD" ? -1 : 1, 0, 0).transformDirection(ownMatrix).normalize();
      const origin = { x: world.x + out.x * 1.6, y: world.y + out.y * 1.6, z: world.z + out.z * 1.6 };
      const shots = dischargeShots(
         { origin, flat: { x: out.x, y: 0, z: out.z }, ammo: p.ammo, aimElev: p.aimElev, aimTrain: p.aimTrain, lb: this.ballWeight },
         this.rng,
      );
      for (const b of shots) this.shots.push(b);
      this.shotsFired++;
      return shots;
   }

   clear(): void {
      this.pending.length = 0;
      this.shots.length = 0;
      this.rollKick = 0;
   }
}
