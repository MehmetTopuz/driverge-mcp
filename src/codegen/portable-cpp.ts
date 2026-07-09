// Portable thin-HAL codegen — "cpp" language flavor (Session D). Renders a
// CLASS WRAPPER around the exact same #define macro constants and thin-HAL
// seam as generatePortableDriver's C output: the same register_map/command_set
// constants, TODO(driverge) markers, and fill_in_brief keys, just shaped as a
// class (<slug>.hpp/.cpp) instead of a struct + free functions (<slug>.h/.c).
//
// Deliberately reuses portable.ts's pure #define/TODO/seam-declaration builders
// (registerConstants, bitFieldMacros, registerMapTodo, commandSetTodo, BUS_SEAM
// decl, uartFramingBody/canFramingBody, registerBrief/commandBrief) instead of
// re-deriving them, so the two language flavors can never drift on the
// macro/seam contract that validate_driver and the native _hal_<target>.c seam
// files depend on — see wiki: thin-hal-non-negotiable, json-schema-as-contract.
//
// What genuinely differs (and is NOT shared) is the struct-vs-class /
// free-function-vs-method shape: the driver handle's address state becomes a
// private class member, and register_map's read_register(dev, reg, *value)
// becomes a method readRegister(reg, uint8_t &value) with no dev pointer to
// null-check.

import { registerWidth, type Register } from "../pdf/types.js";
import type { Command, DatasheetJson } from "../schema/types.js";
import { commentSafe, hexOrUndefined, macro, pascalCase, slug } from "./ident.js";
import {
  AUTOGEN,
  BUS_SEAM,
  COMMAND_INIT_TODO,
  I2C_COMMAND_FRAME_NOTE,
  bitFieldMacros,
  canFramingBody,
  commandBrief,
  commandReadDataTodo,
  commandSetTodo,
  crc8Body,
  makeFiles,
  registerBrief,
  registerConstants,
  registerInitTodo,
  registerMapTodo,
  registerMapTodoText,
  seamBusFor,
  type RegisterMapBus,
  uartFramingBody,
} from "./portable.js";
import type { DriverArtifact } from "./types.js";

const CPP_EXT = { header: "hpp", source: "cpp" } as const;

/** extern "C" wrapper note — explains why the seam stays linkable from a
 *  native target's `_hal_<target>.c` seam file (compiled as C) even though the
 *  core here is C++. */
const EXTERN_C_NOTE: readonly string[] = [
  '/* Thin-HAL seam — implement these for your platform (see thin-hal). Wrapped',
  ' * in extern "C" so the class methods below link against a plain-C',
  ' * implementation — including the native _hal_<target>.c seam file Driverge',
  " * attaches for esp32/stm32 targets, which is compiled as C, unchanged. */",
];

// ---------------------------------------------------------------------------
// Per-bus C++ method bodies + private member(s). Mirrors BUS_SEAM's role for
// the C struct/free-function shape, but a class stores its address state as a
// member (`i2c_addr_`) instead of a handle-struct field, and reference params
// (`uint8_t &value`) need no null check the way a C pointer does — so the
// bodies, not just the syntax, differ enough from BUS_SEAM's readBody/writeBody
// to warrant their own small table rather than reusing those strings as-is.
// ---------------------------------------------------------------------------

interface CppBusSeam {
  /** Private member(s), if the bus needs to remember any address state. */
  member: string[];
  /** Statement(s) inside init() that seed the member from a macro (I2C only). */
  initMember: string[];
  /** Body of readRegister(uint8_t reg, uint8_t &value). */
  readBody: string[];
  /** Body of writeRegister(uint8_t reg, uint8_t value). */
  writeBody: string[];
}

function cppBusSeam(busKind: RegisterMapBus, prefix: string): CppBusSeam {
  if (busKind === "I2C") {
    return {
      member: ["    uint8_t i2c_addr_;"],
      initMember: [`    i2c_addr_ = ${prefix}_I2C_ADDR;`],
      readBody: ["    return hal_i2c_read(i2c_addr_, reg, &value, 1);"],
      writeBody: ["    return hal_i2c_write(i2c_addr_, reg, &value, 1);"],
    };
  }
  if (busKind === "SPI") {
    return {
      member: [],
      initMember: [],
      readBody: ["    return hal_spi_transfer(&reg, 1, &value, 1);"],
      writeBody: [
        "    uint8_t frame[2];",
        "    frame[0] = reg;",
        "    frame[1] = value;",
        "    return hal_spi_transfer(frame, 2, nullptr, 0);",
      ],
    };
  }
  if (busKind === "UART") {
    return {
      member: [],
      initMember: [],
      readBody: uartFramingBody(["reg", "value"]),
      writeBody: uartFramingBody(["reg", "value"]),
    };
  }
  return {
    member: [],
    initMember: [],
    readBody: canFramingBody(["reg", "value"]),
    writeBody: canFramingBody(["reg", "value"]),
  };
}

