# Export Rules & Neutral Contract

## 1. Supported Export Packages
Every asset export must produce a neutral, standard archive:
- `spritesheet.png`: Packed 32-bit RGBA PNG with transparency.
- `spritesheet.json`: Standardized neutral metadata with frame coordinates `{x, y, w, h}`, duration, and pivot.
- `frames/`: Directory of individual frame PNGs.
- `palette.hex`: Plain text list of unique hex colors used.
- `manifest.json`: Asset provenance, version number, prompt, and license info.

## 2. Zero AI Regeneration Guarantee
- Re-exporting an asset must strictly read existing disk files and SQLite metadata.
- Re-exporting never triggers an AI API call.

## 3. Atomic Export Packaging
- Export packages are compiled in a staging folder before being archived into `assets/exports/<id>.zip`.
- If compression or file generation fails, partial files must be deleted.
