import type { Command } from "@flatcraft/sim";
import type { Camera } from "../render/camera.js";

export type CommandSink = (command: Command) => void;

export interface InputOptions {
  camera: Camera;
  sendCommand: CommandSink;
  screenSize(): { width: number; height: number };
  onToggleCraftingPanel(): void;
}

export interface InputHandle {
  dispose(): void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

const LEFT_KEYS = ["KeyA", "ArrowLeft"];
const RIGHT_KEYS = ["KeyD", "ArrowRight"];
const JUMP_KEYS = ["Space", "KeyW", "ArrowUp"];
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...JUMP_KEYS]);

/**
 * Input layer. Translates raw browser events into either camera changes
 * (pure view state, stays client-side) or Commands (anything that would
 * change the world - the simulation decides whether it happens).
 * Movement keys send a `move` command only when the intent changes;
 * the simulation keeps applying the last intent every tick.
 */
export function attachInput(target: HTMLElement, opts: InputOptions): InputHandle {
  const held = new Set<string>();
  let lastDx: -1 | 0 | 1 = 0;
  let lastJump = false;

  const currentDx = (): -1 | 0 | 1 => {
    const left = LEFT_KEYS.some((k) => held.has(k));
    const right = RIGHT_KEYS.some((k) => held.has(k));
    if (left === right) return 0;
    return right ? 1 : -1;
  };

  const syncMoveIntent = (): void => {
    const dx = currentDx();
    const jump = JUMP_KEYS.some((k) => held.has(k));
    if (dx !== lastDx || jump !== lastJump) {
      lastDx = dx;
      lastJump = jump;
      opts.sendCommand({ type: "move", dx, jump });
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code.startsWith("Digit")) {
      const slot = Number(e.code.slice(5)) - 1;
      if (slot >= 0 && slot < 9) {
        opts.sendCommand({ type: "select_slot", index: slot });
        return;
      }
    }
    if (e.code === "KeyE") {
      opts.onToggleCraftingPanel();
      return;
    }
    held.add(e.code);
    syncMoveIntent();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
    syncMoveIntent();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    opts.camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, opts.camera.zoom * factor));
  };

  const onPointerDown = (e: PointerEvent): void => {
    const { width, height } = opts.screenSize();
    const tile = opts.camera.screenToTile(e.offsetX, e.offsetY, width, height);
    if (e.button === 0) {
      opts.sendCommand({ type: "break_block", x: tile.x, y: tile.y });
    } else if (e.button === 2) {
      opts.sendCommand({ type: "place_block", x: tile.x, y: tile.y });
    }
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("contextmenu", onContextMenu);

  return {
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
