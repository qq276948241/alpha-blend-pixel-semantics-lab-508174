/* Horizontal align modes for cover, contain, bit masks */
export enum HorizontalAlign {
  LEFT = 1,
  CENTER = 2,
  RIGHT = 4,
}

/* Vertical align modes for cover, contain, bit masks */
export enum VerticalAlign {
  TOP = 8,
  MIDDLE = 16,
  BOTTOM = 32,
}

/**
 * How to blend two images together.
 *
 * The enum is defined in `@jimp/types` and re-exported here so that
 * `import { BlendMode } from "@jimp/core"` and
 * `import { BlendMode } from "@jimp/types"` are the same value and type.
 */
export { BlendMode } from "@jimp/types";
