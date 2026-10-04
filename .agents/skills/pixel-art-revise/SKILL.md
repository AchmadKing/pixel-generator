---
name: pixel-art-revise
description: Instructions for revising or creating variations of an existing 2D pixel art asset without destroying previous version history.
---

# Pixel Art Revision & Variation Skill

## Purpose
Guide the AI agent in modifying or creating a new variation of an existing game asset (e.g. changing color palette, adding a glow, altering armor/weapon design) in a strictly non-destructive manner.

## Step-by-Step Workflow

1. **Locate Existing Asset**:
   - Check `assets/generated/<asset-slug>/`.
   - Read the latest version's `metadata.json` (e.g. `v1/metadata.json`) to understand its base prompt, dimensions, and palette.

2. **Determine Next Version Number**:
   - Scan subdirectories for highest `v<N>` (e.g. `v1` $\to$ next is `v2`).

3. **Generate Revised Image**:
   - Apply user requested modifications (e.g., "make the blade blue ice instead of fire").
   - Maintain consistent resolution and pixel grid with `v1`.

4. **Save Non-Destructively**:
   - Create: `assets/generated/<asset-slug>/v<N>/`.
   - Save: `assets/generated/<asset-slug>/v<N>/processed.png`.
   - Write: `assets/generated/<asset-slug>/v<N>/metadata.json` referencing `parent_version: "v<N-1>"`.

5. **Notify & Inspect**:
   - User can open Studio at `http://127.0.0.1:5178`, click **Rescan Assets**, and view the version history timeline under the **History** tab to compare snapshots or rollback.
