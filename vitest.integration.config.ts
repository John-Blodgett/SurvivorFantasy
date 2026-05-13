import { defineConfig } from "vitest/config";
import path from "path";
import { readFileSync } from "fs";

// Manually load .env.local since dotenv isn't installed and vite's loadEnv
// has ESM compatibility issues with this version of vitest
function loadEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

const envVars = loadEnvFile(path.resolve(__dirname, ".env.local"));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/test/integration/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: envVars,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
