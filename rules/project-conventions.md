# Project Conventions & Architecture Guidelines

## 1. Directory Structure Conventions
- `rules/`: Authoritative standards and guidelines for pixel generation and export.
- `agents/skills/`: Executable capability guides for coding agents.
- `assets/`: Data storage:
  - `assets/projects/`: Project workspace metadata.
  - `assets/generated/<asset_id>/<version_id>/`: Binary outputs (`raw.png`, `processed.png`).
  - `assets/exports/`: Packaged ZIP downloads.
  - `assets/references/`: User-uploaded reference images.
  - `assets/studio.db`: ACID metadata database (SQLite).
- `studio/server/`: Backend server modules (ESM).
- `studio/client/`: Web Studio frontend (Vanilla JS/CSS).
- `studio/cli/`: Command-line tools (`node studio doctor`, `node studio dev`).
- `tests/`: Automated test suite (`node:test`).

## 2. Coding Conventions
- Native ESM modules only (`import`/`export`).
- Use Node.js built-in APIs (`node:sqlite`, `node:fs`, `node:path`, `node:test`, `node:assert`).
- Avoid native binary compilation dependencies.
- All file paths must be validated using `resolveSafePath` against directory traversal attacks.
