// vite.config.js
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// @quarterdeck/shared is resolved directly from the TypeScript sources during dev
// and build. This means the client needs no separate tsc pass beforehand,
// and HMR reaches all the way into the shared modules too. Node consumers
// (tests, server) use the compiled dist/ from package.json instead.
const sharedSrc = fileURLToPath(new URL("../shared/src", import.meta.url));

export default defineConfig({
   base: "/quarterdeck/",
   resolve: {
      alias: [
         { find: /^@quarterdeck\/shared$/, replacement: sharedSrc + "/index.ts" },
         { find: /^@quarterdeck\/shared\/(.*)$/, replacement: sharedSrc + "/$1.ts" },
      ],
   },
   server: {
      host: true,
      port: 5173,
      open: false,
      // Friends over Tailscale reach the dev server by its MagicDNS name;
      // Vite refuses unknown Host headers unless they are listed here.
      allowedHosts: [".ts.net"],
      fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
   },
   preview: {
      host: true,
      allowedHosts: [".ts.net"],
   },
   build: {
      target: "es2022",
      outDir: "dist",
      sourcemap: false,
   },
});
