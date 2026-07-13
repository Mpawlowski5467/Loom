import type { ReactNode } from "react";
import { THEME_META, type ThemeName } from "../theme/themes";

interface Props {
  theme: ThemeName;
}

/**
 * Static preview chip showing the cardinal colors of a theme. Used in the
 * theme picker. Reads from THEME_META rather than getComputedStyle so we can
 * render every theme simultaneously.
 */
export function ThemeSwatch({ theme }: Props): ReactNode {
  const meta = THEME_META[theme];
  const { swatch } = meta;
  return (
    <div className="theme-swatch" style={{ background: swatch.bgBase }}>
      <div
        className="theme-swatch-surface"
        style={{ background: swatch.bgSurface }}
      >
        <span
          className="theme-swatch-bar theme-swatch-ink"
          style={{ background: swatch.ink }}
        />
        <div className="theme-swatch-dots">
          <span style={{ background: swatch.agent }} />
          <span style={{ background: swatch.you }} />
          <span style={{ background: swatch.node }} />
        </div>
      </div>
    </div>
  );
}
