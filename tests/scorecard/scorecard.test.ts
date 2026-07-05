import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import type { DatasheetJson } from "../../src/schema/types";

// Cross-vendor coverage scorecard. Runs every fixture datasheet PRESENT through the
// full L1–L5 pipeline and snapshots one row per device, so extraction coverage across
// vendors is measurable and regressions show up in the diff. The fixtures are
// git-ignored (see tests/fixtures/README.md), so this whole suite skips on CI and on
// any machine without them; the committed snapshot is the maintainer's local baseline.
// Regenerate it by deleting scorecard.snap.md (or `vitest -u`) and re-running.

const FIXTURES = [
  "bst-bme280-ds002.pdf",
  "mcp23017-datasheet.pdf",
  "sht3x-datasheet.pdf",
  "tmag5170-q1.pdf",
  "5193_DHT20.pdf",
  "AEAT-8811-Q24_DS.pdf",
  "infineon-tle5014sp16d-e0002-datasheet-en.pdf",
  "lsm6dsrx.pdf",
  "vl53l3cx.pdf",
  "adxl345.pdf",
  "pca9685.pdf",
  "mlx90614.pdf",
  "max30102.pdf",
] as const;

const fixturePath = (f: string) =>
  fileURLToPath(new URL(`../fixtures/${f}`, import.meta.url));

const present = FIXTURES.filter((f) => existsSync(fixturePath(f)));

function row(file: string, j: DatasheetJson): string {
  const i = j.interface;
  const regs = i.kind === "register_map" ? i.registers.length : 0;
  const bits =
    i.kind === "register_map"
      ? i.registers.reduce((n, r) => n + r.bitFields.length, 0)
      : 0;
  const cmds = i.kind === "command_set" ? i.commands.length : 0;
  const cols = [
    file,
    j.metadata.part || "—",
    j.metadata.manufacturer,
    i.kind,
    j.protocol.bus,
    String(regs),
    String(bits),
    String(cmds),
    j.extraction?.status ?? "n/a",
    j.validation.valid ? "yes" : "NO",
  ];
  return `| ${cols.join(" | ")} |`;
}

describe.skipIf(present.length === 0)("cross-vendor coverage scorecard", () => {
  it(
    "matches the committed scorecard snapshot",
    async () => {
      const head =
        "| fixture | part | manufacturer | kind | bus | regs | bitfields | cmds | extraction | valid |\n" +
        "|---|---|---|---|---|---|---|---|---|---|";
      const rows: string[] = [];
      for (const f of present) {
        const j = assembleDatasheet(await analyzePdfFile(fixturePath(f)));
        rows.push(row(f, j));
      }
      const md = `# Cross-vendor coverage scorecard\n\n${head}\n${rows.join("\n")}\n`;
      await expect(md).toMatchFileSnapshot("./scorecard.snap.md");
    },
    300_000,
  );
});
