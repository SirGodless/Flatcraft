import type { ServerInfo } from "@flatcraft/server";
import type { OnlineSession } from "../net/wsConnection.js";

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
 * Plain-DOM login screen for online mode (shown before the Pixi renderer
 * exists). Name + password; unknown names register automatically.
 */

const STYLE = `
  position: fixed; inset: 0; display: flex; align-items: center;
  justify-content: center; background: #0e0e12; z-index: 10;
  font-family: monospace; color: #e8e8f0;
`;

const CARD_STYLE = `
  background: #1a1a22; border: 2px solid #555566; border-radius: 6px;
  padding: 28px 32px; width: 300px; display: flex; flex-direction: column;
  gap: 10px;
`;

const INPUT_STYLE = `
  background: #0e0e14; color: #e8e8f0; border: 1px solid #555566;
  border-radius: 4px; padding: 8px 10px; font-family: monospace;
  font-size: 14px; outline: none;
`;

const BUTTON_STYLE = `
  background: #2e4e2e; color: #ffffff; border: 1px solid #4e7e4e;
  border-radius: 4px; padding: 9px 10px; font-family: monospace;
  font-size: 14px; cursor: pointer; margin-top: 4px;
`;

export function loginOverlay(
  info: ServerInfo,
  connect: (name: string, password: string) => Promise<OnlineSession>,
): Promise<OnlineSession> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = STYLE;
    overlay.innerHTML = `
      <form style="${CARD_STYLE}">
        <div style="font-size: 22px; font-weight: bold;">FlatCraft</div>
        <div style="font-size: 12px; color: #9a9aac; margin-bottom: 6px;"></div>
        <input name="name" style="${INPUT_STYLE}" placeholder="Name" maxlength="16"
               autocomplete="username" required pattern="[A-Za-z0-9_]{2,16}" />
        <input name="password" style="${INPUT_STYLE}" type="password" placeholder="Password"
               autocomplete="current-password" required minlength="4" />
        <div style="font-size: 12px; color: #9a9aac; margin-top: 4px;">Player color</div>
        <div data-role="colors" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
        <button style="${BUTTON_STYLE}" type="submit">Play</button>
        <div data-role="error" style="font-size: 12px; color: #e07070; min-height: 15px;"></div>
        <div style="font-size: 11px; color: #6a6a7c;">Unknown names are registered on first login.</div>
      </form>
    `;
    const serverLine = overlay.querySelector<HTMLDivElement>("div div:nth-child(2)")!;
    serverLine.textContent = `Server: ${info.name} - ${info.players} online`;
    const form = overlay.querySelector("form")!;
    const nameInput = overlay.querySelector<HTMLInputElement>('input[name="name"]')!;
    const passwordInput = overlay.querySelector<HTMLInputElement>('input[name="password"]')!;
    const button = overlay.querySelector("button")!;
    const error = overlay.querySelector<HTMLDivElement>('[data-role="error"]')!;

    // Color swatches; the picked one is remembered and sent with the join.
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

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      button.disabled = true;
      error.textContent = "";
      connect(nameInput.value.trim(), passwordInput.value)
        .then((session) => {
          overlay.remove();
          resolve(session);
        })
        .catch((reason: unknown) => {
          button.disabled = false;
          error.textContent = reason instanceof Error ? reason.message : String(reason);
        });
    });

    document.body.appendChild(overlay);
    nameInput.focus();
  });
}

/** Full-screen notice when the connection drops; reload to rejoin. */
export function disconnectOverlay(): void {
  const overlay = document.createElement("div");
  overlay.style.cssText = STYLE;
  overlay.innerHTML = `
    <div style="${CARD_STYLE} align-items: center;">
      <div style="font-size: 18px; font-weight: bold;">Connection lost</div>
      <button style="${BUTTON_STYLE} width: 100%;">Reconnect</button>
    </div>
  `;
  overlay.querySelector("button")!.addEventListener("click", () => location.reload());
  document.body.appendChild(overlay);
}
