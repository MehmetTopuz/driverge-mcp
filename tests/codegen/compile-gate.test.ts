import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import { commandDatasheet, hasGcc, registerDatasheet } from "./helpers";

// L2 compile gate: the generated portable skeleton must be valid C. We compile
// with `gcc -c` (no link) against the thin-HAL seam — the hal_* symbols stay
// undefined, which is fine at the compile stage. Skips where gcc is absent
// (fresh clone / CI without a toolchain).
const dirs: string[] = [];

function compileOK(files: { path: string; content: string }[], main: string): void {
  const dir = mkdtempSync(join(tmpdir(), "driverge-cc-"));
  dirs.push(dir);
  for (const f of files) writeFileSync(join(dir, f.path), f.content);
  // Throws (failing the test) on any compile error; stderr surfaces in the message.
  execFileSync("gcc", ["-std=c11", "-Wall", "-c", join(dir, main), "-o", join(dir, "out.o")]);
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasGcc())("portable driver compiles with gcc -c", () => {
  it("register_map skeleton (BME280)", () => {
    const art = generatePortableDriver(registerDatasheet("bme280.golden.json", "BME280"));
    expect(() => compileOK(art.files, "bme280.c")).not.toThrow();
  });

  it("command_set skeleton (SHT3x)", () => {
    const art = generatePortableDriver(commandDatasheet());
    expect(() => compileOK(art.files, "sht3x.c")).not.toThrow();
  });

  it("esp32 target — the portable CORE still compiles (the IDF seam is not gated)", () => {
    const art = generateDriver(registerDatasheet("bme280.golden.json", "BME280"), "esp32");
    // Only the core .c is compiled; bme280_hal_esp32.c needs the ESP-IDF headers
    // (that is the user's idf.py build / HIL step, not the in-repo gate).
    expect(() => compileOK(art.files, "bme280.c")).not.toThrow();
  });
});
