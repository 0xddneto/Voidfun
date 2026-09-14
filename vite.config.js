import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.DEPLOY_BASE ?? "/",
  server: { host: "127.0.0.1", port: 3050 },
});
