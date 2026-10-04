---
name: asset-review
description: Instructions for inspecting, reviewing, and verifying pixel art assets, file dimensions, PNG format integrity, and metadata.
---

# Asset Review & Inspection Skill

## Purpose
Guide the AI agent in verifying generated pixel art assets, ensuring file format validity, checking dimensions and color fidelity, validating `metadata.json`, and ensuring the asset is correctly indexed by Pixel Game Asset Studio.

## When to Use
Run this skill immediately after generating or revising an asset, or when auditing existing assets in `assets/generated/`.

## Input Contract
- `asset_slug` or path: E.g., `assets/generated/cyber-samurai/v1/`
- `expected_width`: Expected integer width (e.g., 32, 64, 128)
- `expected_height`: Expected integer height (e.g., 32, 64, 128)

## Execution Flow
1. **File Existence & Integrity Check**:
   - Verify that `processed.png` (or `image.png`) exists and is a valid non-zero-byte PNG file.
   - Inspect the first 8 bytes of the file for the PNG magic header (`89 50 4E 47 0D 0A 1A 0A`).
   - Extract dimensions from the IHDR chunk (bytes 16–23). Ensure width and height match expectations.
2. **Metadata Validation**:
   - Check that `metadata.json` exists alongside the image.
   - Verify required fields: `name`, `category`, `width`, `height`, `version`, `created_at`.
   - Ensure no secret tokens or API keys are stored in `metadata.json`.
3. **Reference Verification** (if applicable):
   - If a reference image was used, verify `reference_image` path is recorded in `metadata.json` and points to a valid file.
4. **Trigger Studio Sync**:
   - Run `node studio scan` from terminal or invoke `POST /api/scan` on the local Studio server.
   - Verify that the asset appears in the Studio gallery and is inspectable in the Asset Details panel.
