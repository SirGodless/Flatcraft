import { Application, Container, Graphics, Text, type Texture } from "pixi.js";
import {
  BlockId,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TICK_MS,
  type InventorySlots,
  type ItemStack,
  type PlayerId,
  type SimEvent,
  type SlotRef,
} from "@flatcraft/sim";
import { Camera } from "./camera.js";
import { createBlockTextures, TILE_PX } from "./textures.js";
import { CraftingPanelUI, cursorWidget, FurnacePanelUI, HotbarUI } from "./ui.js";
import { CHUNK_PX_H, CHUNK_PX_W, WorldView } from "./worldView.js";

export interface ChunkRange {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

interface PlayerMarker {
  gfx: Graphics;
  /** Feet-center tile coords of the last two known tick positions. */
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  /** When the latest position arrived, for inter-tick interpolation. */
  updatedAt: number;
}

/**
 * Rendering layer. Consumes SimEvents and draws; it never mutates game
 * state. Owns the camera (pure view state) and the client-side world mirror.
 * Player positions arrive at tick rate (20 Hz) and are interpolated to
 * frame rate.
 */
export class Renderer {
  readonly camera = new Camera();
  worldView!: WorldView;
  /** Which player the camera follows; set by the bootstrap code. */
  localPlayerId: PlayerId | null = null;
  /** Wired by the bootstrap code to send commands. */
  onCraft: ((recipeId: string) => void) | null = null;
  onSlotClick: ((slot: SlotRef, button: "left" | "right") => void) | null = null;
  onOpenFurnace: ((x: number, y: number) => void) | null = null;
  /** Called when a UI closes, so the grid/cursor can be returned. */
  onUiClosed: (() => void) | null = null;

