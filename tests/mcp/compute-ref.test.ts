import { describe, expect, it } from "vitest";
import { computeRef } from "../../src/mcp/cache";

// Contract: computeRef(pdfPath, mtimeMs, extra?) hashes the material string
// `${pdfPath}:${Math.round(mtimeMs)}:${extra ?? ""}` and returns `ds_` + the
// first 12 hex chars of the digest. The hash ALGORITHM is moving from sha1 to
// sha256 (ref shape is unchanged); this file pins the new sha256 behavior.
//
// Golden derivation (verify by reading src/mcp/cache.ts's computeRef body
// before trusting this number):
//   material = "/x/bme280.pdf:1700000000:"   (extra omitted -> "" per `extra ?? ""`)
//   node -e "const {createHash}=require('crypto');
//     console.log('ds_'+createHash('sha256').update('/x/bme280.pdf:1700000000:').digest('hex').slice(0,12))"
//   => ds_7a08407fde0c
//
// For reference, the CURRENT (pre-fix) sha1 implementation produces a
// different value for the same material:
//   node -e "const {createHash}=require('crypto');
//     console.log('ds_'+createHash('sha1').update('/x/bme280.pdf:1700000000:').digest('hex').slice(0,12))"
//   => ds_7910af9e1fc0
// so this golden test is RED today (computeRef still returns the sha1 value)
// and flips GREEN once cache.ts swaps createHash("sha1") -> createHash("sha256").

const PDF_PATH = "/x/bme280.pdf";
const MTIME_MS = 1700000000;

describe("computeRef — sha256 golden (sha1 -> sha256 hardening)", () => {
  it("returns the exact sha256-derived ref for a fixed path+mtime with no `extra`", () => {
    expect(computeRef(PDF_PATH, MTIME_MS)).toBe("ds_7a08407fde0c");
  });

  it("is deterministic: the same args always produce the same ref", () => {
    const a = computeRef(PDF_PATH, MTIME_MS, "foo");
    const b = computeRef(PDF_PATH, MTIME_MS, "foo");
    expect(a).toBe(b);
  });

  it("always has the `ds_` + 12 lowercase-hex-char shape", () => {
    expect(computeRef(PDF_PATH, MTIME_MS)).toMatch(/^ds_[0-9a-f]{12}$/);
    expect(computeRef(PDF_PATH, MTIME_MS, "some-hint")).toMatch(/^ds_[0-9a-f]{12}$/);
  });

  it("a different `extra` value changes the ref (hints don't silently collide)", () => {
    const withoutExtra = computeRef(PDF_PATH, MTIME_MS);
    const withExtra = computeRef(PDF_PATH, MTIME_MS, "manufacturer_hint:register_map");
    expect(withExtra).not.toBe(withoutExtra);
  });

  it("matches the exact sha256 golden when `extra` is supplied (not just the no-extra case)", () => {
    // material = "/x/bme280.pdf:1700000000:foo"
    // node -e "const {createHash}=require('crypto');
    //   console.log('ds_'+createHash('sha256').update('/x/bme280.pdf:1700000000:foo').digest('hex').slice(0,12))"
    // => ds_7d8ee351f2c6
    expect(computeRef(PDF_PATH, MTIME_MS, "foo")).toBe("ds_7d8ee351f2c6");
  });
});
