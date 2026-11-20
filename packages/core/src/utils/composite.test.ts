import { describe, expect, test } from "vitest";

import { BlendMode as TypesBlendMode } from "@jimp/types";

import { createJimp } from "../index.js";
import { composite } from "./composite.js";
import { BlendMode } from "./constants.js";
import * as compositeModes from "./composite-modes.js";

const Jimp = createJimp();

type RGBA = [r: number, g: number, b: number, a: number];

function makeImage(width: number, height: number, pixels: RGBA[]) {
  expect(pixels.length).toBe(width * height);

  return new Jimp({
    width,
    height,
    data: Buffer.from(pixels.flat()),
  });
}

function pixelsOf(image: { bitmap: { data: Uint8Array } }): number[] {
  return Array.from(image.bitmap.data);
}

/** clamp + round-to-nearest, the documented 8-bit rule */
function to8Bit(v: number) {
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

interface FloatColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function toFloat([r, g, b, a]: RGBA): FloatColor {
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

/**
 * Blend functions B(cs, cd) from W3C "Compositing and Blending Level 1",
 * operating on straight (unmultiplied) 0–1 colors. `dstOver` has no blend
 * function (it is a pure Porter-Duff operator) and is handled separately.
 */
const blendFunctions: Record<string, (cs: number, cd: number) => number> = {
  srcOver: (cs) => cs,
  multiply: (cs, cd) => cs * cd,
  add: (cs, cd) => cs + cd,
  screen: (cs, cd) => cs + cd - cs * cd,
  overlay: (cs, cd) => (cd <= 0.5 ? 2 * cs * cd : 1 - 2 * (1 - cs) * (1 - cd)),
  darken: (cs, cd) => Math.min(cs, cd),
  lighten: (cs, cd) => Math.max(cs, cd),
  hardLight: (cs, cd) =>
    cs <= 0.5 ? 2 * cs * cd : 1 - 2 * (1 - cs) * (1 - cd),
  difference: (cs, cd) => Math.abs(cd - cs),
  exclusion: (cs, cd) => cd + cs - 2 * cd * cs,
};

/**
 * Independent straight-alpha reference: apply the blend function to the
 * unmultiplied colors, then Porter-Duff source-over composite:
 *
 *   αo = αs + αb·(1 − αs)
 *   co = (αs·(1−αb)·cs + αs·αb·B(cs, cd) + αb·(1−αs)·cd) / αo
 *
 * Fully transparent results are defined as transparent black.
 */
function referenceComposite(
  mode: BlendMode,
  src: RGBA,
  dst: RGBA,
  ops = 1,
): RGBA {
  const s = toFloat(src);
  const d = toFloat(dst);

  const as = s.a * ops;
  const ad = d.a;
  const ao = as + ad * (1 - as);

  if (ao === 0) {
    return [0, 0, 0, 0];
  }

  if (mode === BlendMode.DST_OVER) {
    // Porter-Duff "destination over": roles swapped.
    const co = (cs: number, cd: number) => (ad * cd + as * cs * (1 - ad)) / ao;

    return [
      to8Bit(co(s.r, d.r)),
      to8Bit(co(s.g, d.g)),
      to8Bit(co(s.b, d.b)),
      to8Bit(ao),
    ];
  }

  const B = blendFunctions[mode]!;

  const co = (cs: number, cd: number) =>
    (as * (1 - ad) * cs + as * ad * B(cs, cd) + ad * (1 - as) * cd) / ao;

  return [
    to8Bit(co(s.r, d.r)),
    to8Bit(co(s.g, d.g)),
    to8Bit(co(s.b, d.b)),
    to8Bit(ao),
  ];
}

const allModes = Object.values(BlendMode);

/** The five new modes this feature adds, plus the pre-existing default. */
const featureModes = [
  BlendMode.SRC_OVER,
  BlendMode.MULTIPLY,
  BlendMode.SCREEN,
  BlendMode.OVERLAY,
  BlendMode.DARKEN,
  BlendMode.LIGHTEN,
];

describe("BlendMode exports", () => {
  test("core and @jimp/types export the same BlendMode", () => {
    expect(BlendMode).toBe(TypesBlendMode);
  });

  test("mode strings for the feature modes", () => {
    expect(BlendMode.SRC_OVER).toBe("srcOver");
    expect(BlendMode.MULTIPLY).toBe("multiply");
    expect(BlendMode.SCREEN).toBe("screen");
    expect(BlendMode.OVERLAY).toBe("overlay");
    expect(BlendMode.DARKEN).toBe("darken");
    expect(BlendMode.LIGHTEN).toBe("lighten");
  });

  test("every BlendMode value resolves to a blend function", () => {
    for (const mode of allModes) {
      expect(
        typeof (compositeModes as Record<string, unknown>)[mode],
        mode,
      ).toBe("function");
    }
    expect(compositeModes.names.length).toBe(allModes.length);
  });
});

describe("blend mode color formulas", () => {
  // Opaque/semi-transparent combinations with distinct channel values.
  const pairs: { src: RGBA; dst: RGBA }[] = [
    { src: [200, 30, 90, 255], dst: [10, 220, 130, 255] },
    { src: [128, 64, 200, 128], dst: [10, 128, 255, 255] },
    { src: [250, 240, 230, 255], dst: [5, 60, 100, 96] },
    { src: [33, 77, 111, 200], dst: [180, 40, 90, 64] },
    { src: [0, 0, 0, 255], dst: [255, 255, 255, 255] },
    { src: [255, 255, 255, 255], dst: [0, 0, 0, 255] },
  ];

  for (const mode of allModes) {
    test(`${mode} matches the straight-alpha reference`, () => {
      for (const { src, dst } of pairs) {
        const base = makeImage(1, 1, [dst]);
        const over = makeImage(1, 1, [src]);

        base.composite(over, 0, 0, { mode });

        expect(pixelsOf(base), `${mode} ${src} over ${dst}`).toEqual(
          referenceComposite(mode, src, dst),
        );
      }
    });
  }

  test("alpha formula is source-over for every blend mode", () => {
    const alphas = [0, 64, 128, 200, 255];

    for (const mode of allModes) {
      for (const sa of alphas) {
        for (const da of alphas) {
          const src: RGBA = [90, 160, 240, sa];
          const dst: RGBA = [200, 30, 60, da];

          const base = makeImage(1, 1, [dst]);
          base.composite(makeImage(1, 1, [src]), 0, 0, { mode });

          const as = sa / 255;
          const ad = da / 255;
          const expectedAlpha = to8Bit(as + ad * (1 - as));

          expect(
            base.bitmap.data[3],
            `${mode} alpha for src.a=${sa} dst.a=${da}`,
          ).toBe(expectedAlpha);
        }
      }
    }
  });

  test("blend functions do not mutate their inputs", () => {
    const src = { r: 0.5, g: 0.25, b: 0.75, a: 0.5 };
    const dst = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 };

    for (const mode of allModes) {
      const fn = (
        compositeModes as Record<string, typeof compositeModes.srcOver>
      )[mode]!;
      fn({ ...src }, { ...dst }, 0.5);

      const frozenSrc = { ...src };
      const frozenDst = { ...dst };
      fn(frozenSrc, frozenDst, 0.5);

      expect(frozenSrc, mode).toEqual(src);
      expect(frozenDst, mode).toEqual(dst);
    }
  });
});

describe("fully transparent pixels", () => {
  test("transparent over transparent is transparent black, hidden RGB dropped", () => {
    for (const mode of allModes) {
      const base = makeImage(1, 1, [[200, 100, 50, 0]]);
      const over = makeImage(1, 1, [[10, 20, 30, 0]]);

      base.composite(over, 0, 0, { mode });

      expect(pixelsOf(base), mode).toEqual([0, 0, 0, 0]);
    }
  });

  test("transparent source with hidden RGB leaves destination untouched", () => {
    for (const mode of allModes) {
      const base = makeImage(1, 1, [[200, 100, 50, 255]]);
      const over = makeImage(1, 1, [[10, 20, 30, 0]]);

      base.composite(over, 0, 0, { mode });

      expect(pixelsOf(base), mode).toEqual([200, 100, 50, 255]);
    }
  });

  test("opaque source over transparent destination with hidden RGB gives the source", () => {
    for (const mode of allModes) {
      const base = makeImage(1, 1, [[200, 100, 50, 0]]);
      const over = makeImage(1, 1, [[10, 20, 30, 255]]);

      base.composite(over, 0, 0, { mode });

      expect(pixelsOf(base), mode).toEqual([10, 20, 30, 255]);
    }
  });

  test("blend functions never produce NaN for zero-alpha inputs", () => {
    const transparent = { r: 0.5, g: 0.25, b: 0.75, a: 0 };
    const opaque = { r: 0.1, g: 0.2, b: 0.3, a: 1 };

    for (const mode of allModes) {
      const fn = (
        compositeModes as Record<string, typeof compositeModes.srcOver>
      )[mode]!;

      for (const result of [
        fn({ ...transparent }, { ...transparent }),
        fn({ ...transparent }, { ...opaque }),
        fn({ ...opaque }, { ...transparent }),
      ]) {
        for (const channel of [result.r, result.g, result.b, result.a]) {
          expect(Number.isFinite(channel), mode).toBe(true);
        }
      }

      expect(fn({ ...transparent }, { ...transparent })).toEqual({
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      });
    }
  });
});

describe("geometry", () => {
  // 3x2 destination, each pixel identifiable by its red channel.
  // dst pixel i = [10 + i, 0, 0, 255]; src pixel j = [0, 100 + j, 0, 255]
  const dstPixels: RGBA[] = [
    [10, 0, 0, 255],
    [11, 0, 0, 255],
    [12, 0, 0, 255],
    [13, 0, 0, 255],
    [14, 0, 0, 255],
    [15, 0, 0, 255],
  ];
  const srcPixels: RGBA[] = [
    [0, 100, 0, 255],
    [0, 101, 0, 255],
    [0, 102, 0, 255],
    [0, 103, 0, 255],
  ];

  function expectedAfter(
    srcW: number,
    srcH: number,
    x: number,
    y: number,
    mode = BlendMode.SRC_OVER,
  ) {
    const expected = dstPixels.map((p) => [...p] as RGBA);

    for (let sy = 0; sy < srcH; sy++) {
      for (let sx = 0; sx < srcW; sx++) {
        const dx = x + sx;
        const dy = y + sy;

        if (dx < 0 || dx >= 3 || dy < 0 || dy >= 2) {
          continue;
        }

        expected[dy * 3 + dx] = referenceComposite(
          mode,
          srcPixels[sy * srcW + sx]!,
          dstPixels[dy * 3 + dx]!,
        );
      }
    }

    return expected.flat();
  }

  test("source larger than destination is cropped", () => {
    // 4x3 src with pixels numbered 100..111 in row-major order.
    const bigSrc: RGBA[] = Array.from(
      { length: 12 },
      (_, j) => [0, 100 + j, 0, 255] as RGBA,
    );

    const base = makeImage(3, 2, dstPixels);
    base.composite(makeImage(4, 3, bigSrc), 0, 0);

    // Only the top-left 3x2 of src lands.
    const expected = dstPixels.map((_, i) => {
      const sx = i % 3;
      const sy = Math.floor(i / 3);
      return [0, 100 + sy * 4 + sx, 0, 255];
    });

    expect(pixelsOf(base)).toEqual(expected.flat());
  });

  test("negative offset crops the source", () => {
    const base = makeImage(3, 2, dstPixels);
    base.composite(makeImage(2, 2, srcPixels), -1, -1);

    // Only src pixel (1,1) = 103 lands, at dst (0,0).
    expect(pixelsOf(base)).toEqual([
      0,
      103,
      0,
      255,
      ...dstPixels.slice(1).flat(),
    ]);
  });

  test("source exactly edge-aligned with the destination corner", () => {
    const base = makeImage(3, 2, dstPixels);
    // 2x1 src placed so its right and bottom edges align with the dst edges.
    base.composite(makeImage(2, 1, srcPixels.slice(0, 2)), 1, 1);

    expect(pixelsOf(base)).toEqual([
      ...dstPixels.slice(0, 4).flat(),
      0,
      100,
      0,
      255,
      0,
      101,
      0,
      255,
    ]);
  });

  test("source completely outside leaves the destination unchanged", () => {
    const base = makeImage(3, 2, dstPixels);
    base.composite(makeImage(2, 2, srcPixels), 10, 0);
    base.composite(makeImage(2, 2, srcPixels), 0, -5);

    expect(pixelsOf(base)).toEqual(dstPixels.flat());
  });

  test("fractional offsets are rounded", () => {
    const a = makeImage(3, 2, dstPixels);
    a.composite(makeImage(1, 1, [srcPixels[0]!]), 0.4, 0.6);

    const b = makeImage(3, 2, dstPixels);
    b.composite(makeImage(1, 1, [srcPixels[0]!]), 0, 1);

    expect(pixelsOf(a)).toEqual(pixelsOf(b));
  });

  test("each feature mode lands on the right pixels when cropped", () => {
    for (const mode of featureModes) {
      const base = makeImage(3, 2, dstPixels);
      base.composite(makeImage(2, 2, srcPixels), 2, 1, { mode });

      expect(pixelsOf(base), mode).toEqual(expectedAfter(2, 2, 2, 1, mode));
    }
  });
});

describe("aliasing between source and destination", () => {
  const pixels: RGBA[] = [
    [200, 30, 90, 255],
    [10, 220, 130, 128],
    [90, 160, 240, 64],
    [33, 77, 111, 200],
    [250, 240, 230, 255],
    [5, 60, 100, 96],
    [128, 64, 200, 128],
    [180, 40, 90, 255],
    [0, 0, 0, 0],
  ];

  for (const mode of featureModes) {
    test(`same instance as source and destination (${mode})`, () => {
      const aliased = makeImage(3, 3, pixels);
      aliased.composite(aliased, 1, 1, { mode });

      const reference = makeImage(3, 3, pixels);
      reference.composite(makeImage(3, 3, pixels), 1, 1, { mode });

      expect(pixelsOf(aliased)).toEqual(pixelsOf(reference));
    });

    test(`shared underlying buffer (${mode})`, () => {
      const shared = Buffer.from(pixels.flat());
      const a = new Jimp({ width: 3, height: 3, data: shared });
      const b = new Jimp({ width: 3, height: 3, data: shared });

      a.composite(b, 1, 1, { mode });

      const reference = makeImage(3, 3, pixels);
      reference.composite(makeImage(3, 3, pixels), 1, 1, { mode });

      expect(pixelsOf(a)).toEqual(pixelsOf(reference));
    });

    test(`two views over one ArrayBuffer (${mode})`, () => {
      const buffer = new ArrayBuffer(pixels.length * 4);
      const a = new Jimp({
        width: 3,
        height: 3,
        data: Buffer.from(buffer, 0, pixels.length * 4),
      });
      const b = new Jimp({
        width: 3,
        height: 3,
        data: Buffer.from(buffer, 0, pixels.length * 4),
      });
      a.bitmap.data.set(pixels.flat());

      a.composite(b, -1, 0, { mode });

      const reference = makeImage(3, 3, pixels);
      reference.composite(makeImage(3, 3, pixels), -1, 0, { mode });

      expect(pixelsOf(a)).toEqual(pixelsOf(reference));
    });
  }

  test("aliased source is snapshotted before opacityDest is applied", () => {
    const aliased = makeImage(3, 3, pixels);
    aliased.composite(aliased, 1, 1, {
      mode: BlendMode.MULTIPLY,
      opacityDest: 0.5,
    });

    // Non-aliased equivalent: the source keeps its original alpha while the
    // destination's alpha is scaled.
    const reference = makeImage(3, 3, pixels);
    reference.composite(makeImage(3, 3, pixels), 1, 1, {
      mode: BlendMode.MULTIPLY,
      opacityDest: 0.5,
    });

    expect(pixelsOf(aliased)).toEqual(pixelsOf(reference));
  });
});

describe("input validation", () => {
  const dstPixels: RGBA[] = [
    [10, 20, 30, 255],
    [40, 50, 60, 255],
    [70, 80, 90, 128],
    [100, 110, 120, 0],
  ];
  const srcPixels: RGBA[] = [
    [1, 2, 3, 255],
    [4, 5, 6, 255],
    [7, 8, 9, 255],
    [10, 11, 12, 255],
  ];

  function expectUnchanged(base: ReturnType<typeof makeImage>) {
    expect(pixelsOf(base)).toEqual(dstPixels.flat());
  }

  test("unsupported mode throws before writing anything", () => {
    const base = makeImage(2, 2, dstPixels);
    const over = makeImage(2, 2, srcPixels);

    expect(() =>
      base.composite(over, 0, 0, {
        // intentionally invalid mode
        mode: "multiplly" as BlendMode,
      }),
    ).toThrow(/Unsupported composite mode/);

    expectUnchanged(base);
  });

  test("unsupported mode throws before opacityDest is applied", () => {
    const base = makeImage(2, 2, dstPixels);
    const over = makeImage(2, 2, srcPixels);

    expect(() =>
      base.composite(over, 0, 0, {
        mode: "SCREEN" as BlendMode,
        opacityDest: 0.5,
      }),
    ).toThrow(/Unsupported composite mode/);

    expectUnchanged(base);
  });

  test.each([NaN, Infinity, -Infinity, "1"])(
    "invalid coordinate %s throws before writing anything",
    (bad) => {
      const base = makeImage(2, 2, dstPixels);
      const over = makeImage(2, 2, srcPixels);

      expect(() =>
        base.composite(over, bad as number, 0, { opacityDest: 0.5 }),
      ).toThrow(/x and y must be finite numbers/);
      expect(() =>
        base.composite(over, 0, bad as number, { opacityDest: 0.5 }),
      ).toThrow(/x and y must be finite numbers/);

      expectUnchanged(base);
    },
  );

  test("corrupt source bitmap throws before writing anything", () => {
    const base = makeImage(2, 2, dstPixels);
    const over = makeImage(2, 2, srcPixels);
    over.bitmap.data = Buffer.alloc(5); // too short for 2x2 RGBA

    expect(() => base.composite(over, 0, 0, { opacityDest: 0.5 })).toThrow(
      /corrupt bitmap/,
    );

    expectUnchanged(base);
  });

  test("corrupt base bitmap throws", () => {
    const base = makeImage(2, 2, dstPixels);
    base.bitmap.data = Buffer.alloc(0);

    expect(() => base.composite(makeImage(2, 2, srcPixels), 0, 0)).toThrow(
      /corrupt bitmap/,
    );
  });

  test("non-Jimp source throws", () => {
    const base = makeImage(2, 2, dstPixels);

    expect(() => base.composite({ bitmap: {} } as never, 0, 0)).toThrow(
      /source must be a Jimp image/,
    );

    expectUnchanged(base);
  });
});

describe("immutability and defaults", () => {
  const dstPixels: RGBA[] = [
    [10, 220, 130, 255],
    [180, 40, 90, 64],
    [200, 100, 50, 0],
    [5, 60, 100, 96],
  ];
  const srcPixels: RGBA[] = [
    [200, 30, 90, 255],
    [128, 64, 200, 128],
    [10, 20, 30, 0],
    [33, 77, 111, 200],
  ];

  test("the source image is never modified", () => {
    for (const mode of allModes) {
      const base = makeImage(2, 2, dstPixels);
      const over = makeImage(2, 2, srcPixels);

      base.composite(over, 0, 0, {
        mode,
        opacitySource: 0.7,
        opacityDest: 0.5,
      });

      expect(pixelsOf(over), mode).toEqual(srcPixels.flat());
    }
  });

  test("composite returns the base image instance", () => {
    const base = makeImage(2, 2, dstPixels);
    const result = base.composite(makeImage(2, 2, srcPixels), 0, 0);

    expect(result).toBe(base);
  });

  test("default options behave like explicit source-over", () => {
    const withDefault = makeImage(2, 2, dstPixels);
    withDefault.composite(makeImage(2, 2, srcPixels), 0, 0);

    const explicit = makeImage(2, 2, dstPixels);
    explicit.composite(makeImage(2, 2, srcPixels), 0, 0, {
      mode: BlendMode.SRC_OVER,
    });

    const reference = makeImage(2, 2, dstPixels);
    for (let i = 0; i < 4; i++) {
      reference.bitmap.data.set(
        referenceComposite(BlendMode.SRC_OVER, srcPixels[i]!, dstPixels[i]!),
        i * 4,
      );
    }

    expect(pixelsOf(withDefault)).toEqual(pixelsOf(explicit));
    expect(pixelsOf(withDefault)).toEqual(pixelsOf(reference));
  });

  test("free function and method agree", () => {
    const viaMethod = makeImage(2, 2, dstPixels);
    viaMethod.composite(makeImage(2, 2, srcPixels), 1, 0, {
      mode: BlendMode.SCREEN,
    });

    const viaFunction = makeImage(2, 2, dstPixels);
    composite(viaFunction, makeImage(2, 2, srcPixels), 1, 0, {
      mode: BlendMode.SCREEN,
    });

    expect(pixelsOf(viaMethod)).toEqual(pixelsOf(viaFunction));
  });

  test("opacitySource scales the source alpha before blending", () => {
    const src: RGBA = [200, 30, 90, 200];
    const dst: RGBA = [10, 220, 130, 255];

    for (const mode of featureModes) {
      const base = makeImage(1, 1, [dst]);
      base.composite(makeImage(1, 1, [src]), 0, 0, {
        mode,
        opacitySource: 0.5,
      });

      expect(pixelsOf(base), mode).toEqual(
        referenceComposite(mode, src, dst, 0.5),
      );
    }
  });

  test("opacityDest scales the destination alpha before blending", () => {
    const src: RGBA = [200, 30, 90, 255];
    const dst: RGBA = [10, 220, 130, 200];

    const base = makeImage(1, 1, [dst]);
    base.composite(makeImage(1, 1, [src]), 0, 0, {
      mode: BlendMode.MULTIPLY,
      opacityDest: 0.5,
    });

    // opacityDest pre-scales the destination alpha byte in place
    // (200 * 0.5 = 100), then blending runs against the faded destination.
    const fadedDst: RGBA = [dst[0], dst[1], dst[2], 100];

    expect(pixelsOf(base)).toEqual(
      referenceComposite(BlendMode.MULTIPLY, src, fadedDst),
    );
  });
});
