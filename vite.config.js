// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
   base: "/sailing/",
   server: {
      host: true,
      port: 5173,
      open: false,
   },
   build: {
      target: "es2020",
      outDir: "dist",
      sourcemap: false,
   },
});
