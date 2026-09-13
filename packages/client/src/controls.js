// controls.js - Eingabe (Tastatur + Maus)
// Gibt jedes Frame ein Input-Objekt und liefert Edge-Ereignisse ueber eine Queue.
export class Controls {
   constructor(dom) {
      this.dom = dom || document;
      this.keys = {};
      this.queue = [];
      this.rudder = 0;
      this.trim = 0.5;
      this._onKey;
      this._onKeyUp;
      this.bind();
     }

    bind() {
      this._onKey = (e) => {
         if (this.keys[e.code]) return; // kein Auto-Repeat
         this.keys[e.code] = true;
         this._handle(e, true);
       };
      this._onKeyUp = (e) => {
         this.keys[e.code] = false;
         this._handle(e, false);
         this._release(e);
       };
      this.dom.addEventListener("keydown", this._onKey);
      this.dom.addEventListener("keyup", this._onKeyUp);
     }

    unbind() {
      this.dom.removeEventListener("keydown", this._onKey);
      this.dom.removeEventListener("keyup", this._onKeyUp);
     }

    _handle(e, down) {
      if (down) {
         switch (e.code) {
            case "ArrowLeft": this.queue.push("rudderLeft"); break;
            case "KeyA": this.queue.push("rudderLeft"); break;
            case "ArrowRight": this.queue.push("rudderRight"); break;
            case "KeyD": this.queue.push("rudderRight"); break;
            case "ArrowUp": this.queue.push("trimIn"); break;
            case "KeyW": this.queue.push("trimIn"); break;
            case "ArrowDown": this.queue.push("trimOut"); break;
            case "KeyS": this.queue.push("trimOut"); break;
            case "KeyC": this.queue.push("cycleCamera"); break;
            case "Digit1": this.queue.push("camChase"); break;
            case "Digit2": this.queue.push("camCockpit"); break;
            case "Digit3": this.queue.push("camTop"); break;
            case "Digit4": this.queue.push("camOrbit"); break;
            case "KeyR": this.queue.push("restart"); break;
            case "KeyG": this.queue.push("toggleGusts"); break;
            case "KeyH": this.queue.push("toggleHud"); break;
            case "KeyM": this.queue.push("toggleMenu"); break;
            case "KeyT": this.queue.push("toggleTopdown"); break;
            case "Escape": this.queue.push("toggleMenu"); break;
            case "Space": this.queue.push("capsizeRight"); break;
            case "NumpadEnter": this.queue.push("capsizeRight"); break;
            case "KeyQ": this.queue.push("firePort"); break;
            case "KeyE": this.queue.push("fireStbd"); break;
            case "KeyF": this.queue.push("fireBoth"); break;
            case "KeyV": this.queue.push("cycleVessel"); break;
            case "KeyZ": this.queue.push("cycleAmmo"); break;
            case "KeyX": this.queue.push("cutWreck"); break;
            default:
               break;
          }
      }
    }

    _release(e) {
      // Ruder beim Loslassen auf 0 (langsam)
      switch (e.code) {
         case "ArrowLeft":
          case "KeyA":
            if (this.keys["ArrowRight"] && this.keys["KeyD"]) this.rudder = 0;
            else this.rudder = 0;
            break;
         case "ArrowRight":
          case "KeyD":
            if (this.keys["ArrowLeft"] && this.keys["KeyA"]) this.rudder = 0;
            else this.rudder = 0;
            break;
      }
    }

    read(dt) {
      // Rohes Ruderkommando aus den Tasten: -1, 0 oder +1.
      //
      // Frueher wurde hier mit dt*8 geglaettet und in BoatDynamics.setRudder()
      // noch einmal mit festem Faktor 0.3 je Aufruf. Zwei Glaettungen, davon
      // eine aufrufabhaengig - das laesst sich auf dem Server nicht
      // nachrechnen. Seit Phase 0B' gibt es genau einen dt-invarianten
      // Smoother, und der sitzt im Simulationsschritt.
      this.rudder = (this.keys["ArrowRight"] ? 1 : 0) - (this.keys["ArrowLeft"] ? 1 : 0) +
          (this.keys["KeyD"] ? 1 : 0) - (this.keys["KeyA"] ? 1 : 0);
      return {
         rudder: this.rudder,
        trimIn: this.keys["ArrowUp"] || this.keys["KeyW"],
        trimOut: this.keys["ArrowDown"] || this.keys["KeyS"],
        queue: this.queue,
       };
    }

    drain() {
      const q = this.queue;
      this.queue = [];
      return q;
    }
}
