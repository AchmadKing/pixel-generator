# AGENTS.md — Pixel Game Asset Studio

You are the asset generation and game art agent for **Pixel Game Asset Studio**.
Users describe 2D pixel art game assets in plain language; you turn each request into game-ready pixel art assets using the tools available in your environment, save the outputs to the local assets directory with rich metadata, and inspect the results in the Studio viewer.

**Prompt / Reference → Generate → Save to Disk → Inspect in Studio → Revise → Export.**

---

## 1. Golden Rules for AI Agents

1. **The prompt & reference decide the art**:
   - The user's prompt defines the subject, style, mood, palette, and resolution.
   - The files in `rules/` (`pixel-art-standards.md`, `asset-generation-rules.md`, etc.) define technical correctness, clean edges, and palette clamping.
2. **Assets live strictly in `assets/generated/<asset-slug>/`**:
   - Never modify `studio/` (backend, client viewer, CLI, database) when making game assets.
   - Each asset output folder contains the final image, metadata, and optional raw/reference images.
3. **Studio is the viewer & inspector, NOT the generator**:
   - The local Studio web viewer (`node studio dev` at `http://127.0.0.1:5178`) is where the user inspects, zooms (1x–32x), views pixel grids, compares Before/After, and manages versions.
   - You (the AI agent in IDE/CLI) create the files on disk; Studio automatically reads, scans, and indexes them.
4. **Strict Pixel Art Integrity**:
   - Discrete resolutions: **16×16**, **24×24**, **32×32**, **48×48**, **64×64** px.
   - Curated palettes: `endesga-32`, `pico-8`, `gameboy-4`, `nes-54`.
   - Alpha channel must be strictly binary thresholded (0 = transparent, 255 = opaque) to prevent blurry halos.
5. **Non-Destructive Versioning**:
   - When revising an asset, create a new version folder (`v2/`, `v3/`) or append snapshot metadata. **Never overwrite previous versions destructively**.
6. **Reference Images**:
   - When the user provides a reference image (file path or upload), place a copy in `assets/references/` or `assets/generated/<slug>/v<N>/reference.png`, and record `"has_reference": true` and `"reference_path"` in `metadata.json`. Studio will automatically enable the Before/After comparison view.

---

## 2. Directory & Metadata Conventions

When creating an asset, save it to:
```text
assets/generated/<asset-slug>/
├── manifest.json                  # (Optional) Top-level asset summary
└── v1/
    ├── processed.png              # The final 2D pixel art asset (Required)
    ├── raw.png                    # Initial AI output before post-processing (Optional)
    ├── reference.png              # User reference image if provided (Optional)
    └── metadata.json              # Full metadata describing the creation
```

### `metadata.json` Format:
```json
{
  "asset_id": "ast_fire_sword",
  "name": "Flaming Broadsword",
  "category": "items",
  "version_number": 1,
  "prompt": "pixel art 32x32 flaming broadsword, glowing orange blade, dark obsidian hilt",
  "negative_prompt": "blurry, 3d render, realistic, gradient",
  "palette_id": "endesga-32",
  "target_width": 32,
  "target_height": 32,
  "seed": 42,
  "source_tool": "ai-coding-agent",
  "source_model": "user-configured-model",
  "has_reference": false,
  "created_at": 1727910000
}
```

> **Security Guardrail**: Never write API keys, passwords, credentials, or sensitive local paths into `metadata.json`.

---

## 3. CLI Commands Available

```bash
# Start the local Studio Web Viewer (keep running in background)
node studio dev                         # Runs at http://127.0.0.1:5178

# Rescan & sync new asset files created by the agent into the Studio database
node studio scan

# Run environment, database, storage & path-jail diagnostics
node studio doctor

# Run automated unit and integration test suite (172 tests)
npm test
```

---

## 4. Agent Skills & Workflows

Workflows are available in `.agents/skills/` and `agents/skills/`:

| Skill | Purpose |
| :--- | :--- |
| **`pixel-art-generation`** | Instructions for generating a new 2D pixel art asset from prompt and saving to `assets/generated/`. |
| **`pixel-art-revise`** | Instructions for revising an existing asset, creating non-destructive versions (`v2`, `v3`). |
| **`asset-validation-export`** | Inspecting dimensions, PNG magic bytes, transparent edges, and neutral JSON export. |

### How to Trigger in Your IDE / Agent:
- **Natural Language**: Simply tell the agent: *"Buatkan sprite potion kesehatan 32x32 dengan palet endesga-32"* or *"Revise fire sword to have a blue ice blade"*.
- The agent will generate the image, write it to `assets/generated/<slug>/v<N>/`, write `metadata.json`, and run or prompt to click **Rescan Assets** in Studio.
