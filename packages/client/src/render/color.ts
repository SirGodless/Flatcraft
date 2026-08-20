/** "#2a0f0f" -> 0x2a0f0f, for CSS hex colors coming from sim registry data. */
export function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}