  private readonly app = new Application();
  private readonly worldContainer = new Container();
  private readonly players = new Map<PlayerId, PlayerMarker>();
  private readonly miningOverlays = new Map<PlayerId, Graphics>();
  private hud!: Text;
  private hotbar!: HotbarUI;
  private craftingPanel!: CraftingPanelUI;
  private furnacePanel!: FurnacePanelUI;
  private blockTextures!: Map<BlockId, Texture>;
  private cursorLayer = new Container();
  private cursorStack: ItemStack | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private inventory: InventorySlots = [];
  private selectedSlot = 0;

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: container, background: "#87b9e7" });
    container.appendChild(this.app.canvas);

    const blockTextures = createBlockTextures();
    this.blockTextures = blockTextures;
    this.worldView = new WorldView(this.app.renderer, blockTextures);
    this.worldContainer.addChild(this.worldView.container);
    this.app.stage.addChild(this.worldContainer);

    this.hud = new Text({
      text: "",
      style: { fill: "#ffffff", fontSize: 14, fontFamily: "monospace" },
    });
    this.hud.position.set(8, 8);
    this.app.stage.addChild(this.hud);

    this.hotbar = new HotbarUI(blockTextures);
    this.hotbar.update(this.inventory, this.selectedSlot);
    this.app.stage.addChild(this.hotbar.container);

    this.craftingPanel = new CraftingPanelUI(blockTextures);
    this.craftingPanel.onQuickCraft = (id) => this.onCraft?.(id);
    this.craftingPanel.onSlotClick = (slot, button) => this.onSlotClick?.(slot, button);
    this.app.stage.addChild(this.craftingPanel.container);

    this.furnacePanel = new FurnacePanelUI(blockTextures);
    this.furnacePanel.onSlotClick = (slot, button) => this.onSlotClick?.(slot, button);
    this.app.stage.addChild(this.furnacePanel.container);

    this.app.stage.addChild(this.cursorLayer);
  }

  /** Toggle the inventory screen (2x2 crafting). */
  toggleInventory(): void {
    if (this.craftingPanel.visible || this.furnacePanel.visible) {
      this.closeUI();
    } else {
      this.craftingPanel.maxHeight = this.screenHeight - 60;
      this.craftingPanel.open(2);
    }
  }

  closeUI(): void {
    const wasOpen = this.craftingPanel.visible || this.furnacePanel.visible;
    this.craftingPanel.close();
    this.furnacePanel.close();
    if (wasOpen) this.onUiClosed?.();
  }

  get uiOpen(): boolean {
    return this.craftingPanel.visible || this.furnacePanel.visible;
  }

  /**
   * Right-click on a tile: open the matching block UI if there is one.
   * Returns true when handled (the caller then skips block placement).
   */
  tryOpenBlockUI(tileX: number, tileY: number): boolean {
    const block = this.worldView.getBlock(tileX, tileY);
    if (block === BlockId.CraftingTable) {
      this.craftingPanel.maxHeight = this.screenHeight - 60;
      this.furnacePanel.close();
      this.craftingPanel.open(3);
      return true;
    }
    if (block === BlockId.Furnace) {
      this.craftingPanel.close();
      this.furnacePanel.open(tileX, tileY);
      this.onOpenFurnace?.(tileX, tileY);
      return true;
    }
    return false;
  }

  /** Whether a screen point lands on an open UI surface (blocks world input). */
  isOverUI(x: number, y: number): boolean {
    const panels = [this.craftingPanel.container, this.furnacePanel.container, this.hotbar.container];
    for (const panel of panels) {
      if (!panel.visible) continue;
      const bounds = panel.getBounds();
      if (x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height) {
        return true;
      }
    }
    return false;
  }

  setPointer(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  /** Scroll an open crafting panel; returns true if consumed. */
  handleWheel(deltaY: number): boolean {
    if (this.craftingPanel.visible) {
      this.craftingPanel.scrollBy(deltaY);
      return true;
    }
    return false;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get screenWidth(): number {
    return this.app.screen.width;
  }

  get screenHeight(): number {
    return this.app.screen.height;
  }

  handleEvent(event: SimEvent): void {
    switch (event.type) {
      case "player_joined": {
        const gfx = new Graphics()
          .rect(0, 0, PLAYER_WIDTH * TILE_PX, PLAYER_HEIGHT * TILE_PX)
          .fill({ color: event.player === this.localPlayerId ? 0xe04848 : 0x4868e0 });
        this.worldContainer.addChild(gfx);
        this.players.set(event.player, {
          gfx,
          prevX: event.x,
          prevY: event.y,
          x: event.x,
          y: event.y,
          updatedAt: performance.now(),
        });
        if (event.player === this.localPlayerId) {
          this.camera.centerOnTile(event.x, event.y);
        }
        break;
      }
      case "player_moved": {
        const marker = this.players.get(event.player);
        if (!marker) break;
        marker.prevX = marker.x;
        marker.prevY = marker.y;
        marker.x = event.x;
        marker.y = event.y;
        marker.updatedAt = performance.now();
        break;
      }
      case "player_left": {
        const marker = this.players.get(event.player);
        if (marker) {
          marker.gfx.destroy();
          this.players.delete(event.player);
        }
        const overlay = this.miningOverlays.get(event.player);
        if (overlay) {
          overlay.destroy();
          this.miningOverlays.delete(event.player);
        }
        break;
      }
      case "chunk_data":
        this.worldView.setChunk(event.cx, event.cy, event.tiles);
        break;
      case "inventory_changed":
        if (event.player === this.localPlayerId) {
          this.inventory = event.slots;
          this.selectedSlot = event.selected;
          this.cursorStack = event.cursor;
          this.hotbar.update(this.inventory, this.selectedSlot);
          this.craftingPanel.update(this.inventory, this.selectedSlot, event.craftGrid);
          this.cursorLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
          if (this.cursorStack) {
            this.cursorLayer.addChild(cursorWidget(this.cursorStack, this.blockTextures));
          }
        }
        break;
      case "furnace_changed":
        this.furnacePanel.update(event);
        break;
      case "block_changed": {
        this.worldView.setBlock(event.x, event.y, event.block);
        // The furnace we were using got broken: close its screen.
        const furnacePos = this.furnacePanel.position;
        if (
          furnacePos &&
          furnacePos.x === event.x &&
          furnacePos.y === event.y &&
          event.block === BlockId.Air
        ) {
          this.closeUI();
        }
        break;
      }
      case "mining_progress": {
        let overlay = this.miningOverlays.get(event.player);
        if (event.total === 0) {
          if (overlay) {
            overlay.destroy();
            this.miningOverlays.delete(event.player);
          }
          break;
        }
        if (!overlay) {
          overlay = new Graphics();
          this.worldContainer.addChild(overlay);
          this.miningOverlays.set(event.player, overlay);
        }
        const ratio = event.progress / event.total;
        overlay.clear();
        overlay.rect(0, 0, TILE_PX, TILE_PX).fill({ color: 0x000000, alpha: 0.2 + 0.5 * ratio });
        // Cracks widen with progress.
        const cracks = Math.floor(ratio * 4) + 1;
        for (let i = 0; i < cracks; i++) {
          const offset = 3 + i * 3;
          overlay
            .moveTo(offset, 2)
            .lineTo(TILE_PX - 2, offset + 4)
            .stroke({ color: 0x222222, width: 1, alpha: 0.8 });
        }
        overlay.position.set(event.x * TILE_PX, event.y * TILE_PX);
        break;
      }
      case "command_rejected":
        // Surfacing rejections in the UI comes with the HUD work later.
        break;
    }
  }

  /** Chunks the camera can currently see, padded by one for prefetch. */
  visibleChunkRange(): ChunkRange {
    const halfW = this.screenWidth / 2 / this.camera.zoom;
    const halfH = this.screenHeight / 2 / this.camera.zoom;
    return {
      minCx: Math.floor((this.camera.x - halfW) / CHUNK_PX_W) - 1,
      maxCx: Math.floor((this.camera.x + halfW) / CHUNK_PX_W) + 1,
      minCy: Math.floor((this.camera.y - halfH) / CHUNK_PX_H) - 1,
      maxCy: Math.floor((this.camera.y + halfH) / CHUNK_PX_H) + 1,
    };
  }

  draw(dtMs: number): void {
    const now = performance.now();
    let localX: number | null = null;
    let localY: number | null = null;

    for (const [id, marker] of this.players) {
      const alpha = Math.min(1, (now - marker.updatedAt) / TICK_MS);
      const x = marker.prevX + (marker.x - marker.prevX) * alpha;
      const y = marker.prevY + (marker.y - marker.prevY) * alpha;
      marker.gfx.position.set((x - PLAYER_WIDTH / 2) * TILE_PX, (y - PLAYER_HEIGHT) * TILE_PX);
      if (id === this.localPlayerId) {
        localX = x;
        localY = y;
      }
    }

    if (localX !== null && localY !== null) {
      const targetX = localX * TILE_PX;
      const targetY = (localY - PLAYER_HEIGHT / 2) * TILE_PX;
      const smoothing = 1 - Math.exp(-dtMs / 120);
      this.camera.x += (targetX - this.camera.x) * smoothing;
      this.camera.y += (targetY - this.camera.y) * smoothing;
    }

    this.camera.apply(this.worldContainer, this.screenWidth, this.screenHeight);

    this.hotbar.container.position.set(
      (this.screenWidth - this.hotbar.width) / 2,
      this.screenHeight - this.hotbar.height - 8,
    );
    this.craftingPanel.container.position.set(12, 40);
    this.furnacePanel.container.position.set(
      (this.screenWidth - 250) / 2,
      (this.screenHeight - 170) / 2,
    );
    this.cursorLayer.position.set(this.pointerX - 16, this.pointerY - 16);

    const px = localX !== null ? Math.floor(localX) : Math.floor(this.camera.x / TILE_PX);
    const py = localY !== null ? Math.floor(localY) : Math.floor(this.camera.y / TILE_PX);
    this.hud.text = `FlatCraft | tile ${px},${py} | zoom ${this.camera.zoom.toFixed(1)} | A/D walk, Space jump, hold LMB mine, RMB place, 1-9 slot, E craft`;
  }
}
