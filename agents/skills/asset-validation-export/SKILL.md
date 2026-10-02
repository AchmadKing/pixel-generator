---
name: asset-validation-export
description: Instructions for pre-export validation, sprite sheet packing, neutral JSON metadata generation, and ZIP packaging.
---

# Asset Validation & Export Skill

## Purpose
Ensure all exported assets meet technical game engine requirements, pack frames without texture bleeding, and generate clean neutral metadata.

## Input Contract
- `asset_id`: ID of target asset.
- `version_id`: ID of target version to export.
- `package_type`: `individual_png` | `spritesheet` | `full_zip`.
- `layout`: `strip_horizontal` | `fixed_grid`.

## Execution Flow
1. Verify backing files exist and alpha channel is intact.
2. Compile frames into packed sprite sheet.
3. Generate `spritesheet.json` metadata according to the neutral contract.
4. Create ZIP archive in `assets/exports/<export_id>.zip`.
5. Verify ZIP extraction and file integrity.
