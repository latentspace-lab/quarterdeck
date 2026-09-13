// physics.js - Semi-realistische Segel-Physik (reine Funktionen + Zustandsklasse)
//
// Grundidee (klassisches "point-and-go" Modell):
//    - Der Spieler steuert den Kurs (Ruder).
//    - Der Segelkurs (TWA = True Wind Angle) ergibt sich aus Bootskurs und Windrichtung.
//    - Boots- und Segelgeschwindigkeit folgt einer Polarkurve in Abhaengigkeit von
//      TWA, Windstaerke (Knoten), Segeltrimmung und Gier (Heel).
//    - VMG (Velocity Made Good) zeigt, wie gut der Fortschritt in Richtung Wind ist.
//
// Einheiten: Winkel in Grad, Speed in Knoten. Welt: X=Ost, Z=Nord, Y=hoch.

import {
   DEG,
   RAD,
   clamp,
   lerp,
   diffDeg,
   normDeg,
   dirVec,
   interpTable,
} from "./utils.js";

// ---- Konstanten -------------------------------------------------------------
export const NO_GO_DEG = 32; // No-Go-Zone: < 32° TWA kann man nicht hinaufsegen

// Polar-Kurve bei 15 Knoten Wind (Speed in Knoten, TWA in Grad).
export const POLAR_15KTS = [
   [0, 0.0], [10, 0.0], [20, 0.6], [30, 2.5], [35, 4.8], [40, 6.2], [45, 7.2],
   [50, 8.0], [60, 9.4], [75, 10.4], [90, 10.8], [105, 11.2], [115, 11.0],
   [130, 10.2], [145, 8.8], [160, 6.9], [175, 5.2], [180, 4.4],
];

// Windförderskala: unter 15 kn sublinear, darüber moderat wachsend.
export function windScale(W) {
   if (W <= 15) return Math.pow(clamp(W / 15, 0.05, 1), 0.6);
   return clamp(1 + (W - 15) * 0.028, 1, 2.45);
}

// ---- Polarauswertung --------------------------------------------------------
export function polarSpeedAt(twa, windKts, trimEff = 1, heelPenalty = 1, polar = POLAR_15KTS) {
   const t = Math.abs(normDeg(twa));
   const ref = interpTable(t, polar);
   return clamp(ref * windScale(windKts) * trimEff * heelPenalty, 0, 42);
}

// Optimale Segeltrimmung 0 (ausgeholt) .. 1 (geholt)
export function optimalTrim(twa, noGo = NO_GO_DEG) {
   return clamp(lerp(1.0, 0.0, (Math.abs(normDeg(twa)) - noGo + 2) / (180 - noGo + 2)), 0.05, 1);
}
export function trimEfficiency(actualTrim, optTrim) {
   return clamp(1 - Math.abs(actualTrim - optTrim) * 0.7, 0.45, 1);
}

// ---- Apparent Wind (Sichtbarer Wind) ---------------------------------------
export function apparentWind(trueWindDeg, trueWindKts, boatHeading, boatSpeedKts) {
   const wFrom = dirVec(trueWindDeg);
   const windToward = { x: -wFrom.x * trueWindKts, z: -wFrom.z * trueWindKts };
   const bF = dirVec(boatHeading);
   const boatVel = { x: bF.x * boatSpeedKts, z: bF.z * boatSpeedKts };
   const rel = { x: windToward.x - boatVel.x, z: windToward.z - boatVel.z };
   const speed = Math.hypot(rel.x, rel.z);
    // "from"-Richtung = Gegenvorrichtung zum Luftstrom (woher der Wind kommt)
   const fromVec = { x: boatVel.x - windToward.x, z: boatVel.z - windToward.z };
   const from = normDeg(Math.atan2(fromVec.x, fromVec.z) * RAD);
   return { speed, from };
}

// TWA signed: <0 Wind von Backbord (Port), >0 von Steuerbord (Stbd)
export function twa(boatHeading, trueWindDeg) {
   return diffDeg(boatHeading, trueWindDeg); // diffDeg(a,b) = b - a
}
export function tackFromTwa(twaSigned) {
   return twaSigned > 0 ? "STBD" : "PORT";
}

