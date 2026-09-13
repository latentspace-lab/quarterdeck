// settings.js - Persistierte Keybindings + Toneinstellungen (localStorage)
//
// Schema:
//   settings.keyBindings  — Code -> Aktion (siehe controls.js)
//   settings.sound        — { enabled, gain }
//   settings.graphics     — { pixelRatio, shadows }

const STORE = "sailing-settings-v1";

export const DEFAULTS = {
   keyBindings: {
      ArrowLeft:    "rudderLeft",
      KeyA:         "rudderLeft",
      ArrowRight:   "rudderRight",
      KeyD:         "rudderRight",
      ArrowUp:      "trimIn",
      KeyW:         "trimIn",
      ArrowDown:    "trimOut",
      KeyS:         "trimOut",
      KeyC:         "cycleCamera",
      Digit1:       "camChase",
      Digit2:       "camCockpit",
      Digit3:       "camTop",
      Digit4:       "camOrbit",
      KeyR:         "restart",
      KeyG:         "toggleGusts",
      KeyH:         "toggleHud",
      KeyM:         "toggleMenu",
      KeyT:         "toggleTopdown",
      Escape:       "toggleMenu",
      Space:        "capsizeRight",
      NumpadEnter:  "capsizeRight",
      KeyQ:         "firePort",
      KeyE:         "fireStbd",
      KeyF:         "fireBoth",
      KeyV:         "cycleVessel",
      KeyZ:         "cycleAmmo",
      KeyX:         "cutWreck",
   },
   sound:    { enabled: true, gain: 0.6 },
   graphics: { pixelRatio: 1.75, shadows: true },
};

export function loadSettings() {
   try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return structuredClone(DEFAULTS);
      const saved = JSON.parse(raw);
      return {
         keyBindings: { ...DEFAULTS.keyBindings, ...(saved.keyBindings || {}) },
         sound:    { ...DEFAULTS.sound,    ...(saved.sound    || {}) },
         graphics: { ...DEFAULTS.graphics,  ...(saved.graphics  || {}) },
      };
   } catch {
      return structuredClone(DEFAULTS);
   }
}

export function saveSettings(s) {
   try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode */ }
}

let _active = loadSettings();
export const keyBindings   = () => _active.keyBindings;
export const soundSettings = () => _active.sound;
export const gfxSettings   = () => _active.graphics;

export function setKeyBinding(code, action) {
   _active.keyBindings[code] = action;
   saveSettings(_active);
}

export function resetKeyBindings() {
   _active.keyBindings = structuredClone(DEFAULTS.keyBindings);
   saveSettings(_active);
}

export function setSoundEnabled(v) {
   _active.sound.enabled = v;
   saveSettings(_active);
}

export function setSoundGain(v) {
   _active.sound.gain = Math.max(0, Math.min(1, v));
   saveSettings(_active);
}

export function setPixelRatio(v) {
   _active.graphics.pixelRatio = Math.max(0.5, Math.min(2, v));
   saveSettings(_active);
}

export function setShadows(v) {
   _active.graphics.shadows = !!v;
   saveSettings(_active);
}
