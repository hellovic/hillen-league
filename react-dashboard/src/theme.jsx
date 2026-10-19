import { createContext, useContext } from "react";

/* Chart palettes — the same two ramps the vanilla build swaps into CHART.colors
 * when the theme changes. */
export const PALETTES = {
  dark: ["#ff9b68", "#72d4e8", "#8ed7aa", "#ff9c9c", "#f2d273", "#c6a0e3"],
  light: ["#a53b0a", "#006a80", "#25733f", "#b12c32", "#886000", "#74409b"],
};

export const PaletteContext = createContext(PALETTES.dark);

export function usePalette() {
  return useContext(PaletteContext);
}
