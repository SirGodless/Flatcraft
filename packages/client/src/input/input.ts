import { BlockId, type Command } from "@flatcraft/sim";
import type { Camera } from "../render/camera.js";

export type CommandSink = (command: Command) => void;

export interface InputOptions {
  camera: Camera;
  sendCommand: CommandSink;
  screenSize(): { width: number; height: number };
}

export interface InputHandle {
  /** Advance camera panning by held keys. Called once per frame. */
  update(dtMs: number): void;
  dispose(): void;
}

const PAN_SPEED_SCREEN_PX_PER_S = 600;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

/**
 * Input layer. Translates raw browser events into either camera changes
 * (pure view state, stays client-side) or Commands (anything that would
 * change the world - the simulation decides whether it happens).
 * Camera panning is a stand-in until player physics drives the camera.
 */
export function attachInput(target: HTMLElement, opts: InputOptions): InputHandle {
  const held = new Set<string>();

  const onKeyDown = (e: KeyboardEvent): void => {
    held.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
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
      opts.sendCommand({ type: "place_block", x: tile.x, y: tile.y, block: BlockId.Stone });
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
    update(dtMs: number): void {
      const step = ((PAN_SPEED_SCREEN_PX_PER_S / opts.camera.zoom) * dtMs) / 1000;
      if (held.has("KeyA") || held.has("ArrowLeft")) opts.camera.x -= step;
      if (held.has("KeyD") || held.has("ArrowRight")) opts.camera.x += step;
      if (held.has("KeyW") || held.has("ArrowUp")) opts.camera.y -= step;
      if (held.has("KeyS") || held.has("ArrowDown")) opts.camera.y += step;
    },
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