// ---- Segelkurse / Punkte von Sail ------------------------------------------
export function pointOfSail(twaDeg, luffing = false, rig = "bermuda", noGo = NO_GO_DEG) {
   const t = Math.abs(twaDeg);
   if (rig === "square") {
      if (luffing || t < noGo) return "Im Wind / back (kein Vortrieb)";
      if (t < noGo + 14) return "Hart am Wind (Close-Hauled)";
      if (t < 100) return "Halber Wind (Soldier's Wind)";
      if (t < 140) return "Backstagsbrise (Broad Reach)";
      if (t < 168) return "Raumschots (Running)";
      return "Platt vor dem Laken";
   }
   if (luffing || t < noGo) return "No-Go-Zone (Backen)";
   if (t < 55) return "Krausen (Close-Hauled)";
   if (t < 85) return "Nahraumschot (Naher Reach)";
   if (t < 110) return "Breitraumschot (Breiter Reach)";
   if (t < 150) return "Groesserer Raumschot";
   if (t < 172) return "Vollraumschot (Running)";
   return "Vor dem Wind";
}

// Backen (Luffing): Wind in No-Go-Zone oder zu wenig Wind -> kein Vortrieb
export function isLuffing(twaDeg, windKts = -1, noGo = NO_GO_DEG) {
   if (windKts >= 0 && windKts < 0.4) return true;
   return Math.abs(twaDeg) < noGo;
}

// VMG in Up-/Downwind-Richtung
export function vmgUp(twaDeg, speedKts) {
   const t = Math.abs(twaDeg);
   return t < 90 ? speedKts * Math.cos(t * DEG) : 0;
}
export function vmgDown(twaDeg, speedKts) {
   const t = Math.abs(twaDeg);
   return t > 91 ? speedKts * Math.abs(Math.cos(t * DEG)) : 0;
}

// Gier (Heel)
const HEEL_TABLE = [
   [0, 0.15], [20, 0.2], [35, 0.7], [45, 1.0], [55, 0.95],
   [70, 0.75], [90, 0.55], [130, 0.4], [160, 0.25], [180, 0.12],
];
export function heelTarget(twa, windKts, maxHeel = 24, scale = 1) {
   const f = interpTable(Math.abs(normDeg(twa)), HEEL_TABLE);
   const w = clamp((windKts - 5) / 25, 0, 1.4);
   return clamp(f * (0.35 + w) * maxHeel * scale, 0, 55);
}
export function heelPenalty(heelDeg, capsizeHeel = 32) {
   if (heelDeg < 12) return 1;
   return clamp(1 - 0.6 * ((heelDeg - 12) / (capsizeHeel - 12)), 0.2, 1);
}

// ---- Ruder-/Kursdynamik ----------------------------------------------------
export function rudderAuthority(speedKts, refKts = 4) {
   return clamp(speedKts / refKts, 0.12, 1);
}

// Standard-Profil (moderne Yacht) - wird von einem Vessel-Eintrag ueberschrieben.
export const DEFAULT_PROFILE = {
   rig: "bermuda",
   noGo: NO_GO_DEG,
   polar: POLAR_15KTS,
   turnRate: 38,
   rudderRef: 4,
   accelUp: 0.45,
   accelDown: 1.1,
   accelLuff: 1.6,
   maxHeel: 24,
   capsizeHeel: 32,
   heelScale: 1,
   leewayMax: 7,
   tackAssist: 0,
};

// Aus einem Vessel-Eintrag (vessels.js) ein Dynamik-Profil machen.
export function profileFromVessel(v) {
   if (!v) return { ...DEFAULT_PROFILE };
   return {
      ...DEFAULT_PROFILE,
      rig: v.rig || DEFAULT_PROFILE.rig,
      noGo: v.sail?.noGo ?? DEFAULT_PROFILE.noGo,
      polar: v.sail?.polar ?? DEFAULT_PROFILE.polar,
      tackAssist: v.sail?.tackAssist ?? 0,
      ...(v.dyn || {}),
   };
}