// ---------------------------------------------------------------------------
// register_map
// ---------------------------------------------------------------------------

function registerDriverCpp(
  json: DatasheetJson,
  registers: Register[],
  name: string,
  prefix: string,
): DriverArtifact {
  const busKind = seamBusFor(json.protocol.bus);
  const spi = busKind === "SPI";
  const uart = busKind === "UART";
  const can = busKind === "CAN";
  const seam = BUS_SEAM[busKind];
  const cppSeam = cppBusSeam(busKind, prefix);
  const addr = hexOrUndefined(json.protocol.addresses?.[0]);
  const guard = `${prefix}_HPP`;
  const className = pascalCase(name);

  const hpp: string[] = [
    AUTOGEN(
      json.metadata.part || name,
      json.metadata.manufacturer,
      spi
        ? "Bus: SPI"
        : uart
          ? "Bus: UART"
          : can
            ? "Bus: CAN"
            : `Bus: I2C, address ${addr ?? "(unknown — see TODO)"}`,
    ),
    "",
    `#ifndef ${guard}`,
    `#define ${guard}`,
    "",
    "#include <cstdint>",
    "",
  ];

  if (!spi && !uart && !can) {
    if (addr) {
      hpp.push("/* I2C device address. */", `#define ${prefix}_I2C_ADDR ${addr}`, "");
    } else {
      hpp.push(
        "/* TODO(driverge): set the I2C device address (not found in the datasheet parse). */",
        `#define ${prefix}_I2C_ADDR 0x00`,
        "",
      );
    }
  }

  const regLines = registerConstants(prefix, registers);
  const hasRegs = regLines.some((l) => l.startsWith("#define"));
  hpp.push(
    ...(hasRegs ? regLines : registerMapTodo(prefix, json.extraction?.detectedPages ?? [])),
  );
  if (registers.some((r) => registerWidth(r) > 8)) {
    hpp.push(
      "",
      "/* NOTE: some registers here are wider than 8 bits (see the per-register",
      " * annotations). Bit-field masks are register-width correct; multi-byte access",
      " * framing (byte order / transfer size) is device-specific and belongs on the",
      " * hal_* seam. */",
    );
  }
  const bits = bitFieldMacros(prefix, registers);
  if (bits.length > 0) hpp.push("", "/* Bit-field mask/shift accessors. */", ...bits);

  hpp.push(
    "",
    ...EXTERN_C_NOTE,
    'extern "C" {',
    ...seam.decl,
    "void hal_delay_ms (uint32_t ms);",
    "}",
    "",
    `class ${className} {`,
    "public:",
    "    int init();",
    "    int readRegister(uint8_t reg, uint8_t &value);",
    "    int writeRegister(uint8_t reg, uint8_t value);",
  );
  if (cppSeam.member.length > 0) {
    hpp.push("", "private:", ...cppSeam.member);
  }
  hpp.push("};", "", `#endif /* ${guard} */`, "");

  const cpp: string[] = [
    `#include "${name}.hpp"`,
    "",
    `int ${className}::init() {`,
    ...cppSeam.initMember,
    ...registerInitTodo(uart, can, "writeRegister()"),
    "    return 0;",
    "}",
    "",
    `int ${className}::readRegister(uint8_t reg, uint8_t &value) {`,
    ...cppSeam.readBody,
    "}",
    "",
    `int ${className}::writeRegister(uint8_t reg, uint8_t value) {`,
    ...cppSeam.writeBody,
    "}",
    "",
  ];

  const brief = registerBrief(json, {
    init: "init",
    readRegister: "readRegister",
    writeRegister: "writeRegister",
  });
  if (!hasRegs) {
    brief.register_map_todo = registerMapTodoText(json, name, prefix);
  }

  return { files: makeFiles(name, hpp, cpp, CPP_EXT), fill_in_brief: brief };
}

// ---------------------------------------------------------------------------
// command_set
// ---------------------------------------------------------------------------

