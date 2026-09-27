import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "local-runtime-config",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split("?")[0];
          if (
            !path ||
            !/^\/(imd-deployment\.json|mark\.svg|abi\/[A-Za-z]+\.json)$/.test(
              path,
            )
          )
            return next();
          try {
            res.setHeader(
              "Content-Type",
              path.endsWith(".svg") ? "image/svg+xml" : "application/json",
            );
            res.end(readFileSync(new URL("../dist" + path, import.meta.url)));
          } catch {
            next();
          }
        });
      },
    },
  ],
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
});
