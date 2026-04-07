import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@flowos/schema": path.resolve(__dirname, "../../packages/schema/src/index.ts"),
      "@flowos/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
});
