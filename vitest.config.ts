import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
    // Several fixture-gated tests each parse a large datasheet PDF via pdfjs.
    // Run test files sequentially so concurrent PDF parses don't contend (which
    // blows the default 5s timeout), and give real parses generous headroom.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
