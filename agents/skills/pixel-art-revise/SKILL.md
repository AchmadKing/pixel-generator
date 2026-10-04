---
name: pixel-art-revise
description: Instructions for revising, enhancing, or creating non-destructive variations of existing pixel art assets.
---

# Pixel Art Revision Skill

## Purpose
Guide the AI agent in creating a new version of an existing asset (e.g., color tweaks, weapon upgrades, outfit variations) without overwriting past versions.

## Step-by-Step Workflow

1. **Locate Existing Asset**:
   - Check `assets/generated/<asset-slug>/`.
   - Identify latest version (e.g. `v1`, `v2`).

2. **Understand Revision Request**:
   - Determine target changes (e.g. "change tunic color to blue", "add glowing runes to blade", "increase canvas to 48x48").
   - Read `v1/metadata.json` to get original prompt, palette, and dimensions.

3. **Generate Revised Asset**:
   - Use `v1/processed.png` as visual reference if supported by the image tool.
   - Or modify prompt with specific revision instructions.

4. **Save Non-Destructively**:
   - Calculate next version: e.g. `v2` (or `v3`).
   - Create directory `assets/generated/<asset-slug>/v2/`.
   - Save revised image as `assets/generated/<asset-slug>/v2/processed.png`.
   - Save updated `v2/metadata.json` with `version_number: 2`, `parent_version: 1`, and `change_summary`.

5. **Notify User**:
   - Inform user of `v2` creation.
   - User can inspect Before (v1) vs After (v2) in Studio.
