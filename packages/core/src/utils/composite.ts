import { Edge, JimpClass, RGBAColor } from "@jimp/types";

import { BlendMode } from "./constants.js";
import * as compositeModes from "./composite-modes.js";
import { limit255 } from "@jimp/utils";

type BlendFunction = (
  src: RGBAColor,
  dst: RGBAColor,
  ops?: number,
) => RGBAColor;

/**
 * Convert a blended channel value (0–1 float) to an 8-bit channel value.
 *
 * Rounding rule: the floating point result is rounded to the nearest
 * integer (`Math.round`, ties round up) and then clamped into the
 * 0–255 range. Values are never written as raw floats, so results do not
 * depend on typed-array conversion behavior.
 */
function to8Bit(value: number) {
  return limit255(Math.round(value));
}

function assertBitmapIntegrity(image: JimpClass, role: string) {
  const { bitmap } = image;

  if (
    !bitmap ||
    !Number.isInteger(bitmap.width) ||
    !Number.isInteger(bitmap.height) ||
    bitmap.width < 0 ||
    bitmap.height < 0
  ) {
    throw new Error(
      `The ${role} image has a corrupt bitmap: width and height must be non-negative integers`,
    );
  }

  const expectedLength = bitmap.width * bitmap.height * 4;

  if (
    !bitmap.data ||
    typeof bitmap.data.length !== "number" ||
    bitmap.data.length < expectedLength
  ) {
    throw new Error(
      `The ${role} image has a corrupt bitmap: expected at least ${expectedLength} bytes for a ${bitmap.width}x${bitmap.height} image, got ${bitmap.data?.length ?? "none"}`,
    );
  }
}

/**
 * Composite `src` over `baseImage` at offset (`x`, `y`).
 *
 * Semantics and edge rules:
 *
 * - The blend mode's color formula is applied to the straight (unmultiplied)
 *   colors first; the result is then composited with Porter-Duff source-over
 *   alpha. See `composite-modes.ts` for the exact formulas.
 * - When both pixels are fully transparent the result is transparent black
 *   (`0x00000000`); the hidden RGB of fully transparent pixels is dropped.
 * - Blended channels are rounded to the nearest 8-bit value (ties up) and
 *   clamped to 0–255.
 * - Parts of `src` that fall outside `baseImage` (including negative
 *   offsets) are cropped away.
 * - If `src` and `baseImage` are the same instance or share the same
 *   underlying pixel buffer, the source pixels are snapshotted before any
 *   writes, so the traversal order cannot affect the result.
 * - `src` is never modified. `baseImage` is only modified after all
 *   arguments have been validated — invalid modes, coordinates or corrupt
 *   bitmaps throw before anything is written.
 *
 * @param baseImage the image to composite onto (modified and returned)
 * @param src the image to composite over the base image
 * @param x the x offset of the source image (rounded to an integer)
 * @param y the y offset of the source image (rounded to an integer)
 * @param options the blend {@link BlendMode} and optional source/destination opacities
 */
export function composite<I extends JimpClass>(
  baseImage: I,
  src: I,
  x = 0,
  y = 0,
  options: {
    mode?: BlendMode;
    opacitySource?: number;
    opacityDest?: number;
  } = {},
) {
  if (!(src instanceof baseImage.constructor)) {
    throw new Error("The source must be a Jimp image");
  }

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error("x and y must be finite numbers");
  }

  const { mode = BlendMode.SRC_OVER } = options;
  let { opacitySource = 1.0, opacityDest = 1.0 } = options;

  const blendmode = (
    compositeModes as unknown as Record<string, BlendFunction | undefined>
  )[mode];

  if (!blendmode) {
    throw new Error(
      `Unsupported composite mode: ${JSON.stringify(
        mode,
      )}. Supported modes: ${Object.values(BlendMode).join(", ")}`,
    );
  }

  // Validate both bitmaps up front so a corrupt bitmap can never leave
  // the base image partially written.
  assertBitmapIntegrity(baseImage, "base");
  assertBitmapIntegrity(src, "source");

  if (
    typeof opacitySource !== "number" ||
    opacitySource < 0 ||
    opacitySource > 1
  ) {
    opacitySource = 1.0;
  }

  if (typeof opacityDest !== "number" || opacityDest < 0 || opacityDest > 1) {
    opacityDest = 1.0;
  }

  // round input
  x = Math.round(x);
  y = Math.round(y);

  // If the source and destination share pixel storage (same instance, same
  // Buffer, or two views over the same ArrayBuffer), writes to the
  // destination would be observed by later source reads. Snapshot the
  // source first so the result is independent of traversal order.
  const sharesStorage =
    src.bitmap.data === baseImage.bitmap.data ||
    src.bitmap.data.buffer === baseImage.bitmap.data.buffer;

  const srcData = sharesStorage
    ? Uint8Array.prototype.slice.call(src.bitmap.data)
    : src.bitmap.data;

  if (opacityDest !== 1.0) {
    baseImage.scan((_, __, idx) => {
      const v = baseImage.bitmap.data[idx + 3]! * opacityDest;
      baseImage.bitmap.data[idx + 3] = v;
    });
  }

  src.scan((sx, sy, idx) => {
    const dstIdx = baseImage.getPixelIndex(x + sx, y + sy, Edge.CROP);

    if (dstIdx === -1) {
      // Skip target pixels outside of dst
      return;
    }

    const blended = blendmode(
      {
        r: srcData[idx + 0]! / 255,
        g: srcData[idx + 1]! / 255,
        b: srcData[idx + 2]! / 255,
        a: srcData[idx + 3]! / 255,
      },
      {
        r: baseImage.bitmap.data[dstIdx + 0]! / 255,
        g: baseImage.bitmap.data[dstIdx + 1]! / 255,
        b: baseImage.bitmap.data[dstIdx + 2]! / 255,
        a: baseImage.bitmap.data[dstIdx + 3]! / 255,
      },
      opacitySource,
    );

    baseImage.bitmap.data[dstIdx + 0] = to8Bit(blended.r * 255);
    baseImage.bitmap.data[dstIdx + 1] = to8Bit(blended.g * 255);
    baseImage.bitmap.data[dstIdx + 2] = to8Bit(blended.b * 255);
    baseImage.bitmap.data[dstIdx + 3] = to8Bit(blended.a * 255);
  });

  return baseImage;
}
