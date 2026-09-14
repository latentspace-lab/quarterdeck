// tests/unit/controls.test.js - keyboard input.
//
// The controls listen on the whole document. Keys typed into a text field
// (server URL, player name, room name in the menu) must not reach the ship:
// on 2026-09-13 every "h" in a typed URL hid the HUD and every "t" switched
// the camera, so a player joined a battle without any overlay.
import { Controls, isTyping } from "../../packages/client/src/controls.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("controls");
const { ok, eq } = suite;

// A minimal stand-in for the DOM: just enough to dispatch key events.
class FakeDom {
   constructor() { this.listeners = {}; }
   addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
   removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
   dispatch(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }
}
const press = (dom, code, target) => {
   dom.dispatch("keydown", { code, target });
   dom.dispatch("keyup", { code, target });
};

suite.section("keys reach the ship from the canvas");
{
   const dom = new FakeDom();
   const c = new Controls(dom);
   press(dom, "KeyH", { tagName: "CANVAS" });
   press(dom, "KeyQ", { tagName: "BODY" });
   press(dom, "KeyT", null);
   eq(c.drain().join(","), "toggleHud,firePort,toggleTopdown", "H, Q and T queue their orders");
   c.unbind();
}

suite.section("typing in a text field is not an order");
{
   const dom = new FakeDom();
   const c = new Controls(dom);
   for (const ch of "http://my-host.ts.net:2567") {
      const code = /[a-z]/.test(ch) ? "Key" + ch.toUpperCase() : "Digit" + ch;
      press(dom, code, { tagName: "INPUT" });
   }
   press(dom, "KeyH", { tagName: "TEXTAREA" });
   press(dom, "KeyH", { tagName: "SELECT" });
   press(dom, "KeyH", { tagName: "DIV", isContentEditable: true });
   eq(c.drain().length, 0, "a typed URL queues nothing");
   dom.dispatch("keydown", { code: "KeyA", target: { tagName: "INPUT" } });
   eq(c.read(0.016).rudder, 0, "and does not move the rudder");
   ok(!c.keys.KeyA, "the key is not remembered as held");
   c.unbind();
}

suite.section("isTyping");
{
   ok(isTyping({ target: { tagName: "input" } }), "input, any case");
   ok(!isTyping({ target: { tagName: "BUTTON" } }), "a button is not a text field");
   ok(!isTyping({}), "no target, no typing");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
