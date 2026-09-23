import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3050", headless: true },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3050",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
