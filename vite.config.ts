import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
