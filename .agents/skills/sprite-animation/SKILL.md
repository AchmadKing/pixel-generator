---
name: sprite-animation
description: Instructions for slicing, ordering, and assigning durations to animation frames in Pixel Game Asset Studio.
---

# Sprite Animation Skill

## Purpose
Manage multi-frame sprite animations, enforce consistent anchor points, and register frame metadata in the SQLite database.

## Input Contract
- `version_id`: ID of the parent asset version.
- `frames`: Array of frame specifications containing:
  - `frame_index`: Integer ordering starting at 0.
  - `duration_ms`: Duration in milliseconds (default: 125ms / 8 FPS).
  - `pivot_x`: Normalized horizontal anchor (0.5 for center).
  - `pivot_y`: Normalized vertical anchor (1.0 for bottom-center ground).
  - `file_path`: Path to frame image.

## Execution Flow
1. Verify frame dimensions match canvas size across all frames.
2. Store frame metadata in `asset_frames` table.
3. Validate frame playback in Studio Viewport.
