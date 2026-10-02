---
name: tileset-generation
description: Instructions for autotile 16-tile and 47-tile bitmask generation, seamless edge validation, and tile previewing.
---

# Tileset Generation Skill

## Purpose
Guide the generation and validation of 2D environment tilesets, terrain transitions, and autotile bitmasks.

## Input Contract
- `terrain_type`: Ground, wall, platform, liquid.
- `tile_size`: Integer (e.g. 16x16, 32x32).
- `bitmask_type`: 3x3 minimal (16-tile) or full blob (47-tile).

## Execution Flow
1. Generate base tiles with consistent edge transitions.
2. Validate seamless connectivity across adjacent borders.
3. Verify autotile alignment using the 3x3 Studio preview stamp.
