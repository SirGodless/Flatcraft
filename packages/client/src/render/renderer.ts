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
import { FogOfWar } from "./fog.js";
import { itemTexture } from "./icons.js";
import { createBlockTextures, TILE_PX } from "./textures.js";
import {
  ContainerPanelUI,
  CraftingPanelUI,
  cursorWidget,
  EnchantPanelUI,
  FurnacePanelUI,
  HeartsUI,
  HotbarUI,
  HungerUI,
  TradePanelUI,
} from "./ui.js";
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
  dim: string;
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
  private hungerBar!: HungerUI;
  private hud!: Text;
  private hotbar!: HotbarUI;
  private craftingPanel!: CraftingPanelUI;
  private furnacePanel!: FurnacePanelUI;
  private chestPanel!: ContainerPanelUI;
  private backpackPanel!: ContainerPanelUI;
  private tradePanel!: TradePanelUI;
  private enchantPanel!: EnchantPanelUI;
  private effectsHud!: Text;
  private effects: Record<string, number> = {};
  /** Wired by the bootstrap code to send trade commands. */
  onTrade: ((villager: number, trade: number) => void) | null = null;
  /** Wired by the bootstrap code to send enchant commands. */
  onEnchant: (() => void) | null = null;
  private openChestPos: { x: number; y: number } | null = null;
  /** Wired by the bootstrap code to send open_chest commands. */
  onOpenChest: ((x: number, y: number) => void) | null = null;
  private blockTextures!: Map<BlockId, Texture>;
  private cursorLayer = new Container();
  private cursorStack: ItemStack | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private inventory: InventorySlots = [];
  private selectedSlot = 0;
  private darkness!: Graphics;
  private timeOfDay = 0;
  /** The dimension the local player is in; everything else is hidden. */
  private localDim = "overworld";
  private readonly playerDims = new Map<PlayerId, string>();
  /** Called when the local player switches dimension (world reset). */
  onDimensionChanged: (() => void) | null = null;
  /** Fog of war (disable via ?nofog for debugging/screenshots). */
  fogEnabled = true;
  private fog!: FogOfWar;
  private fogUpdatedAt = 0;

  /** Exploration memory, for persisting alongside the world save. */
  exportFogMemory(): Map<string, Uint8Array> {
    return this.fog.memory;
  }

  importFogMemory(data: Map<string, Uint8Array>): void {
    this.fog.setMemory(data);
  }

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: container, background: "#87b9e7" });
    container.appendChild(this.app.canvas);

    const blockTextures = createBlockTextures();
    this.blockTextures = blockTextures;
    this.worldView = new WorldView(this.app.renderer, blockTextures);
    this.worldContainer.addChild(this.worldView.container);
    this.app.stage.addChild(this.worldContainer);
    this.fog = new FogOfWar(blockTextures);

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

    this.hungerBar = new HungerUI();
    this.hungerBar.update(20, 20);
    this.app.stage.addChild(this.hungerBar.container);

    this.craftingPanel = new CraftingPanelUI(blockTextures);
    this.craftingPanel.onQuickCraft = (id) => this.onCraft?.(id);
    this.craftingPanel.onSlotClick = (slot, button) => this.onSlotClick?.(slot, button);
    this.app.stage.addChild(this.craftingPanel.container);

    this.furnacePanel = new FurnacePanelUI(blockTextures);
    this.furnacePanel.onSlotClick = (slot, button) => this.onSlotClick?.(slot, button);
    this.app.stage.addChild(this.furnacePanel.container);

    this.chestPanel = new ContainerPanelUI(blockTextures, "Chest", 9, 27);
    this.chestPanel.onSlotClick = (slot, button) => this.onSlotClick?.(slot, button);
    this.app.stage.addChild(this.chestPanel.container);

    this.backpackPanel = new ContainerPanelUI(blockTextures, "Backpack", 9, 9);
    this.backpackPanel.onSlotClick = (slot, button) => this.onSlotClick?.(slot, button);
    this.app.stage.addChild(this.backpackPanel.container);

    this.tradePanel = new TradePanelUI(blockTextures);
    this.tradePanel.onTrade = (villager, trade) => this.onTrade?.(villager, trade);
    this.app.stage.addChild(this.tradePanel.container);

    this.enchantPanel = new EnchantPanelUI(blockTextures);
    this.enchantPanel.onEnchant = () => this.onEnchant?.();
    this.app.stage.addChild(this.enchantPanel.container);

    this.effectsHud = new Text({
      text: "",
      style: { fill: "#b8e0ff", fontSize: 12, fontFamily: "monospace" },
    });
    this.app.stage.addChild(this.effectsHud);

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
    const wasOpen = this.uiOpen;
    this.craftingPanel.close();
    this.furnacePanel.close();
    this.chestPanel.close();
    this.backpackPanel.close();
    this.tradePanel.close();
    this.enchantPanel.close();
    this.openChestPos = null;
    if (wasOpen) this.onUiClosed?.();
  }

  get uiOpen(): boolean {
    return (
      this.craftingPanel.visible ||
      this.furnacePanel.visible ||
      this.chestPanel.visible ||
      this.backpackPanel.visible ||
      this.tradePanel.visible ||
      this.enchantPanel.visible
    );
  }

  /** The item id in the selected hotbar slot, if any. */
  selectedItem(): string | null {
    return this.inventory[this.selectedSlot]?.item ?? null;
  }

  /** The local player's last known feet-center position, in tile coords. */
  localPlayerPos(): { x: number; y: number } | null {
    if (this.localPlayerId === null) return null;
    const marker = this.players.get(this.localPlayerId);
    return marker ? { x: marker.x, y: marker.y } : null;
  }

  /** Open the backpack screen for the selected hotbar slot. */
  openBackpack(): void {
    this.craftingPanel.close();
    this.furnacePanel.close();
    this.chestPanel.close();
    this.backpackPanel.open((index) => ({ container: "backpack", index }));
    this.refreshBackpack();
  }

  private refreshBackpack(): void {
    if (!this.backpackPanel.visible) return;
    const held = this.inventory[this.selectedSlot];
    if (!held || held.item !== "backpack") {
      this.backpackPanel.close();
      return;
    }
    this.backpackPanel.update(held.data?.slots ?? new Array(9).fill(null));
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
      this.chestPanel.close();
      this.furnacePanel.open(tileX, tileY);
      this.onOpenFurnace?.(tileX, tileY);
      return true;
    }
    if (block === BlockId.EnchantingTable) {
      this.craftingPanel.close();
      this.furnacePanel.close();
      this.chestPanel.close();
      this.enchantPanel.open();
      this.enchantPanel.update(this.inventory, this.selectedSlot);
      return true;
    }
    if (block === BlockId.Chest) {
      this.craftingPanel.close();
      this.furnacePanel.close();
      this.openChestPos = { x: tileX, y: tileY };
      this.chestPanel.open((index) => ({ container: "chest", x: tileX, y: tileY, index }));
      this.onOpenChest?.(tileX, tileY);
      return true;
    }
    return false;
  }

  /** Whether a screen point lands on an open UI surface (blocks world input). */
  isOverUI(x: number, y: number): boolean {
    const panels = [
      this.craftingPanel.container,
      this.furnacePanel.container,
      this.chestPanel.container,
      this.backpackPanel.container,
      this.tradePanel.container,
      this.enchantPanel.container,
      this.hotbar.container,
    ];
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
        this.playerDims.set(event.player, event.dim);
        const gfx = new Graphics()
          .rect(0, 0, PLAYER_WIDTH * TILE_PX, PLAYER_HEIGHT * TILE_PX)
          .fill({ color: event.player === this.localPlayerId ? 0xe04848 : 0x4868e0 });
        gfx.visible = event.dim === this.localDim;
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
      case "player_effects": {
        if (event.player === this.localPlayerId) {
          this.effects = event.effects;
        }
        break;
      }
      case "player_hunger": {
        if (event.player === this.localPlayerId) {
          this.hungerBar.update(event.hunger, event.max);
        }
        break;
      }
      case "player_dimension": {
        this.playerDims.set(event.player, event.dim);
        const marker = this.players.get(event.player);
        if (marker) {
          marker.prevX = event.x;
          marker.prevY = event.y;
          marker.x = event.x;
          marker.y = event.y;
          marker.updatedAt = performance.now();
        }
        if (event.player === this.localPlayerId) {
          // Reset the world view for the new dimension.
          this.localDim = event.dim;
          this.worldView.clear();
          this.closeUI();
          this.camera.centerOnTile(event.x, event.y);
          for (const [id, view] of this.entities) {
            view.gfx.visible = view.dim === this.localDim;
            void id;
          }
          this.onDimensionChanged?.();
        }
        for (const [pid, m] of this.players) {
          m.gfx.visible = this.playerDims.get(pid) === this.localDim;
        }
        break;
      }
      case "entity_spawned": {
        if (this.entities.has(event.id)) break;
        const gfx = this.buildEntityGfx(event.kind, event.stack);
        gfx.visible = event.dim === this.localDim;
        this.worldContainer.addChild(gfx);
        this.entities.set(event.id, {
          gfx,
          kind: event.kind,
          dim: event.dim,
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
        if (event.dim === this.localDim) {
          this.worldView.setChunk(event.cx, event.cy, event.tiles, event.walls);
        }
        break;
      case "inventory_changed":
        if (event.player === this.localPlayerId) {
          this.inventory = event.slots;
          this.selectedSlot = event.selected;
          this.cursorStack = event.cursor;
          this.hotbar.update(this.inventory, this.selectedSlot);
          this.craftingPanel.update(this.inventory, this.selectedSlot, event.craftGrid);
          this.refreshBackpack();
          this.tradePanel.update(this.inventory);
          this.enchantPanel.update(this.inventory, this.selectedSlot);
          this.cursorLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
          if (this.cursorStack) {
            this.cursorLayer.addChild(cursorWidget(this.cursorStack, this.blockTextures));
          }
        }
        break;
      case "furnace_changed":
        this.furnacePanel.update(event);
        break;
      case "chest_changed":
        if (
          event.dim === this.localDim &&
          this.openChestPos &&
          this.openChestPos.x === event.x &&
          this.openChestPos.y === event.y
        ) {
          this.chestPanel.update(event.slots);
        }
        break;
      case "time_changed":
        this.timeOfDay = event.time;
        break;
      case "block_changed": {
        if (event.dim !== this.localDim) break;
        this.worldView.setBlock(event.x, event.y, event.block);
        // The furnace/chest we were using got broken: close its screen.
        const furnacePos = this.furnacePanel.position;
        if (
          furnacePos &&
          furnacePos.x === event.x &&
          furnacePos.y === event.y &&
          event.block === BlockId.Air
        ) {
          this.closeUI();
        }
        if (
          this.openChestPos &&
          this.openChestPos.x === event.x &&
          this.openChestPos.y === event.y &&
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
    const humanoid = (body: number, head: number): void => {
      gfx.rect(0, 0, 0.6 * TILE_PX, 1.8 * TILE_PX).fill({ color: body });
      gfx.rect(0, 0, 0.6 * TILE_PX, 0.45 * TILE_PX).fill({ color: head });
    };
    const animal = (w: number, h: number, body: number, snout: number): void => {
      gfx.rect(0, 0, w * TILE_PX, h * TILE_PX).fill({ color: body });
      gfx.rect((w - 0.25) * TILE_PX, 0.25 * TILE_PX, 0.25 * TILE_PX, 0.2 * TILE_PX).fill({ color: snout });
    };
    switch (kind) {
      case "zombie":
        humanoid(0x4e9e4e, 0x3c7a3c);
        break;
      case "skeleton":
        humanoid(0xd8d8d0, 0xb8b8b0);
        break;
      case "zombified_piglin":
        humanoid(0xd88a8a, 0x8a9e4e);
        break;
      case "creeper":
        gfx.rect(0, 0, 0.6 * TILE_PX, 1.5 * TILE_PX).fill({ color: 0x58c25a });
        gfx.rect(0.1 * TILE_PX, 0.15 * TILE_PX, 0.12 * TILE_PX, 0.15 * TILE_PX).fill({ color: 0x1a1a1a });
        gfx.rect(0.38 * TILE_PX, 0.15 * TILE_PX, 0.12 * TILE_PX, 0.15 * TILE_PX).fill({ color: 0x1a1a1a });
        gfx.rect(0.22 * TILE_PX, 0.3 * TILE_PX, 0.16 * TILE_PX, 0.25 * TILE_PX).fill({ color: 0x1a1a1a });
        break;
      case "pig":
        animal(0.9, 0.9, 0xefa4a8, 0xd98488);
        break;
      case "cow":
        animal(0.9, 1.2, 0x6b4a34, 0xe8e8e0);
        break;
      case "sheep":
        animal(0.9, 1.1, 0xe8e8e2, 0xd0b8a8);
        break;
      case "chicken":
        animal(0.5, 0.6, 0xf0f0e8, 0xe8a030);
        break;
      case "villager":
        gfx.rect(0, 0, 0.6 * TILE_PX, 1.9 * TILE_PX).fill({ color: 0x8a6a4a });
        gfx.rect(0, 0, 0.6 * TILE_PX, 0.5 * TILE_PX).fill({ color: 0xc8a078 });
        gfx.rect(0.22 * TILE_PX, 0.3 * TILE_PX, 0.16 * TILE_PX, 0.25 * TILE_PX).fill({ color: 0xb08858 });
        break;
      case "arrow":
        gfx.rect(0, 0, 0.3 * TILE_PX, 0.12 * TILE_PX).fill({ color: 0x9a9a9a });
        break;
      default:
        gfx.rect(0, 0, TILE_PX, TILE_PX).fill({ color: 0xff00ff });
    }
    return gfx;
  }

  /**
   * Mob under the given world position (in tile units), for attack clicks.
   */
  /** Open the trading screen for a villager entity. */
  openTrading(villagerId: EntityId): void {
    this.craftingPanel.close();
    this.furnacePanel.close();
    this.chestPanel.close();
    this.backpackPanel.close();
    this.tradePanel.open(villagerId);
    this.tradePanel.update(this.inventory);
  }

  /** The kind of the mob under the world point, if any. */
  mobKindAt(tileX: number, tileY: number): { id: EntityId; kind: string } | null {
    const id = this.mobAt(tileX, tileY);
    if (id === null) return null;
    return { id, kind: this.entities.get(id)!.kind };
  }

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
    // The nether has no sky - fixed gloomy red instead.
    this.timeOfDay += dtMs / TICK_MS;
    if (this.localDim === "nether") {
      this.app.renderer.background.color = 0x2a0f0f;
      this.darkness
        .clear()
        .rect(0, 0, this.screenWidth, this.screenHeight)
        .fill({ color: 0x160606, alpha: 0.25 });
    } else {
      const light = daylightFactor(this.timeOfDay);
      const lerp = (a: number, b: number): number => Math.round(a + (b - a) * light);
      this.app.renderer.background.color =
        (lerp(0x10, 0x87) << 16) | (lerp(0x12, 0xb9) << 8) | lerp(0x24, 0xe7);
      this.darkness
        .clear()
        .rect(0, 0, this.screenWidth, this.screenHeight)
        .fill({ color: 0x060612, alpha: (1 - light) * 0.45 });
    }
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

    // Fog of war: recompute at a low rate, keep it above all world content.
    if (this.fogEnabled && localX !== null && localY !== null) {
      this.fog.container.visible = true;
      this.worldContainer.addChild(this.fog.container); // re-add = move to top
      if (now - this.fogUpdatedAt > 120) {
        this.fogUpdatedAt = now;
        this.fog.update(localX, localY - 0.9, this.worldView, this.effects["miner"] !== undefined, this.localDim);
      }
    } else {
      this.fog.container.visible = false;
    }

    this.hotbar.container.position.set(
      (this.screenWidth - this.hotbar.width) / 2,
      this.screenHeight - this.hotbar.height - 8,
    );
    this.hearts.container.position.set(
      (this.screenWidth - this.hotbar.width) / 2,
      this.screenHeight - this.hotbar.height - 26,
    );
    this.hungerBar.container.position.set(
      (this.screenWidth + this.hotbar.width) / 2 - this.hungerBar.width,
      this.screenHeight - this.hotbar.height - 26,
    );
    this.craftingPanel.container.position.set(12, 40);
    this.furnacePanel.container.position.set(
      (this.screenWidth - 250) / 2,
      (this.screenHeight - 170) / 2,
    );
    this.chestPanel.container.position.set((this.screenWidth - this.chestPanel.width) / 2, 80);
    this.backpackPanel.container.position.set(
      (this.screenWidth - this.backpackPanel.width) / 2,
      120,
    );
    this.tradePanel.container.position.set((this.screenWidth - 340) / 2, 100);
    this.enchantPanel.container.position.set((this.screenWidth - 300) / 2, 120);

    // Effects HUD under the hearts, counting down locally.
    for (const key of Object.keys(this.effects)) {
      this.effects[key]! -= dtMs / TICK_MS;
      if (this.effects[key]! <= 0) delete this.effects[key];
    }
    this.effectsHud.text = Object.entries(this.effects)
      .map(([id, ticks]) => `${id} ${Math.ceil(ticks / 20)}s`)
      .join("  ");
    this.effectsHud.position.set(
      (this.screenWidth - this.hotbar.width) / 2,
      this.screenHeight - this.hotbar.height - 44,
    );
    this.cursorLayer.position.set(this.pointerX - 16, this.pointerY - 16);

    const px = localX !== null ? Math.floor(localX) : Math.floor(this.camera.x / TILE_PX);
    const py = localY !== null ? Math.floor(localY) : Math.floor(this.camera.y / TILE_PX);
    this.hud.text = `FlatCraft | ${this.localDim} ${px},${py} | zoom ${this.camera.zoom.toFixed(1)} | A/D walk, Space jump, hold LMB mine, RMB place, 1-9 slot, E craft`;
  }
}