export class BoatDynamics {
   constructor(opts = {}) {
      this.profile = opts.vessel ? profileFromVessel(opts.vessel)
         : { ...DEFAULT_PROFILE, ...(opts.profile || {}) };
      this.vessel = opts.vessel || null;
      this.heading = opts.heading ?? 0;
      this.speed = 0;
      this.heel = 0;
      this.heelLerp = 0;
      this.rudder = 0;
      this.trim = opts.trim ?? 0.5;
      this.twa = 0;
      this.twaSigned = 0;
      this.tack = "PORT";
      this.pos = { x: opts.x ?? 0, z: opts.z ?? 0 };
      this.boatVel = { x: 0, z: 0 };
      this.isCapsized = false;
      this.capsizeTimer = 0;
      this.luffing = false;
      this.leeway = 0;
      this.groundHeading = this.heading;
      this.optTrim = 0.5;
      this.heelMaxSeen = 0;
      // Segelflaeche 0.25..1 (Reffen). Nur bei Rahseglern wirksam - eine Yacht
      // trimmt statt zu reffen.
      this.sailSet = 1;
      // Von aussen gesetzte Faktoren aus dem Schadensmodell (1 = unbeschaedigt):
      //   driveMul  - verbliebene Segelkraft (Masten, Tuch, Tauwerk)
      //   rudderMul - Ruderwirkung
      //   dragMul   - zusaetzlicher Widerstand (Wasser im Schiff, Wrack im Schlepp)
      //   turnBias  - staendiges Gieren, z. B. durch ein Wrack an einer Seite
      //   heelBias  - Schlagseite durch Wassereinbruch (Grad)
      this.driveMul = 1;
      this.rudderMul = 1;
      this.dragMul = 1;
      this.turnBias = 0;
      this.heelBias = 0;
      this.stopped = false;   // aufgelaufen / manoevrierunfaehig
      this.config = {
         maxHeel: opts.maxHeel ?? this.profile.maxHeel,
         capsizeHeel: opts.capsizeHeel ?? this.profile.capsizeHeel,
         autoTrim: opts.autoTrim ?? true,
      };
   }

   // Schiff im laufenden Betrieb wechseln
   setVessel(v) {
      this.vessel = v;
      this.profile = profileFromVessel(v);
      this.config.maxHeel = this.profile.maxHeel;
      this.config.capsizeHeel = this.profile.capsizeHeel;
      this.speed = 0;
      this.heel = 0;
      this.heelLerp = 0;
      this.leeway = 0;
      this.isCapsized = false;
      return this;
   }

   get noGo() { return this.profile.noGo; }
   get rig() { return this.profile.rig; }

