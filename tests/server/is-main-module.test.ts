// B1 regression (session-16 review): src/server.ts (L72-74) decides whether to
// auto-start the stdio transport with:
//
//   const isDirectRun =
//     process.argv[1] !== undefined &&
//     fileURLToPath(import.meta.url) === process.argv[1];
//
// This breaks under a POSIX npm-bin symlink: `npx driverge`/a global install
// invokes the package's bin SYMLINK, so process.argv[1] is the symlink path,
// while fileURLToPath(import.meta.url) resolves to the module's REAL (target)
// path — the strict `===` never matches, so `main()` never runs and the
// installed CLI does nothing.
//
// Contract pinned here: a pure, exported helper —
//   isMainModule(moduleUrl: string, argv1: string | undefined): boolean
// — that resolves this symlink-safely (i.e. compares REAL paths, not raw
// strings). This does not exist on src/server.ts yet, so this import fails
// today (RED) — the coder must add it and use it in place of the inline
// isDirectRun check.

import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMainModule } from "../../src/server";

/**
 * Whether this machine/user can actually create filesystem symlinks — POSIX
 * generally can; Windows requires Developer Mode or an elevated/privileged
 * process (SeCreateSymbolicLinkPrivilege), so a bare `npm test` run here often
 * cannot. Probed once at collection time (synchronously) so the one test that
 * needs a real symlink can `it.skipIf` cleanly instead of failing on an
 * environment limitation unrelated to the isMainModule contract itself.
 */
function canCreateSymlinks(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), "driverge-symlink-probe-"));
  try {
    const target = join(probeDir, "target.txt");
    writeFileSync(target, "x");
    const link = join(probeDir, "link.txt");
    symlinkSync(target, link, "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const SYMLINK_SUPPORTED = canCreateSymlinks();

describe("isMainModule (B1) — symlink-safe replacement for the raw argv[1] === fileURLToPath(import.meta.url) check", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "driverge-is-main-module-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when argv1 is undefined (module imported as a library, not run directly)", () => {
    const moduleUrl = pathToFileURL(join(dir, "server.js")).href;
    expect(isMainModule(moduleUrl, undefined)).toBe(false);
  });

  it("returns true when argv1 is exactly the module's own file path (today's direct-run case)", () => {
    const realFile = join(dir, "server.js");
    writeFileSync(realFile, "// stub\n");
    const moduleUrl = pathToFileURL(realFile).href;
    expect(isMainModule(moduleUrl, realFile)).toBe(true);
  });

  it("returns false for an unrelated argv1 path", () => {
    const realFile = join(dir, "server.js");
    writeFileSync(realFile, "// stub\n");
    const unrelated = join(dir, "unrelated.js");
    writeFileSync(unrelated, "// stub\n");
    const moduleUrl = pathToFileURL(realFile).href;
    expect(isMainModule(moduleUrl, unrelated)).toBe(false);
  });

  it.skipIf(!SYMLINK_SUPPORTED)(
    "returns true through a symlink: argv[1] is the bin symlink, moduleUrl resolves to the target's real path (the actual npm-bin-symlink scenario)",
    () => {
      const realFile = join(dir, "real-server.js");
      writeFileSync(realFile, "// stub\n");
      const symlinkPath = join(dir, "bin-symlink.js");
      symlinkSync(realFile, symlinkPath, "file");
      expect(existsSync(symlinkPath)).toBe(true);

      // fileURLToPath(import.meta.url) inside the real module resolves to the
      // TARGET's own real path, never the symlink — that's exactly what makes
      // the raw `===` check in server.ts fragile.
      const moduleUrl = pathToFileURL(realpathSync(realFile)).href;
      expect(isMainModule(moduleUrl, symlinkPath)).toBe(true);
    },
  );

  it("returns false for a path that merely shares a suffix with the module path (no false positive via substring matching)", () => {
    const realFile = join(dir, "server.js");
    writeFileSync(realFile, "// stub\n");
    const lookalike = join(dir, "not-server.js");
    writeFileSync(lookalike, "// stub\n");
    const moduleUrl = pathToFileURL(realFile).href;
    expect(isMainModule(moduleUrl, lookalike)).toBe(false);
  });
});
