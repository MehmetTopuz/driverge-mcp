// Public surface of the PDF parsing pipeline (L1 format detection + L2 page map).

export * from "./types.js";
export { MIN_TEXT_CHARS, classifyDocument, classifyPage } from "./classify.js";
export { buildPageMap, labelPage } from "./page-map.js";
export { extractPages } from "./extract.js";
export { analyzePdf, analyzePdfFile } from "./analyze.js";
export { centerX, clusterRows, type TableRow } from "./table.js";
export { findRegisterTable, parseRegisterTable } from "./register-table.js";
export { findTiRegisterMap, parseTiRegisterMap } from "./ti-register-map.js";
export { findMaximRegisterMap, parseMaximRegisterMap } from "./maxim-register-map.js";
export { detectManufacturer } from "./manufacturer.js";
export { detectPart } from "./part.js";
export { detectInterfaceKind } from "./interface-kind.js";
export { extractCommands, extractCrc, extractProtocol } from "./command.js";
