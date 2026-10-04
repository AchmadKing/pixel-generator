---
name: pixel-art-generation
description: Instructions for AI coding agents to generate 2D pixel art game assets using available image generation tools, saving to assets/generated/ with metadata.
---

# Pixel Art Generation Skill

## Purpose
Guide the AI agent in generating a new 2D pixel art game asset based on user prompt, saving the image and metadata to disk, and preparing it for Studio inspection.

## Step-by-Step Workflow

1. **Understand Requirements**:
   - Extract subject (e.g., sword, health potion, slime monster).
   - Category: `items`, `characters`, `environment`, `vfx`, or `ui`.
   - Resolution: 16×16, 24×24, 32×32, 48×48, or 64×64 px.
   - Target palette: `endesga-32`, `pico-8`, `gameboy-4`, or `nes-54`.
   - Check if user provided a reference image (file path or upload).

2. **Generate the Image**:
   - Use the image generation tool available in your environment (e.g., `generate_image`).
   - If a reference image was provided, pass it as reference or adhere to its shapes/proportions.
   - Ensure pixel art aesthetic: flat vibrant colors, crisp silhouettes, zero blurry gradients.

3. **Save to Assets Directory**:
   - Choose a slug: e.g. `health-potion` or `ast_health_potion`.
   - Create directory: `assets/generated/<asset-slug>/v1/`.
   - Save the primary pixel art image as: `assets/generated/<asset-slug>/v1/processed.png`.
   - (Optional) If raw generation exists, save as `assets/generated/<asset-slug>/v1/raw.png`.
   - (Optional) If reference was provided, save a copy as `assets/generated/<asset-slug>/v1/reference.png`.

4. **Write `metadata.json`**:
   Save `assets/generated/<asset-slug>/v1/metadata.json` with fields:
   ```json
   {
     "asset_id": "<asset-slug>",
     "name": "<Human Readable Name>",
     "category": "<items|characters|environment|vfx|ui>",
     "version_number": 1,
     "prompt": "<Full prompt used>",
     "negative_prompt": "<Negative prompt if any>",
     "palette_id": "<palette-name>",
     "target_width": 32,
     "target_height": 32,
     "has_reference": false,
     "source_tool": "ai-agent",
     "created_at": <unix-timestamp>
   }
   ```

5. **Notify User & Studio**:
   - Inform the user of the saved asset path.
   - Mention that they can view, zoom, and inspect the pixel art in **Pixel Game Asset Studio** (`http://127.0.0.1:5178`) by clicking **"Rescan Assets"** or running `node studio scan`.
