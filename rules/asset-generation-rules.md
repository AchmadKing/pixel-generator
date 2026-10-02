# Asset Generation Rules & Prompt Conventions

## 1. Prompt Structure for Pixel Art
Every generation request should follow a structured prompt template:
- `[Subject]` + `[Pixel art style specification]` + `[Size/Resolution]` + `[Contrast Background]` + `[Negative prompt constraints]`

Example for Items:
- **Prompt**: `"pixel art, 32x32 sprite, fantasy health potion bottle with glowing red liquid, clean solid magenta background #FF00FF, crisp clean edges, flat colors"`
- **Negative Prompt**: `"blurry, 3d render, realistic, gradient background, anti-aliased edges, noisy dithering, soft shadows"`

## 2. Solid Background Protocol for Clean Cutout
- Always enforce a high-contrast solid background (`#FF00FF` Magenta or `#00FF00` Lime Green).
- The background color must not be present in the asset's palette.
- Background removal uses an exact chroma tolerance threshold before color quantization.

## 3. Post-Processing Pipeline Execution Order
1. **Raw Storage**: Save raw input as `raw.png` (immutable).
2. **Alpha Cutout**: Chroma key removal of solid backdrop.
3. **Nearest Downsampling**: Rescale to target integer grid.
4. **CIELAB Palette Clamping**: Remap colors to selected Lospec palette.
5. **Conservative Clean**: Remove true noise without eroding intentional single-pixel features.
6. **Processed Storage**: Save result as `processed.png`.
