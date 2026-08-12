import type { Command } from "@flatcraft/sim";
import type { Camera } from "../render/camera.js";
import { TILE_PX } from "../render/textures.js";

export type CommandSink = (command: Command) => void;

export interface InputOptions {
  camera: Camera;
  sendCommand: CommandSink;
  screenSize(): { width: number; height: number };
  /** Toggle the inventory screen (E). */
  onToggleInventory(): void;
  /** Close any open UI (Escape). Returns true if something was open. */
  onEscape(): void;
  /** True when the given screen point is over UI - world input is skipped. */
  isOverUI(x: number, y: number): boolean;
  /** Right-click on a tile; true = handled (opened a block UI). */
  onRightClickTile(x: number, y: number): boolean;
  /** Right-click with no block UI hit, with world tile coords (fractional);
   * true = handled (e.g. backpack, potion, bow shot). */
  onUseItem(x: number, y: number): boolean;
  /** Right-click at world coords; true = handled (e.g. villager trade). */
  onRightClickMob(x: number, y: number): boolean;
  /** Left-click at world coords (tile units, fractional); true = attacked a mob. */
  onAttackAt(x: number, y: number): boolean;
  /** Wheel while UI is open; true = consumed (no hotbar scroll). */
  onUiWheel(deltaY: number): boolean;
  /** Wheel over the world: cycle the hotbar selection (+1 = next slot). */
  onHotbarScroll(direction: 1 | -1): void;
  /** C key: cycle the player's body color. */
  onCycleColor(): void;
  /** B key: toggle background-wall placement mode. */
  onToggleBackground(): void;
  /** Hidden keybind (F8): toggle creative mode. */
  onToggleCreative(): void;
  /** Raw pointer position for the cursor-stack overlay. */
  onPointerMove(x: number, y: number): void;
}

export interface InputHandle {
  dispose(): void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;

const LEFT_KEYS = ["KeyA", "ArrowLeft"];
const RIGHT_KEYS = ["KeyD", "ArrowRight"];
const JUMP_KEYS = ["Space", "KeyW", "ArrowUp"];
/** Creative flight: descend. */
const DOWN_KEYS = ["ShiftLeft", "ShiftRight", "KeyS", "ArrowDown"];
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...JUMP_KEYS, ...DOWN_KEYS]);

/**
 * Input layer. Translates raw browser events into either camera/UI changes
 * (pure view state, stays client-side) or Commands (anything that would
 * change the world - the simulation decides whether it happens).
 * Movement keys send a `move` command only when the intent changes;
 * the simulation keeps applying the last intent every tick.
 */
export function attachInput(target: HTMLElement, opts: InputOptions): InputHandle {
  const held = new Set<string>();
  let lastDx: -1 | 0 | 1 = 0;
  let lastJump = false;
  let lastDown = false;
  let miningTile: { x: number; y: number } | null = null;

  const currentDx = (): -1 | 0 | 1 => {
    const left = LEFT_KEYS.some((k) => held.has(k));
    const right = RIGHT_KEYS.some((k) => held.has(k));
    if (left === right) return 0;
    return right ? 1 : -1;
  };

  const syncMoveIntent = (): void => {
    const dx = currentDx();
    const jump = JUMP_KEYS.some((k) => held.has(k));
    const down = DOWN_KEYS.some((k) => held.has(k));
    if (dx !== lastDx || jump !== lastJump || down !== lastDown) {
      lastDx = dx;
      lastJump = jump;
      lastDown = down;
      opts.sendCommand({ type: "move", dx, jump, down });
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
      opts.onToggleInventory();
      return;
    }
    if (e.code === "KeyC") {
      opts.onCycleColor();
      return;
    }
    if (e.code === "KeyB") {
      opts.onToggleBackground();
      return;
    }
    if (e.code === "F8") {
      // Hidden keybind: creative mode.
      opts.onToggleCreative();
      return;
    }
    if (e.code === "Equal" || e.code === "NumpadAdd") {
      zoomBy(1.15);
      return;
    }
    if (e.code === "Minus" || e.code === "NumpadSubtract") {
      zoomBy(1 / 1.15);
      return;
    }
    if (e.code === "Escape") {
      opts.onEscape();
      return;
    }
    held.add(e.code);
    syncMoveIntent();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
    syncMoveIntent();
  };

  // Wheel cycles the hotbar (like Minecraft); zoom moved to +/- keys.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (opts.onUiWheel(e.deltaY)) return;
    if (e.deltaY === 0) return;
    opts.onHotbarScroll(e.deltaY > 0 ? 1 : -1);
  };

  const zoomBy = (factor: number): void => {
    opts.camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, opts.camera.zoom * factor));
  };

  const tileAt = (e: PointerEvent): { x: number; y: number } => {
    const { width, height } = opts.screenSize();
    return opts.camera.screenToTile(e.offsetX, e.offsetY, width, height);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (opts.isOverUI(e.offsetX, e.offsetY)) return; // Pixi handles UI clicks
    const tile = tileAt(e);
    if (e.button === 0) {
      const { width, height } = opts.screenSize();
      const world = opts.camera.screenToWorld(e.offsetX, e.offsetY, width, height);
      if (opts.onAttackAt(world.x / TILE_PX, world.y / TILE_PX)) return;
      miningTile = tile;
      opts.sendCommand({ type: "start_mining", x: tile.x, y: tile.y });
    } else if (e.button === 2) {
      const { width, height } = opts.screenSize();
      const world = opts.camera.screenToWorld(e.offsetX, e.offsetY, width, height);
      if (opts.onRightClickMob(world.x / TILE_PX, world.y / TILE_PX)) return;
      if (opts.onRightClickTile(tile.x, tile.y)) return;
      if (opts.onUseItem(world.x / TILE_PX, world.y / TILE_PX)) return;
      opts.sendCommand({ type: "place_block", x: tile.x, y: tile.y });
    }
  };

  // Keep mining whatever the cursor points at while the button is held.
  const onPointerMove = (e: PointerEvent): void => {
    opts.onPointerMove(e.offsetX, e.offsetY);
    if (!miningTile) return;
    const tile = tileAt(e);
    if (tile.x !== miningTile.x || tile.y !== miningTile.y) {
      miningTile = tile;
      opts.sendCommand({ type: "start_mining", x: tile.x, y: tile.y });
    }
  };

  const stopMining = (): void => {
    if (miningTile) {
      miningTile = null;
      opts.sendCommand({ type: "stop_mining" });
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) stopMining();
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  target.addEventListener("wheel", onWheel, { passive: false });
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointerleave", stopMining);
  target.addEventListener("contextmenu", onContextMenu);

  return {
    dispose(): void {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointerleave", stopMining);
      target.removeEventListener("contextmenu", onContextMenu);
    },
  };
}
