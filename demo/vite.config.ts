import { defineConfig } from "vite";

// Demo site. `npm run dev` serves it at http://localhost:5183/ directly;
// the /sprute/ base applies only to the production build, which
// .github/workflows/pages.yml deploys to https://sprited-ai.github.io/sprute
// (it also drops the gallery assets from examples/ into the build output).
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/sprute/" : "/",
  server: { port: 5183 },
  build: { outDir: "dist", target: "esnext" },
}));
