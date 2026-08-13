import type { ServerInfo } from "@flatcraft/server";

/** Selectable player body colors (login screen + C key in-game). */
export const PLAYER_COLORS = [
  0xe04848, 0x4868e0, 0x48b048, 0xe0a030, 0x9048e0,
  0x30c8c8, 0xe060b0, 0x8a6234, 0xd8d8d8, 0x3a3a44,
] as const;

const COLOR_STORAGE_KEY = "flatcraft.color";

export function storedPlayerColor(): number {
  const value = Number(localStorage.getItem(COLOR_STORAGE_KEY));
  return Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : PLAYER_COLORS[0];
}

export function storePlayerColor(color: number): void {
  localStorage.setItem(COLOR_STORAGE_KEY, String(color));
}

/**
 * Plain-DOM "not logged in" screen for online mode (shown before the Pixi
 * renderer exists). Identity comes entirely from anfall-auth - this just
 * picks a player color and hands off to /auth/login, a full page
 * navigation (there is no in-page promise to resolve on that path).
 */

const STYLE = `
  position: fixed; inset: 0; display: flex; align-items: center;
  justify-content: center; background: #0e0e12; z-index: 10;
  font-family: monospace; color: #e8e8f0;
`;

const CARD_STYLE = `
  background: #1a1a22; border: 2px solid #555566; border-radius: 6px;
  padding: 28px 32px; width: 300px; display: flex; flex-direction: column;
  align-items: center; gap: 10px;
`;

const BUTTON_STYLE = `
  background: #2e4e2e; color: #ffffff; border: 1px solid #4e7e4e;
  border-radius: 4px; padding: 9px 10px; font-family: monospace;
  font-size: 14px; cursor: pointer; margin-top: 4px; text-decoration: none;
  text-align: center; width: 100%; box-sizing: border-box; display: block;
`;

export function notLoggedInOverlay(info: ServerInfo, errorMessage?: string): void {
  const overlay = document.createElement("div");
  overlay.style.cssText = STYLE;
  overlay.innerHTML = `
    <div style="${CARD_STYLE}">
      <div style="font-size: 22px; font-weight: bold;">FlatCraft</div>
      <div style="font-size: 12px; color: #9a9aac;"></div>
      <div style="font-size: 12px; color: #9a9aac; margin-top: 4px;">Player color</div>
      <div data-role="colors" style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;"></div>
      <a href="/auth/login" style="${BUTTON_STYLE}">Login with anfall-auth</a>
      <div data-role="error" style="font-size: 12px; color: #e07070; min-height: 15px;"></div>
    </div>
  `;
  const serverLine = overlay.querySelector<HTMLDivElement>("div div:nth-child(2)")!;
  serverLine.textContent = `Server: ${info.name} - ${info.players} online`;
  if (errorMessage) {
    // textContent, never innerHTML - errorMessage can come from a URL query param.
    overlay.querySelector<HTMLDivElement>('[data-role="error"]')!.textContent = errorMessage;
  }

  const colorRow = overlay.querySelector<HTMLDivElement>('[data-role="colors"]')!;
  let selectedColor = storedPlayerColor();
  const swatches: HTMLButtonElement[] = [];
  const refreshSwatches = (): void => {
    for (const swatch of swatches) {
      const color = Number(swatch.dataset["color"]);
      swatch.style.outline = color === selectedColor ? "2px solid #ffffff" : "1px solid #555566";
    }
  };
  for (const color of PLAYER_COLORS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.dataset["color"] = String(color);
    swatch.style.cssText = `width: 22px; height: 22px; border: 0; border-radius: 3px;
      cursor: pointer; background: #${color.toString(16).padStart(6, "0")};`;
    swatch.addEventListener("click", () => {
      selectedColor = color;
      storePlayerColor(color);
      refreshSwatches();
    });
    swatches.push(swatch);
    colorRow.appendChild(swatch);
  }
  refreshSwatches();

  document.body.appendChild(overlay);
}

/** Full-screen notice when the connection drops; reload to rejoin. */
export function disconnectOverlay(): void {
  const overlay = document.createElement("div");
  overlay.style.cssText = STYLE;
  overlay.innerHTML = `
    <div style="${CARD_STYLE} align-items: center;">
      <div style="font-size: 18px; font-weight: bold;">Connection lost</div>
      <button style="${BUTTON_STYLE}">Reconnect</button>
    </div>
  `;
  overlay.querySelector("button")!.addEventListener("click", () => location.reload());
  document.body.appendChild(overlay);
}
