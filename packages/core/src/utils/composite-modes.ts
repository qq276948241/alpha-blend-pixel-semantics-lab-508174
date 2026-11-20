import { RGBAColor } from "@jimp/types";

/**
 * Blend modes for {@link composite}.
 *
 * Every mode follows the same two-step structure (W3C "Compositing and
 * Blending Level 1"):
 *
 * 1. **Blend** — the mode's blend function `B(cb, cs)` is applied to the
 *    *unmultiplied* (straight) source and destination colors.
 * 2. **Composite** — the blended color is composited with the Porter-Duff
 *    "source-over" operator:
 *
 *    ```
 *    αo = αs + αb·(1 − αs)
 *    co = (αs·(1−αb)·cs  +  αs·αb·B(cb, cs)  +  αb·(1−αs)·cb) / αo
 *    ```
 *
 *    (the implementations below work with premultiplied terms, which is the
 *    same formula multiplied through by the alphas)
 *
 * Because the blend happens before alpha compositing, the RGB channels of a
 * fully transparent pixel never leak into the result: a fully transparent
 * source contributes nothing, and a fully transparent destination's hidden
 * RGB is scaled by `αb = 0`.
 *
 * When the resulting alpha `αo` is `0` (both pixels fully transparent), the
 * result is defined as transparent black `{ r: 0, g: 0, b: 0, a: 0 }` — the
 * color formula has a zero denominator in that case, so this rule avoids
 * `NaN` and drops any "hidden" RGB stored in fully transparent pixels.
 *
 * Inputs are not mutated. `ops` (source opacity) scales the source alpha
 * before blending, exactly as if the source bitmap's alpha had been
 * multiplied by `ops` beforehand.
 */

/**
 * Compute the source-over output alpha and the premultiplied channel terms
 * shared by every blend mode. Returns `undefined` when the output alpha is
 * zero, in which case the result is transparent black.
 */
function premultipliedTerms(src: RGBAColor, dst: RGBAColor, ops: number) {
  const sa = src.a * ops;
  const da = dst.a;

  const a = da + sa - da * sa;

  if (a === 0) {
    return undefined;
  }

  return {
    /** output alpha */
    a,
    /** source alpha (after applying source opacity) */
    sa,
    /** destination alpha */
    da,
    /** premultiplied source channels */
    sra: src.r * sa,
    sga: src.g * sa,
    sba: src.b * sa,
    /** premultiplied destination channels */
    dra: dst.r * da,
    dga: dst.g * da,
    dba: dst.b * da,
  };
}

const TRANSPARENT_BLACK: RGBAColor = { r: 0, g: 0, b: 0, a: 0 };

export function srcOver(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, sra, sga, sba, dra, dga, dba } = t;

  const r = (sra + dra * (1 - sa)) / a;
  const g = (sga + dga * (1 - sa)) / a;
  const b = (sba + dba * (1 - sa)) / a;

  return { r, g, b, a };
}

export function dstOver(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, da, sra, sga, sba, dra, dga, dba } = t;

  const r = (dra + sra * (1 - da)) / a;
  const g = (dga + sga * (1 - da)) / a;
  const b = (dba + sba * (1 - da)) / a;

  return { r, g, b, a };
}

export function multiply(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r = (sra * dra + sra * (1 - da) + dra * (1 - sa)) / a;
  const g = (sga * dga + sga * (1 - da) + dga * (1 - sa)) / a;
  const b = (sba * dba + sba * (1 - da) + dba * (1 - sa)) / a;

  return { r, g, b, a };
}

export function add(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sra, sga, sba, dra, dga, dba } = t;

  const r = (sra + dra) / a;
  const g = (sga + dga) / a;
  const b = (sba + dba) / a;

  return { r, g, b, a };
}

