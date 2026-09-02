/**
 * The six application themes from the original's `assets/themes/*.mr`,
 * mapped onto the web renderer.
 *
 * The palettes are transcribed verbatim. Component colors derive from them
 * the way the C++ objects do: rods and crank webs are background-foreground
 * mixes, the head casting is the theme's pink, intake runners and valves are
 * blue, exhausts yellow, combustion orange.
 */
import type { Theme } from './renderer';

export interface Palette {
  background: number;
  foreground: number;
  shadow: number;
  highlight1: number;
  highlight2: number;
  pink: number;
  red: number;
  orange: number;
  yellow: number;
  blue: number;
  green: number;
}

export interface NamedTheme {
  id: string;
  label: string;
  palette: Palette;
}

const monochrome = (background: number, color: number, shadow = background): Palette => ({
  background,
  foreground: color,
  shadow,
  highlight1: color,
  highlight2: color,
  pink: color,
  red: color,
  orange: color,
  yellow: color,
  blue: color,
  green: color,
});

export const THEMES: NamedTheme[] = [
  {
    id: 'default',
    label: 'Default',
    palette: {
      background: 0x0e1012,
      foreground: 0xffffff,
      shadow: 0x0e1012,
      highlight1: 0xef4545,
      highlight2: 0xffffff,
      pink: 0xf394be,
      red: 0xee4445,
      orange: 0xf4802a,
      yellow: 0xfdbd2e,
      blue: 0x77cee0,
      green: 0xbdd869,
    },
  },
  {
    id: 'amateur',
    label: 'Amateur',
    palette: {
      background: 0x000000,
      foreground: 0xffffff,
      shadow: 0x000000,
      highlight1: 0xff0000,
      highlight2: 0xffffff,
      pink: 0xff00ff,
      red: 0xff0000,
      orange: 0xff8000,
      yellow: 0xffff00,
      blue: 0x0000ff,
      green: 0x00ff00,
    },
  },
  {
    id: 'bubble-gum',
    label: 'Bubble Gum',
    palette: {
      background: 0xf394be,
      foreground: 0xffffff,
      shadow: 0xf394be,
      highlight1: 0xfdeaf2,
      highlight2: 0xffffff,
      pink: 0xfad4e5,
      red: 0xf5a9cb,
      orange: 0xffd086,
      yellow: 0xffd0c3,
      blue: 0xcfd2dc,
      green: 0xd7f7d2,
    },
  },
  { id: 'minimalistic', label: 'Minimalistic', palette: monochrome(0x000000, 0xffffff) },
  { id: 'night-vision', label: 'Night Vision', palette: monochrome(0x000000, 0x4dff68) },
  { id: 'paper', label: 'Paper', palette: monochrome(0xf8f2f0, 0x63aaff) },
];

// ---- Color helpers --------------------------------------------------------

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Linear mix of two packed colors, exactly what the C++ objects do. */
export function mixColor(a: number, b: number, t: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function rgba(color: number, alpha: number): string {
  const [r, g, b] = channels(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Theme construction ---------------------------------------------------

export function buildTheme(palette: Palette): Theme {
  const { background: bg, foreground: fg } = palette;

  return {
    background: hex(bg),
    shadow: hex(mixColor(palette.shadow, fg, 0.04)),
    foreground: hex(fg),
    // The C++ rod/crank greys are background-foreground mixes.
    metal: hex(mixColor(bg, fg, 0.55)),
    metalDark: hex(mixColor(bg, fg, 0.16)),
    metalLight: hex(mixColor(bg, fg, 0.88)),
    accent: hex(palette.orange),
    hot: hex(palette.red),
    cold: hex(palette.blue),
    outline: hex(palette.shadow),
    head: hex(mixColor(bg, palette.pink, 0.8)),
    intake: hex(palette.blue),
    exhaust: hex(palette.yellow),
    flame: palette.orange,
    fgDim: rgba(fg, 0.5),
  };
}

/** Push the palette into the page chrome via the CSS custom properties. */
export function applyCssTheme(palette: Palette): void {
  const root = document.documentElement.style;
  const { background: bg, foreground: fg } = palette;

  root.setProperty('--bg', hex(bg));
  root.setProperty('--panel', hex(mixColor(bg, fg, 0.035)));
  root.setProperty('--panel-2', hex(mixColor(bg, fg, 0.07)));
  root.setProperty('--line', hex(mixColor(bg, fg, 0.16)));
  root.setProperty('--fg', hex(fg));
  root.setProperty('--fg-dim', rgba(fg, 0.55));
  root.setProperty('--accent', hex(palette.orange));
  root.setProperty('--hot', hex(palette.red));
  root.setProperty('--ok', hex(palette.green));
  root.setProperty('--panel-overlay', rgba(mixColor(bg, fg, 0.03), 0.8));
  root.setProperty('--on-accent', hex(mixColor(palette.orange, bg, 0.85)));
}

export function getTheme(id: string): NamedTheme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
