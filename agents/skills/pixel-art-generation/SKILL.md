---
name: pixel-art-generation
description: Instructions for requesting 2D pixel art generation using configured providers with strict resolution and palette constraints.
---

# Pixel Art Generation Skill

## Purpose
Guide the AI agent or system operator in creating 2D pixel art assets through the studio pipeline.

## Input Contract
- `prompt`: Detailed description of the visual asset.
- `category`: One of `['characters', 'items', 'environment', 'vfx', 'ui']`.
- `target_width`: Integer pixel dimension (16, 24, 32, 48, 64, 128).
- `target_height`: Integer pixel dimension.
- `palette_id`: Name of target Lospec palette (`endesga-32`, `pico-8`, `db32`, `gameboy-4`).
- `negative_prompt`: Optional negative constraints.

## Execution Flow
1. Verify provider readiness (`node studio doctor`).
2. Dispatch job to local studio queue.
3. Await completion and verify output in `assets/generated/<asset_id>/<version_id>/`.
4. Ensure `raw.png` and `processed.png` are valid PNGs.
