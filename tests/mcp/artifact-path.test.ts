// B3 regression (session-16 review): generate_driver's out_dir handler confines
// `out_dir` itself under DRIVERGE_OUT_ROOT (see the "generate_driver out_dir
// confinement" describe block in tests/mcp/tools.test.ts), but then writes each
// `artifact.files[].path` with a second, un-checked `join(resolvedOut, f.path)`.
// Today `f.path` always comes from Driverge's own deterministic codegen (safe),
// but the handler has no guard if that ever changes (a hostile/careless
// datasheet-derived slug, a future codegen bug, etc.) — there is no second
// containment check on the per-file path the way there is on out_dir.
//
// Contract pinned here: a pure, exported guard —
//   resolveArtifactPath(rootDir: string, filePath: string): string | undefined
// — that returns the confined absolute path for a safe filePath, and
// `undefined` for anything that escapes rootDir (path separators/"..", or an
// absolute path). This does not yet exist in src/mcp/register.ts, so this
// import fails today (RED) — the coder must add and wire it into the
// generate_driver out_dir file-write loop.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveArtifactPath } from "../../src/mcp/register";

describe("resolveArtifactPath (B3) — confines an artifact file path under a root directory", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "driverge-artifact-root-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves a plain filename to <root>/<filename>", () => {
    expect(resolveArtifactPath(root, "bme280.h")).toBe(join(root, "bme280.h"));
  });

  it("resolves a nested-but-non-escaping relative path under root (acceptable — not undefined)", () => {
    const resolved = resolveArtifactPath(root, "sub/dir/file.h");
    expect(resolved).toBe(join(root, "sub", "dir", "file.h"));
    expect(resolved).not.toBeUndefined();
  });

  it.each([
    ["../evil.h", "posix parent-dir escape"],
    ["..\\evil.h", "windows parent-dir escape"],
    ["C:\\evil.h", "windows absolute path"],
    ["/etc/evil", "posix-style absolute path"],
    ["sub/../../evil.h", "escape via a deeper relative path"],
  ])("rejects %s (%s) -> undefined", (evilPath) => {
    expect(resolveArtifactPath(root, evilPath)).toBeUndefined();
  });
});
