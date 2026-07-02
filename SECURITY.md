# Security Policy

## Reporting a vulnerability

If you find a security issue in Driverge, please report it privately rather than
opening a public issue:

- Use GitHub's **[Report a vulnerability](https://github.com/MehmetTopuz/driverge-mcp/security/advisories/new)**
  (Security → Advisories), or
- email **mehmettopuz127@gmail.com** with details and reproduction steps.

Please include the affected version, your environment (OS, Node version, MCP
client), and a minimal reproduction. We aim to acknowledge reports within a few
days. As a pre-release project maintained by an individual, response times are
best-effort.

## Supported versions

Driverge is pre-release (`0.x`). Only the latest `main` / most recent published
version receives fixes.

## Scope and threat model

Driverge is a local MCP server. It:

- reads datasheet PDF files from **local paths you provide** (no upload — the
  datasheet never leaves your machine);
- runs a deterministic TypeScript parser (no embedded LLM, no network calls, no
  API keys) and returns structured JSON + generated source files;
- writes generated files only when you pass an explicit `out_dir`.

Relevant considerations when embedding Driverge:

- **Untrusted PDFs.** Parsing is done with `pdfjs-dist`. Treat datasheets from
  unknown sources with the same caution as any untrusted file; report any parser
  crash or resource-exhaustion case you can reproduce.
- **Generated code is not trusted output.** Drivers are drafts completed by a
  host AI and **must be reviewed by a human** before running on hardware. They are
  not verified correct and are not safety-certified. Do not deploy generated
  drivers to safety-critical systems without independent review and testing.
- **File-path input.** `analyze_datasheet` and `generate_driver` act on paths you
  pass; run the server with the least privilege your workflow needs.

## Not security issues

- Incorrect or incomplete generated driver logic (this is expected — output is a
  reviewable draft, see the README disclaimer).
- Parser limitations on unusual datasheet layouts.
