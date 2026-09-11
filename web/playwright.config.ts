import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    use: { baseURL: "http://127.0.0.1:3011", viewport: { width: 1440, height: 960 }, trace: "retain-on-failure" },
    reporter: "list",
    webServer: {
        command: "npm run dev -- --host 127.0.0.1 --port 3011 --strictPort",
        url: "http://127.0.0.1:3011",
        reuseExistingServer: true,
    },
});
