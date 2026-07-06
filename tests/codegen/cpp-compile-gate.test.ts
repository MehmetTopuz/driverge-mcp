import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import {
  commandDatasheet,
  hasGpp,
  registerDatasheet,
  spiRegisterDatasheet,
} from "./helpers";

// L2 compile gate for the cpp portable skeleton (Session D). Mirrors
// compile-gate.test.ts but with g++, -std=c++11, no link (-c) — the hal_*
// symbols stay undefined at this stage, same as the C gate. Skips where g++
// is absent (fresh clone / CI without a C++ toolchain).
const dirs: string[] = [];

function compileCppOK(files: { path: string; content: string }[], main: string): void {
  const dir = mkdtempSync(join(tmpdir(), "driverge-cxx-"));
  dirs.push(dir);
  for (const f of files) writeFileSync(join(dir, f.path), f.content);
  execFileSync("g++", ["-std=c++11", "-Wall", "-c", join(dir, main), "-o", join(dir, "out.o")]);
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasGpp())("cpp portable driver compiles with g++ -c", () => {
  it("register_map skeleton (BME280, language cpp)", () => {
    const art = generateDriver(registerDatasheet("bme280.golden.json", "BME280"), "portable", {
      language: "cpp",
    });
    expect(() => compileCppOK(art.files, "bme280.cpp")).not.toThrow();
  });

  it("command_set skeleton (SHT3x, language cpp)", () => {
    const art = generateDriver(commandDatasheet(), "portable", { language: "cpp" });
    expect(() => compileCppOK(art.files, "sht3x.cpp")).not.toThrow();
  });

  it("SPI register_map skeleton (TMAG5170, language cpp)", () => {
    const art = generateDriver(
      spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170"),
      "portable",
      { language: "cpp" },
    );
    expect(() => compileCppOK(art.files, "tmag5170.cpp")).not.toThrow();
  });
});