   step(dt, wind, manualTrim = null) {
      if (this.isCapsized) return this._capsizeStep(dt, wind);
      if (dt <= 0) return true;

      // 1. TWA
      this.twaSigned = twa(this.heading, wind.dir);
      this.twa = Math.abs(this.twaSigned);
      this.tack = tickFromTwaSafe(this.twaSigned);

      const P = this.profile;

      // 2. Trimmung
      this.optTrim = optimalTrim(this.twa, P.noGo);
      const useTrim = this.config.autoTrim ? this.optTrim : clamp(manualTrim ?? this.trim, 0, 1);
      const trimEff = trimEfficiency(useTrim, this.optTrim);

      // 3. Gier
      // Gesetzte Segelflaeche (Reffen) - weniger Tuch, weniger Fahrt und Krengung
      const setF = P.rig === "square" ? clamp(this.sailSet, 0.25, 1) : 1;

      const targetHeel = heelTarget(this.twa, wind.speedKts, this.config.maxHeel, P.heelScale)
         * (0.45 + 0.55 * setF);
      this.heelLerp = lerp(this.heelLerp, targetHeel, clamp(dt * 1.5, 0, 1));
      this.heel = this.heelLerp + this.heelBias;
      this.heelMaxSeen = Math.max(this.heelMaxSeen, this.heel);
      if (this.heel > this.config.capsizeHeel) {
         this.capsizeTimer += dt;
         if (this.capsizeTimer > 0.7) {
            this._capsize();
            return false;
         }
      } else {
         this.capsizeTimer = 0;
      }

      // 4. Backen-Check
      this.luffing = isLuffing(this.twa, wind.speedKts, P.noGo);
      const hp = heelPenalty(this.heel, this.config.capsizeHeel);

      // 5. Ziel-Boots-Speed
      let targetSpeed = this.luffing
         ? 0
         : polarSpeedAt(this.twa, wind.speedKts, trimEff, hp, P.polar) * (0.30 + 0.70 * setF);
      // Schaden: weniger Segelkraft, mehr Widerstand
      targetSpeed *= clamp(this.driveMul, 0, 1) / Math.max(this.dragMul, 0.2);
      if (this.stopped) targetSpeed = 0;
      // Ein Rahsegler behaelt beim Durchgehen durch den Wind Schwung ("Fahrt im
      // Schiff") - sonst kaeme er nie durch eine Wende.
      if (this.luffing && P.tackAssist > 0) {
         targetSpeed = this.speed * P.tackAssist;
      }
      const accel = this.luffing ? P.accelLuff : (targetSpeed > this.speed ? P.accelUp : P.accelDown);
      this.speed += (targetSpeed - this.speed) * clamp(accel * dt, 0, 1);
      this.speed = Math.max(0, this.speed);

      // 6. Ruder -> Gier
      const rauth = rudderAuthority(this.speed, P.rudderRef);
      const turnRate = this.rudder * P.turnRate * rauth * clamp(this.rudderMul, 0, 1)
         + this.turnBias * rauth; // deg/s
      this.heading = normDeg(this.heading + turnRate * dt);

      // 7. Leeway + Bodengang
      const leeFrac = clamp(this.heel / this.config.capsizeHeel, 0, 1);
      const windFrac = clamp(15 / Math.max(wind.speedKts, 0.5), 0.4, 1);
      const updown = this.twa < 90 ? 1 : 0.45;
      const targetLeeway = P.leewayMax * leeFrac * windFrac * updown;
      this.leeway = lerp(this.leeway, targetLeeway, clamp(dt * 1.2, 0, 1));
      const leeSign = this.twaSigned > 0 ? -1 : 1;
      this.groundHeading = normDeg(this.heading + this.leeway * leeSign);

      const gv = dirVec(this.groundHeading);
      this.boatVel = {
         x: gv.x * this.speed * 0.514444,
         z: gv.z * this.speed * 0.514444,
      };
      this.pos.x += this.boatVel.x * dt;
      this.pos.z += this.boatVel.z * dt;

      return true;
   }

   setRudder(v) {
      this.rudder = lerp(this.rudder, clamp(v, -1, 1), 0.3);
   }
   snapRudder(v) {
      this.rudder = clamp(v, -1, 1);
   }
   reset() {
      this.rudder = 0;
   }
   appWind(wind) {
      return apparentWind(wind.dir, wind.speedKts, this.heading, this.speed);
   }
   vmgToward(targetHeading) {
      const gv = dirVec(this.groundHeading);
      const tv = dirVec(targetHeading);
      return this.speed * clamp(gv.x * tv.x + gv.z * tv.z, -1, 1);
   }

   _capsize() {
      this.isCapsized = true;
      this.capsizeTimer = 0;
      this.speed = 0;
      this.heel = 0;
   }
   _capsizeStep(dt, wind) {
      this.heel = lerp(this.heel, 180, clamp(dt * 3, 0, 1));
      this.speed = 0;
      this.capsizeTimer += dt;
      if (this.capsizeTimer > 3) this.rightBoat();
      return false;
   }
   rightBoat() {
      this.isCapsized = false;
      this.capsizeTimer = 0;
      this.speed = 0;
      this.heel = 0;
      this.heelLerp = 0;
   }
}

// Helper (verhindert Doppeldefinition von tackFromTwa)
function tickFromTwaSafe(s) {
   return s > 0 ? "STBD" : "PORT";
}

export default { BoatDynamics };
