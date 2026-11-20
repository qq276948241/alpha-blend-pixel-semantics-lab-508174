import { expect, test, describe } from "vitest";

import { BlendMode as CoreBlendMode } from "@jimp/core";
import { BlendMode as TypesBlendMode } from "@jimp/types";

import { Jimp, BlendMode } from "./index.js";

type RGBA = [r: number, g: number, b: number, a: number];

function makeImage(width: number, height: number, pixels: RGBA[]) {
  return new Jimp({
    width,
    height,
    data: Buffer.from(pixels.flat()),
  });
}

const featureModes = [
  BlendMode.SRC_OVER,
  BlendMode.MULTIPLY,
  BlendMode.SCREEN,
  BlendMode.OVERLAY,
  BlendMode.DARKEN,
  BlendMode.LIGHTEN,
];

const dstPixels: RGBA[] = [
  [10, 220, 130, 255],
  [180, 40, 90, 64],
  [200, 100, 50, 0],
  [5, 60, 100, 96],
  [33, 77, 111, 200],
  [250, 240, 230, 255],
  [128, 64, 200, 128],
  [0, 0, 0, 0],
  [90, 160, 240, 64],
];
const srcPixels: RGBA[] = [
  [200, 30, 90, 255],
  [128, 64, 200, 128],
  [10, 20, 30, 0],
  [33, 77, 111, 200],
  [5, 60, 100, 96],
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [70, 80, 90, 128],
  [1, 2, 3, 255],
];

describe("BlendMode export identity", () => {
  test("jimp, @jimp/core and @jimp/types export the same enum", () => {
    expect(BlendMode).toBe(CoreBlendMode);
    expect(BlendMode).toBe(TypesBlendMode);
    expect(BlendMode.MULTIPLY).toBe("multiply");
    expect(BlendMode.SCREEN).toBe("screen");
    expect(BlendMode.OVERLAY).toBe("overlay");
    expect(BlendMode.DARKEN).toBe("darken");
    expect(BlendMode.LIGHTEN).toBe("lighten");
  });
});

describe("PNG serialization round-trip", () => {
  for (const mode of featureModes) {
    test(`PNG decode matches the in-memory result (${mode})`, async () => {
      const base = makeImage(3, 3, dstPixels);
      base.composite(makeImage(3, 3, srcPixels), 0, 0, { mode });

      const png = await base.getBuffer("image/png");
      const decoded = await Jimp.read(png);

      expect(decoded.bitmap.width).toBe(3);
      expect(decoded.bitmap.height).toBe(3);
      expect(Array.from(decoded.bitmap.data)).toEqual(
        Array.from(base.bitmap.data),
      );
    });
  }

  test("PNG round-trip preserves partial alpha exactly", async () => {
    const base = makeImage(3, 3, dstPixels);
    base.composite(makeImage(3, 3, srcPixels), -1, 1, {
      mode: BlendMode.OVERLAY,
      opacitySource: 0.6,
    });

    const decoded = await Jimp.read(await base.getBuffer("image/png"));

    expect(Array.from(decoded.bitmap.data)).toEqual(
      Array.from(base.bitmap.data),
    );
  });
});

describe("BMP export drops alpha", () => {
  test("alpha is discarded on BMP round-trip, RGB is preserved", async () => {
    const base = makeImage(3, 3, dstPixels);
    base.composite(makeImage(3, 3, srcPixels), 0, 0, {
      mode: BlendMode.MULTIPLY,
    });

    const decoded = await Jimp.read(await base.getBuffer("image/bmp"));

    // BMP has no alpha channel: every decoded pixel is fully opaque.
    // The rule is "alpha dropped", not "per-channel reversible" — pixels
    // whose alpha was below 255 are not recovered.
    for (let i = 3; i < decoded.bitmap.data.length; i += 4) {
      expect(decoded.bitmap.data[i]).toBe(255);
    }

    for (let i = 0; i < decoded.bitmap.data.length; i += 4) {
      expect(decoded.bitmap.data[i + 0]).toBe(base.bitmap.data[i + 0]);
      expect(decoded.bitmap.data[i + 1]).toBe(base.bitmap.data[i + 1]);
      expect(decoded.bitmap.data[i + 2]).toBe(base.bitmap.data[i + 2]);
    }

    // At least one pixel actually had alpha < 255, so the round-trip
    // observably dropped information.
    expect(
      dstPixels.some(([, , , a]) => a !== 255) ||
        srcPixels.some(([, , , a]) => a !== 255),
    ).toBe(true);
    expect(Array.from(decoded.bitmap.data)).not.toEqual(
      Array.from(base.bitmap.data),
    );
  });

  test("encoding to BMP does not modify the in-memory image", async () => {
    const base = makeImage(3, 3, dstPixels);
    const before = Array.from(base.bitmap.data);

    await base.getBuffer("image/bmp");

    expect(Array.from(base.bitmap.data)).toEqual(before);
  });
});

describe("composite with clone and crop", () => {
  test("compositing a cropped clone does not modify the original", () => {
    const original = makeImage(3, 3, srcPixels);
    const originalData = Array.from(original.bitmap.data);

    const cloned = original.clone();
    cloned.crop({ x: 1, y: 1, w: 2, h: 2 });

    const base = makeImage(3, 3, dstPixels);
    base.composite(cloned, 0, 0, { mode: BlendMode.SCREEN });

    // The source image and its underlying buffer are untouched.
    expect(Array.from(original.bitmap.data)).toEqual(originalData);
    expect(original.bitmap.width).toBe(3);
    expect(original.bitmap.height).toBe(3);

    // The composited result matches a hand-built 2x2 crop of the source.
    const handCropped = makeImage(2, 2, [
      srcPixels[4]!,
      srcPixels[5]!,
      srcPixels[7]!,
      srcPixels[8]!,
    ]);
    const reference = makeImage(3, 3, dstPixels);
    reference.composite(handCropped, 0, 0, { mode: BlendMode.SCREEN });

    expect(Array.from(base.bitmap.data)).toEqual(
      Array.from(reference.bitmap.data),
    );
  });

  test("clones are deep: compositing over a clone leaves the original alone", () => {
    const original = makeImage(3, 3, dstPixels);
    const originalData = Array.from(original.bitmap.data);

    const cloned = original.clone();
    cloned.composite(makeImage(3, 3, srcPixels), 1, 1, {
      mode: BlendMode.DARKEN,
    });

    expect(Array.from(original.bitmap.data)).toEqual(originalData);
    expect(Array.from(cloned.bitmap.data)).not.toEqual(originalData);
  });
});

describe("backwards-compatible default behavior", () => {
  test("omitting options is source-over", () => {
    const withDefault = makeImage(3, 3, dstPixels);
    withDefault.composite(makeImage(3, 3, srcPixels), 1, -1);

    const explicit = makeImage(3, 3, dstPixels);
    explicit.composite(makeImage(3, 3, srcPixels), 1, -1, {
      mode: BlendMode.SRC_OVER,
    });

    expect(Array.from(withDefault.bitmap.data)).toEqual(
      Array.from(explicit.bitmap.data),
    );
  });
});