export function screen(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r =
    (sra * da + dra * sa - sra * dra + sra * (1 - da) + dra * (1 - sa)) / a;
  const g =
    (sga * da + dga * sa - sga * dga + sga * (1 - da) + dga * (1 - sa)) / a;
  const b =
    (sba * da + dba * sa - sba * dba + sba * (1 - da) + dba * (1 - sa)) / a;

  return { r, g, b, a };
}

export function overlay(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r =
    (2 * dra <= da
      ? 2 * sra * dra + sra * (1 - da) + dra * (1 - sa)
      : sra * (1 + da) + dra * (1 + sa) - 2 * dra * sra - da * sa) / a;

  const g =
    (2 * dga <= da
      ? 2 * sga * dga + sga * (1 - da) + dga * (1 - sa)
      : sga * (1 + da) + dga * (1 + sa) - 2 * dga * sga - da * sa) / a;

  const b =
    (2 * dba <= da
      ? 2 * sba * dba + sba * (1 - da) + dba * (1 - sa)
      : sba * (1 + da) + dba * (1 + sa) - 2 * dba * sba - da * sa) / a;

  return { r, g, b, a };
}

export function darken(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r =
    (Math.min(sra * da, dra * sa) + sra * (1 - da) + dra * (1 - sa)) / a;
  const g =
    (Math.min(sga * da, dga * sa) + sga * (1 - da) + dga * (1 - sa)) / a;
  const b =
    (Math.min(sba * da, dba * sa) + sba * (1 - da) + dba * (1 - sa)) / a;

  return { r, g, b, a };
}

export function lighten(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r =
    (Math.max(sra * da, dra * sa) + sra * (1 - da) + dra * (1 - sa)) / a;
  const g =
    (Math.max(sga * da, dga * sa) + sga * (1 - da) + dga * (1 - sa)) / a;
  const b =
    (Math.max(sba * da, dba * sa) + sba * (1 - da) + dba * (1 - sa)) / a;

  return { r, g, b, a };
}

export function hardLight(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r =
    (2 * sra <= sa
      ? 2 * sra * dra + sra * (1 - da) + dra * (1 - sa)
      : sra * (1 + da) + dra * (1 + sa) - 2 * dra * sra - da * sa) / a;

  const g =
    (2 * sga <= sa
      ? 2 * sga * dga + sga * (1 - da) + dga * (1 - sa)
      : sga * (1 + da) + dga * (1 + sa) - 2 * dga * sga - da * sa) / a;

  const b =
    (2 * sba <= sa
      ? 2 * sba * dba + sba * (1 - da) + dba * (1 - sa)
      : sba * (1 + da) + dba * (1 + sa) - 2 * dba * sba - da * sa) / a;

  return { r, g, b, a };
}

export function difference(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r = (sra + dra - 2 * Math.min(sra * da, dra * sa)) / a;
  const g = (sga + dga - 2 * Math.min(sga * da, dga * sa)) / a;
  const b = (sba + dba - 2 * Math.min(sba * da, dba * sa)) / a;

  return { r, g, b, a };
}

export function exclusion(src: RGBAColor, dst: RGBAColor, ops = 1) {
  const t = premultipliedTerms(src, dst, ops);

  if (!t) {
    return { ...TRANSPARENT_BLACK };
  }

  const { a, sa, da, sra, sga, sba, dra, dga, dba } = t;

  const r =
    (sra * da + dra * sa - 2 * sra * dra + sra * (1 - da) + dra * (1 - sa)) / a;
  const g =
    (sga * da + dga * sa - 2 * sga * dga + sga * (1 - da) + dga * (1 - sa)) / a;
  const b =
    (sba * da + dba * sa - 2 * sba * dba + sba * (1 - da) + dba * (1 - sa)) / a;

  return { r, g, b, a };
}

export const names = [
  srcOver,
  dstOver,
  multiply,
  add,
  screen,
  overlay,
  darken,
  lighten,
  hardLight,
  difference,
  exclusion,
] as const;
export type CompositeMode = (typeof names)[number];
