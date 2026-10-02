# Animation Standards & Frame Sequencing Rules

## 1. Frame Rate & Timing
- Default frame rate for 2D pixel art: **8 FPS** (125 ms per frame) or **12 FPS** (83 ms per frame).
- Every frame must have an explicit duration stored in milliseconds (`duration_ms`).

## 2. Pivot & Anchor Points
- All character animations must share a consistent bottom-center anchor point: `pivot_x = 0.5`, `pivot_y = 1.0` (ground contact at bottom edge).
- Item and projectile animations use center anchor: `pivot_x = 0.5`, `pivot_y = 0.5`.
- Inconsistent anchor points cause sprite jittering during playback.

## 3. Frame Dimensions & Bounding Boxes
- All frames within an animation clip must share identical canvas dimensions (`width`, `height`).
- When packed into a sprite sheet, frames must align cleanly to cell borders.
