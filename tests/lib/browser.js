// tests/lib/browser.js - serve the built client and launch Chromium.
//
// Shared by the browser-level suites. Both helpers fail soft: without a build
// or without a browser the caller gets null and should skip, not fail -
// nobody running the physics tests should be blocked by Playwright.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DIST = join(HERE, "..", "..", "packages", "client", "dist");
export const BASE = "/quarterdeck/";

const MIME = {
   ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
   ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
   ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
   ".woff2": "font/woff2", ".ico": "image/x-icon",
};

/** Static server for packages/client/dist on an ephemeral port, or null without a build. */
export async function serveDist() {
   if (!existsSync(join(DIST, "index.html"))) return null;
   const server = createServer(async (req, res) => {
      try {
         let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
         if (p.startsWith(BASE)) p = p.slice(BASE.length - 1);
         const file = join(DIST, normalize(p).replace(/^(\.\.[/\\])+/, ""));
         const target = (await stat(file).catch(() => null))?.isDirectory()
            ? join(file, "index.html")
            : file;
         const body = await readFile(target);
         res.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream" });
         res.end(body);
      } catch {
         res.writeHead(404).end("not found");
      }
   });
   await new Promise((r) => server.listen(0, "127.0.0.1", r));
   return { server, url: `http://127.0.0.1:${server.address().port}${BASE}`, close: () => server.close() };
}

/** Headless Chromium via Playwright with software GL, or null with a reason. */
export async function launchChromium() {
   let chromium;
   try {
      ({ chromium } = await import("playwright"));
   } catch {
      return { browser: null, reason: "playwright is not installed" };
   }
   const candidates = [
      process.env.CHROMIUM_PATH,
      process.env.PLAYWRIGHT_BROWSERS_PATH ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") : null,
      undefined,
   ].filter((v) => v !== null);
   let lastErr = null;
   for (const executablePath of candidates) {
      try {
         const browser = await chromium.launch({
            executablePath: executablePath || undefined,
            args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
         });
         return { browser, reason: null };
      } catch (err) {
         lastErr = err;
      }
   }
   return { browser: null, reason: "Chromium will not start (" + (lastErr ? lastErr.message.split("\n")[0] : "not found") + ")" };
}

/** Collect page errors and console errors (404s excluded). */
export function watchErrors(page) {
   const errors = [];
   page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
   page.on("console", (m) => {
      if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
   });
   return errors;
}
