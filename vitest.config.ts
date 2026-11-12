import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = (name: string, dir: string) => ({
  find: name,
  replacement: path.resolve(`packages/${dir}/src/index.ts`),
});

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"],
  },
  resolve: {
    alias: [
      alias("@gatekit/core", "core"),
      alias("@gatekit/memory", "memory"),
      alias("@gatekit/redis", "redis"),
      alias("@gatekit/unkey", "unkey"),
      alias("@gatekit/hono", "hono"),
      alias("@gatekit/express", "express"),
      alias("@gatekit/next", "next"),
    ],
  },
});
