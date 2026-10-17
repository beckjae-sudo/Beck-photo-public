import {
  Geist,
  Inter,
  Archivo_Black,
  Space_Grotesk,
  Oswald,
  Bebas_Neue,
  Playfair_Display,
  DM_Serif_Display,
  Montserrat,
} from "next/font/google";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const archivoBlack = Archivo_Black({
  variable: "--font-archivo-black",
  subsets: ["latin"],
  weight: "400",
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"] });
const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
});
const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
});
const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif-display",
  subsets: ["latin"],
  weight: "400",
});
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

export interface FontOption {
  key: string;
  label: string;
  /** CSS variable holding the font family, e.g. "--font-geist". */
  variable: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { key: "geist", label: "Geist — original splash look", variable: "--font-geist" },
  { key: "inter", label: "Inter", variable: "--font-inter" },
  { key: "archivo-black", label: "Archivo Black", variable: "--font-archivo-black" },
  { key: "space-grotesk", label: "Space Grotesk", variable: "--font-space-grotesk" },
  { key: "oswald", label: "Oswald", variable: "--font-oswald" },
  { key: "bebas-neue", label: "Bebas Neue", variable: "--font-bebas-neue" },
  { key: "playfair-display", label: "Playfair Display", variable: "--font-playfair-display" },
  { key: "dm-serif-display", label: "DM Serif Display", variable: "--font-dm-serif-display" },
  { key: "montserrat", label: "Montserrat", variable: "--font-montserrat" },
];

export const DEFAULT_FONT_KEY = "geist";

/** All font CSS-variable classes, attached once in the root layout. */
export const ALL_FONT_VARIABLES = [
  geist.variable,
  inter.variable,
  archivoBlack.variable,
  spaceGrotesk.variable,
  oswald.variable,
  bebasNeue.variable,
  playfairDisplay.variable,
  dmSerifDisplay.variable,
  montserrat.variable,
].join(" ");

/** Resolve a stored font key to its CSS variable (falls back to Geist). */
export function fontVariableFor(key: unknown): string {
  const opt = FONT_OPTIONS.find((o) => o.key === key);
  return (opt ?? FONT_OPTIONS[0]).variable;
}

/** Validate a stored font key, falling back to "geist" on anything unknown. */
export function validFontKey(key: unknown): string {
  return typeof key === "string" && FONT_OPTIONS.some((o) => o.key === key)
    ? key
    : DEFAULT_FONT_KEY;
}
