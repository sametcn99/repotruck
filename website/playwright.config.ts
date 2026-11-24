import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/browser-report", open: "never" }]],
  outputDir: "test-results/browser",
  use: {
    baseURL: "http://127.0.0.1:4173/repotruck/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/repotruck/",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
