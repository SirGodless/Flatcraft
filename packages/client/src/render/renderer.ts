import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  BlockId,
  daylightFactor,
  ENTITY_SIZES,
  PLAYER_HEIGHT,
  PLAYER_MAX_HEALTH,
  PLAYER_WIDTH,
  TICK_MS,
  type EntityId,
  type InventorySlots,
  type ItemStack,
  type PlayerId,
  type SimEvent,
  type SlotRef,
} from "@flatcraft/sim";
import { Camera } from "./camera.js";
import { itemTexture } from "./icons.js";
import { createBlockTextures, TILE_PX } from "./textures.js";
import { CraftingPanelUI, cursorWidget, FurnacePanelUI, HeartsUI, HotbarUI } from "./ui.js";
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

interface EntityView {
  gfx: Container;
  kind: string;
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  updatedAt: number;
  hurtAt: number;
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
  private readonly entities = new Map<EntityId, EntityView>();
  private readonly miningOverlays = new Map<PlayerId, Graphics>();
  private hearts!: HeartsUI;
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
  private darkness!: Graphics;
  private timeOfDay = 0;

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: container, background: "#87b9e7" });
    container.appendChild(this.app.canvas);

    const blockTextures = createBlockTextures();
    this.blockTextures = blockTextures;
    this.worldView = new WorldView(this.app.renderer, blockTextures);
    this.worldContainer.addChild(this.worldView.container);
    this.app.stage.addChild(this.worldContainer);

    // Night darkness: a full-screen veil above the world, below the UI.
    this.darkness = new Graphics();
    this.app.stage.addChild(this.darkness);

    this.hud = new Text({
      text: "",
      style: { fill: "#ffffff", fontSize: 14, fontFamily: "monospace" },
    });
    this.hud.position.set(8, 8);
    this.app.stage.addChild(this.hud);

    this.hotbar = new HotbarUI(blockTextures);
    this.hotbar.update(this.inventory, this.selectedSlot);
    this.app.stage.addChild(this.hotbar.container);

    this.hearts = new HeartsUI();
    this.hearts.update(PLAYER_MAX_HEALTH, PLAYER_MAX_HEALTH);
    this.app.stage.addChild(this.hearts.container);

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
        // Teleports (death respawn) snap instead of lerping across the map.
        const teleported = Math.abs(event.x - marker.x) + Math.abs(event.y - marker.y) > 5;
        marker.prevX = teleported ? event.x : marker.x;
        marker.prevY = teleported ? event.y : marker.y;
        marker.x = event.x;
        marker.y = event.y;
        marker.updatedAt = performance.now();
        break;
      }
      case "player_health": {
        if (event.player === this.localPlayerId) {
          this.hearts.update(event.health, event.max);
        }
        break;
      }
      case "entity_spawned": {
        if (this.entities.has(event.id)) break;
        const gfx = this.buildEntityGfx(event.kind, event.stack);
        this.worldContainer.addChild(gfx);
        this.entities.set(event.id, {
          gfx,
          kind: event.kind,
          prevX: event.x,
          prevY: event.y,
          x: event.x,
          y: event.y,
          updatedAt: performance.now(),
          hurtAt: 0,
        });
        break;
      }
      case "entity_moved": {
        const view = this.entities.get(event.id);
        if (!view) break;
        view.prevX = view.x;
        view.prevY = view.y;
        view.x = event.x;
        view.y = event.y;
        view.updatedAt = performance.now();
        break;
      }
      case "entity_hurt": {
        const view = this.entities.get(event.id);
        if (view) view.hurtAt = performance.now();
        break;
      }
      case "entity_removed": {
        const view = this.entities.get(event.id);
        if (view) {
          view.gfx.destroy({ children: true });
          this.entities.delete(event.id);
        }
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
      case "time_changed":
        this.timeOfDay = event.time;
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

  private buildEntityGfx(kind: string, stack?: ItemStack): Container {
    if (kind === "item" && stack) {
      const container = new Container();
      const texture = itemTexture(stack.item, this.blockTextures);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.width = TILE_PX * 0.5;
        sprite.height = TILE_PX * 0.5;
        container.addChild(sprite);
      }
      return container;
    }
    const gfx = new Graphics();
    if (kind === "zombie") {
      gfx.rect(0, 0, 0.6 * TILE_PX, 1.8 * TILE_PX).fill({ color: 0x4e9e4e });
      gfx.rect(0, 0, 0.6 * TILE_PX, 0.45 * TILE_PX).fill({ color: 0x3c7a3c });
    } else if (kind === "pig") {
      gfx.rect(0, 0, 0.9 * TILE_PX, 0.9 * TILE_PX).fill({ color: 0xefa4a8 });
      gfx.rect(0.65 * TILE_PX, 0.25 * TILE_PX, 0.25 * TILE_PX, 0.2 * TILE_PX).fill({ color: 0xd98488 });
    } else {
      gfx.rect(0, 0, TILE_PX, TILE_PX).fill({ color: 0xff00ff });
    }
    return gfx;
  }

  /**
   * Mob under the given world position (in tile units), for attack clicks.
   */
  mobAt(tileX: number, tileY: number): EntityId | null {
    for (const [id, view] of this.entities) {
      if (view.kind === "item") continue;
      const size = ENTITY_SIZES[view.kind as keyof typeof ENTITY_SIZES];
      if (
        tileX >= view.x - size.width / 2 &&
        tileX <= view.x + size.width / 2 &&
        tileY >= view.y - size.height &&
        tileY <= view.y
      ) {
        return id;
      }
    }
    return null;
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

    // Advance local time between server syncs (1 tick per 50 ms) and
    // shade the world: sky color blends toward night, plus a veil.
    this.timeOfDay += dtMs / TICK_MS;
    const light = daylightFactor(this.timeOfDay);
    const lerp = (a: number, b: number): number => Math.round(a + (b - a) * light);
    this.app.renderer.background.color =
      (lerp(0x10, 0x87) << 16) | (lerp(0x12, 0xb9) << 8) | lerp(0x24, 0xe7);
    this.darkness
      .clear()
      .rect(0, 0, this.screenWidth, this.screenHeight)
      .fill({ color: 0x060612, alpha: (1 - light) * 0.45 });
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

    for (const view of this.entities.values()) {
      const alpha = Math.min(1, (now - view.updatedAt) / TICK_MS);
      const x = view.prevX + (view.x - view.prevX) * alpha;
      const y = view.prevY + (view.y - view.prevY) * alpha;
      const size = ENTITY_SIZES[view.kind as keyof typeof ENTITY_SIZES] ?? { width: 1, height: 1 };
      // Items bob gently so they read as pickups.
      const bob = view.kind === "item" ? Math.sin(now / 300 + view.x) * 1.5 : 0;
      view.gfx.position.set((x - size.width / 2) * TILE_PX, (y - size.height) * TILE_PX + bob);
      view.gfx.tint = now - view.hurtAt < 150 ? 0xff6060 : 0xffffff;
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
    this.hearts.container.position.set(
      (this.screenWidth - this.hotbar.width) / 2,
      this.screenHeight - this.hotbar.height - 26,
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
