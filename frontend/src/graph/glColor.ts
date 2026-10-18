/**
 * Sigma's WebGL programs blend premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`) but
 * pass colors through unmultiplied. A translucent dark ink looks right by
 * accident (its rgb is near zero); a translucent light ink on a dark theme
 * composites far too bright. Premultiply translucent colors on their way into
 * Sigma; graph attributes (and the SVG export) keep straight alpha.
 */
const RGBA =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i;

const cache = new Map<string, string>();

export function glColor(color: string): string {
  let out = cache.get(color);
  if (out !== undefined) return out;
  const m = RGBA.exec(color.trim());
  const alpha = m ? Number(m[4]) : 1;
  if (!m || !(alpha < 1)) out = color;
  else {
    const ch = (i: number) => Math.round(Number(m[i]) * alpha);
    out = `rgba(${ch(1)},${ch(2)},${ch(3)},${alpha})`;
  }
  if (cache.size > 512) cache.clear();
  cache.set(color, out);
  return out;
}
