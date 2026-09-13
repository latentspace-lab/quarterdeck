// vite.config.js
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// @segel/shared wird im Dev- und Build-Lauf direkt aus den TypeScript-Quellen
// aufgeloest. Dadurch braucht der Client keinen vorgeschalteten tsc-Lauf und
// HMR greift bis in die geteilten Module hinein. Node-Konsumenten (Tests,
// Server) benutzen stattdessen das kompilierte dist/ aus package.json.
const sharedSrc = fileURLToPath(new URL("../shared/src", import.meta.url));

export default defineConfig({
   base: "/sailing/",
   resolve: {
      alias: [
         { find: /^@segel\/shared$/, replacement: sharedSrc + "/index.ts" },
         { find: /^@segel\/shared\/(.*)$/, replacement: sharedSrc + "/$1.ts" },
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
