# Contributing to Driverge

Driverge is a client-agnostic MCP server that turns IC datasheet PDFs into
embedded C/C++ drivers. Thanks for your interest in contributing.

> **Pre-release.** The project is under active development toward `v0.1.0`.
> Interfaces and the datasheet JSON schema are not yet stable.

## Development setup

Requires Node.js **>= 18** (contributors: Node 20+ recommended for the dev
toolchain).

```bash
npm install        # install dev dependencies
npm run build      # compile src/ -> dist/ (tsc)
npm run typecheck  # type-check without emitting
npm test           # run the vitest suite
npm run test:watch # watch mode
```

## Commit convention

Commits use the house format:

```
Title : message
```

One space on each side of the colon. `message` is imperative mood, no trailing
period, subject line ≤ ~72 chars. An optional body (after a blank line)
explains *why*.

`Title` is drawn from the curated area vocabulary:

| Title        | Use for                                                        |
| ------------ | -------------------------------------------------------------- |
| `MCP Server` | tools / resources / prompts, server wiring                     |
| `Parser`     | PDF pipeline, table/text extraction, manufacturer detection    |
| `Codegen`    | skeleton rendering, hybrid fill-in markers                     |
| `Schema`     | datasheet JSON schema / contract                               |
| `Templates`  | per-target template files                                      |
| `Validation` | validators, static checks                                      |
| `Tests`      | vitest units, snapshots, compile gate, fixtures                |
| `Docs`       | README, docs, doc comments                                     |
| `CI`         | GitHub Actions workflows                                       |
| `Build`      | package.json, tsconfig, build scripts, deps                    |
| `Repo`       | .gitignore, LICENSE, housekeeping                              |
| `Release`    | version bump + tag commits                                     |

AI-authored commits append a trailer, e.g.:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## Branching

- One short-lived branch per unit of work (a roadmap session or coherent
  change), kebab-case and type-prefixed: `feat/…`, `fix/…`, `docs/…`,
  `test/…`, `refactor/…`, `chore/…`, `ci/…`, `build/…`.
- `main` is always releasable — never commit feature work directly to it.
- Merge the branch back to `main` and delete it.

> PR + GitHub Actions CI gating and branch protection on `main` are stood up in
> the pre-release hardening session; until then, branches merge to `main`
> locally.

## Test-driven workflow

Development follows a three-role TDD split:

- The **orchestrator** defines contracts (function signatures, JSON schema).
- **`driverge-tdd`** owns `tests/` — writes the failing tests first (RED).
- **`driverge-coder`** owns `src/` and `templates/` — makes the tests pass
  (GREEN); it runs the tests but never edits them.

Both agents commit onto the same feature branch, so `main` sees a clean
`Tests : …` then `Parser/Codegen/… : …` narrative.
