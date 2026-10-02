# Pixel Art Standards & Technical Guidelines

## 1. Grid & Resolution Standards
- All assets must align to integer pixel grids.
- Standard discrete resolutions:
  - **16x16 px**: Small items, UI icons, micro-props, small enemies.
  - **24x24 px**: Standard item icons, compact character portraits.
  - **32x32 px**: Standard game characters, weapons, props, tilesets.
  - **48x48 px**: Large characters, detailed portraits, boss units.
  - **64x64 px**: Large monsters, terrain landmarks, complex interactive props.
  - **128x128 px**: Background elements, oversized boss creatures.

## 2. Rendering & Scaling Rules
- Always use **Nearest-Neighbor integer scaling** (1x, 2x, 4x, 8x, 16x).
- Anti-aliasing (blur/semi-transparent edge interpolation) is strictly forbidden for pixel art assets.
- Alpha channel must be strictly binary thresholded (0 = fully transparent, 255 = fully opaque) to avoid semi-transparent edge halos.

## 3. Palette & Color Management
- Color palettes must be restricted to curated game-ready palettes (Lospec standard).
- Standard presets:
  - `endesga-32`: 32 versatile fantasy game colors.
  - `pico-8`: 16 vibrant retro console colors.
  - `dawnbringer-32 (db32)`: 32 balanced organic colors.
  - `gameboy-4`: 4-shade classic monochrome green.
- Color quantization uses **CIELAB Delta-E ($\Delta E$)** color space distance rather than linear RGB Euclidean distance to match human optical perception.

## 4. Outline & Silhouette Discipline
- Outlines must be consistent across an asset set (e.g. 1px dark contour or selective outline / sel-out).
- Orphan pixels (isolated 1x1 noise pixels) should only exist if they represent deliberate details (e.g. pupil, sword glint, potion highlight).
