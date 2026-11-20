import { z } from "zod";

export enum Edge {
  EXTEND = 1,
  WRAP = 2,
  CROP = 3,
}

/**
 * How to blend two images together when compositing.
 *
 * All modes share the same Porter-Duff "source-over" alpha compositing:
 * the blend function is applied to the unmultiplied (straight) source and
 * destination colors first, and the blended color is then composited with
 * source-over alpha (`αo = αs + αb·(1 - αs)`). When the resulting alpha is
 * `0` (both pixels fully transparent) the result is defined as transparent
 * black (`r = g = b = 0`), so no division by zero can occur.
 */
export enum BlendMode {
  /**
   * Composite the source image over the destination image.
   * This is the default value. It represents the most intuitive case, where shapes are painted on top of what is below, with transparent areas showing the destination layer.
   */
  SRC_OVER = "srcOver",
  /** Composite the source image under the destination image. */
  DST_OVER = "dstOver",
  /**
   * Multiply the color components of the source and destination images.
   * This can only result in the same or darker colors (multiplying by white, 1.0, results in no change; multiplying by black, 0.0, results in black).
   * When compositing two opaque images, this has similar effect to overlapping two transparencies on a projector.
   *
   * This mode is useful for coloring shadows.
   */
  MULTIPLY = "multiply",
  /**
   * The Add mode adds the color information of the base layers and the blending layer.
   * In digital terms, adding color increases the brightness.
   */
  ADD = "add",
  /**
   * Multiply the inverse of the components of the source and destination images, and inverse the result.
   * Inverting the components means that a fully saturated channel (opaque white) is treated as the value 0.0, and values normally treated as 0.0 (black, transparent) are treated as 1.0.
   * This is essentially the same as modulate blend mode, but with the values of the colors inverted before the multiplication and the result being inverted back before rendering.
   * This can only result in the same or lighter colors (multiplying by black, 1.0, results in no change; multiplying by white, 0.0, results in white). Similarly, in the alpha channel, it can only result in more opaque colors.
   * This has similar effect to two projectors displaying their images on the same screen simultaneously.
   */
  SCREEN = "screen",
  /**
   * Multiply the components of the source and destination images after adjusting them to favor the destination.
   * Specifically, if the destination value is smaller, this multiplies it with the source value, whereas is the source value is smaller, it multiplies the inverse of the source value with the inverse of the destination value, then inverts the result.
   * Inverting the components means that a fully saturated channel (opaque white) is treated as the value 0.0, and values normally treated as 0.0 (black, transparent) are treated as 1.0.
   *
   * The Overlay mode behaves like Screen mode in bright areas, and like Multiply mode in darker areas.
   * With this mode, the bright areas will look brighter and the dark areas will look darker.
   */
  OVERLAY = "overlay",
  /**
   * Composite the source and destination image by choosing the lowest value from each color channel.
   * The opacity of the output image is computed in the same way as for srcOver.
   */
  DARKEN = "darken",
  /**
   * Composite the source and destination image by choosing the highest value from each color channel.
   * The opacity of the output image is computed in the same way as for srcOver.
   */
  LIGHTEN = "lighten",
  /**
   * Multiply the components of the source and destination images after adjusting them to favor the source.
   * Specifically, if the source value is smaller, this multiplies it with the destination value, whereas is the destination value is smaller, it multiplies the inverse of the destination value with the inverse of the source value, then inverts the result.
   * Inverting the components means that a fully saturated channel (opaque white) is treated as the value 0.0, and values normally treated as 0.0 (black, transparent) are treated as 1.0.
   *
   * The effect of the Hard light mode depends on the density of the superimposed color. Using bright colors on the blending layer will create a brighter effect like the Screen modes, while dark colors will create darker colors like the Multiply mode.
   */
  HARD_LIGHT = "hardLight",
  /**
   * Subtract the smaller value from the bigger value for each channel.
   * Compositing black has no effect; compositing white inverts the colors of the other image.
   * The opacity of the output image is computed in the same way as for srcOver.
   * The effect is similar to exclusion but harsher.
   */
  DIFFERENCE = "difference",
  /**
   * Subtract double the product of the two images from the sum of the two images.
   * Compositing black has no effect; compositing white inverts the colors of the other image.
   * The opacity of the output image is computed in the same way as for srcOver.
   * The effect is similar to difference but softer.
   */
  EXCLUSION = "exclusion",
}

export interface Bitmap {
  data: Buffer;
  width: number;
  height: number;
}

export interface Format<
  Mime extends string = string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ExportOptions extends Record<string, any> | undefined = undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DecodeOptions extends Record<string, any> | undefined = undefined,
> {
  mime: Mime;
  hasAlpha?: boolean;
  encode: (image: Bitmap, options?: ExportOptions) => Promise<Buffer> | Buffer;
  decode: (data: Buffer, options?: DecodeOptions) => Promise<Bitmap> | Bitmap;
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const JimpClassSchema = z.object({
  bitmap: z.object({
    data: z.union([z.instanceof(Buffer), z.instanceof(Uint8Array)]),
    width: z.number(),
    height: z.number(),
  }),
});

export interface JimpClass {
  background: number;
  bitmap: Bitmap;

  getPixelIndex: (x: number, y: number, edgeHandling?: Edge) => number;
  getPixelColor: (x: number, y: number) => number;
  setPixelColor: (hex: number, x: number, y: number) => JimpClass;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scan(f: (x: number, y: number, idx: number) => any): JimpClass;
  scan(
    x: number,
    y: number,
    w: number,
    h: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cb: (x: number, y: number, idx: number) => any,
  ): JimpClass;
  scan(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x: number | ((x: number, y: number, idx: number) => any),
    y?: number,
    w?: number,
    h?: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f?: (x: number, y: number, idx: number) => any,
  ): JimpClass;
}
