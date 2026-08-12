import type { ServerInfo } from "@flatcraft/server";
import type { OnlineSession } from "../net/wsConnection.js";

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