function commandDriverCpp(
  json: DatasheetJson,
  commands: Command[],
  name: string,
  prefix: string,
): DriverArtifact {
  const uart = json.protocol.bus === "UART";
  const can = json.protocol.bus === "CAN";
  const noAddrBus = uart || can;
  const addr = hexOrUndefined(json.protocol.addresses?.[0]);
  const crc = commands.find((c) => c.crc)?.crc;
  const guard = `${prefix}_HPP`;
  const className = pascalCase(name);

  const hpp: string[] = [
    AUTOGEN(
      json.metadata.part || name,
      json.metadata.manufacturer,
      uart
        ? "Bus: UART · command-set device"
        : can
          ? "Bus: CAN · command-set device"
          : `Bus: I2C, address ${addr ?? "(unknown — see TODO)"} · command-set device`,
    ),
    "",
    `#ifndef ${guard}`,
    `#define ${guard}`,
    "",
    "#include <cstdint>",
    "",
  ];

  if (noAddrBus) {
    // No bus device address on UART/CAN — see fill_in_brief.framing_todo.
  } else if (addr) {
    hpp.push("/* I2C device address. */", `#define ${prefix}_I2C_ADDR ${addr}`, "");
  } else {
    hpp.push("/* TODO(driverge): set the I2C device address. */", `#define ${prefix}_I2C_ADDR 0x00`, "");
  }

  if (commands.length === 0) {
    hpp.push(...commandSetTodo(prefix, json.extraction?.detectedPages ?? []));
  } else {
    hpp.push("/* Command codes. */");
    const seen = new Set<string>();
    for (const c of commands) {
      const macroName = `${prefix}_CMD_${macro(c.name)}`;
      if (seen.has(macroName)) continue;
      seen.add(macroName);
      const line = `#define ${macroName} ${c.code.toUpperCase().replace("0X", "0x")}`;
      // See the C flavor's identical comment in portable.ts commandDriver — c.params
      // is defensively commentSafe'd even though today's only producer is hex-safe.
      hpp.push(
        c.params && c.params.length > 0
          ? `${line}  /* params: ${commentSafe(c.params.join(", "))} */`
          : line,
      );
    }
  }

  // See portable.ts commandDriver's identical comment: a non-hex crc.poly/init
  // must never reach a #define as a live value (define-injection fix) — only
  // emit the block when both are well-formed hex literals.
  if (crc && hexOrUndefined(crc.poly) && hexOrUndefined(crc.init)) {
    hpp.push(
      "",
      `/* CRC-${crc.width} checksum parameters. */`,
      `#define ${prefix}_CRC_POLY ${crc.poly}`,
      `#define ${prefix}_CRC_INIT ${crc.init}`,
    );
  }

  hpp.push(
    "",
    ...EXTERN_C_NOTE,
    'extern "C" {',
    ...(uart
      ? BUS_SEAM.UART.decl
      : can
        ? BUS_SEAM.CAN.decl
        : [
            "/* Return 0 on success, non-zero on a bus error (e.g. NACK). */",
            "int hal_i2c_write(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);",
            "int hal_i2c_read (uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);",
          ]),
    "void hal_delay_ms (uint32_t ms);",
    "}",
    "",
    `class ${className} {`,
    "public:",
    "    int init();",
    "    int sendCommand(uint16_t command);",
    "    int readData(uint8_t *buffer, uint16_t len);",
    ...(crc ? ["    uint8_t crc8(const uint8_t *data, uint16_t len);"] : []),
  );
  if (!noAddrBus) {
    hpp.push("", "private:", "    uint8_t i2c_addr_;");
  }
  hpp.push("};", "", `#endif /* ${guard} */`, "");

  const cpp: string[] = [
    `#include "${name}.hpp"`,
    "",
    `int ${className}::init() {`,
    ...(noAddrBus ? [] : [`    i2c_addr_ = ${prefix}_I2C_ADDR;`]),
    ...COMMAND_INIT_TODO,
    "    return 0;",
    "}",
    "",
    `int ${className}::sendCommand(uint16_t command) {`,
    ...(uart
      ? uartFramingBody(["command"])
      : can
        ? canFramingBody(["command"])
        : [
            "    uint8_t msb;",
            "    uint8_t lsb;",
            "    msb = (uint8_t)(command >> 8);",
            "    lsb = (uint8_t)(command & 0xFF);",
            ...I2C_COMMAND_FRAME_NOTE,
            "    return hal_i2c_write(i2c_addr_, msb, &lsb, 1);",
          ]),
    "}",
    "",
    `int ${className}::readData(uint8_t *buffer, uint16_t len) {`,
    ...(uart
      ? uartFramingBody(["buffer", "len"])
      : can
        ? canFramingBody(["buffer", "len"])
        : [
            "    if (buffer == nullptr) {",
            "        return -1;",
            "    }",
            ...commandReadDataTodo("crc8"),
            "    (void)buffer;",
            "    (void)len;",
            "    return 0;",
          ]),
    "}",
    "",
  ];

  if (crc) {
    cpp.push(...crc8Body(`${className}::crc8`, crc, prefix));
  }

  const brief = commandBrief(json, commands, crc, uart, can, name, prefix, {
    sendCommand: "sendCommand",
    readData: "readData",
    crc8: "crc8",
  });

  return { files: makeFiles(name, hpp, cpp, CPP_EXT), fill_in_brief: brief };
}

// ---------------------------------------------------------------------------

/**
 * Render the portable thin-HAL driver skeleton, cpp flavor: same dispatch rule
 * as generatePortableDriver (register_map-first fallback), just calling the
 * class-wrapper renderers above.
 */
export function generatePortableCppDriver(json: DatasheetJson): DriverArtifact {
  const part = json.metadata.part;
  const name = slug(part);
  const prefix = macro(name);
  return json.interface.kind === "command_set"
    ? commandDriverCpp(json, json.interface.commands, name, prefix)
    : registerDriverCpp(json, json.interface.registers, name, prefix);
}
