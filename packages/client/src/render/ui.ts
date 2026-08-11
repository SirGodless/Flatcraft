import { Container, Graphics, Sprite, Text, type FederatedPointerEvent, type Texture } from "pixi.js";
import {
  BlockId,
  countInInventory,
  HOTBAR_SIZE,
  matchGrid,
  RECIPES,
  SMALL_GRID_INDICES,
  type InventorySlots,
  type ItemStack,
  type Recipe,
  type SlotRef,
} from "@flatcraft/sim";
import { itemTexture } from "./icons.js";

const SLOT = 40;
const PAD = 4;
const ICON = 32;

export type SlotClickHandler = (slot: SlotRef, button: "left" | "right") => void;

function buttonOf(e: FederatedPointerEvent): "left" | "right" | null {
  if (e.button === 0) return "left";
  if (e.button === 2) return "right";
  return null;
}

/** One clickable item slot: background, icon, count. */
function slotWidget(
  stack: ItemStack | null,
  blockTextures: Map<BlockId, Texture>,
  options: {
    highlighted?: boolean;
    onClick?: (button: "left" | "right") => void;
  } = {},
): Container {
  const cell = new Container();
  const bg = new Graphics()
    .rect(0, 0, SLOT, SLOT)
    .fill({ color: 0x000000, alpha: 0.45 })
    .stroke({
      color: options.highlighted ? 0xffffff : 0x888888,
      width: options.highlighted ? 3 : 1,
    });
  cell.addChild(bg);
  if (stack) {
    const texture = itemTexture(stack.item, blockTextures);
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.width = ICON;
      sprite.height = ICON;
      sprite.position.set((SLOT - ICON) / 2, (SLOT - ICON) / 2);
      cell.addChild(sprite);
    }
    if (stack.count > 1) {
      const label = new Text({
        text: String(stack.count),
        style: { fill: "#ffffff", fontSize: 12, fontFamily: "monospace", fontWeight: "bold" },
      });
      label.position.set(SLOT - PAD - label.width, SLOT - PAD - label.height);
      cell.addChild(label);
    }
  }
  if (options.onClick) {
    cell.eventMode = "static";
    cell.cursor = "pointer";
    cell.on("pointerdown", (e: FederatedPointerEvent) => {
      const button = buttonOf(e);
      if (button) options.onClick!(button);
    });
  }
  return cell;
}

/** A stack rendered on the mouse cursor. */
export function cursorWidget(stack: ItemStack, blockTextures: Map<BlockId, Texture>): Container {
  const cell = new Container();
  const texture = itemTexture(stack.item, blockTextures);
  if (texture) {
    const sprite = new Sprite(texture);
    sprite.width = ICON;
    sprite.height = ICON;
    cell.addChild(sprite);
  }
  if (stack.count > 1) {
    const label = new Text({
      text: String(stack.count),
      style: { fill: "#ffffff", fontSize: 12, fontFamily: "monospace", fontWeight: "bold" },
    });
    label.position.set(ICON - label.width, ICON - label.height);
    cell.addChild(label);
  }
  return cell;
}

/** Hearts row above the hotbar: 10 hearts for 20 HP, half-heart capable. */
export class HeartsUI {
  readonly container = new Container();

  update(health: number, max: number): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const hearts = Math.ceil(max / 2);
    const gfx = new Graphics();
    for (let i = 0; i < hearts; i++) {
      const x = i * 18;
      const hp = health - i * 2;
      gfx.rect(x, 0, 14, 12).fill({ color: 0x3a1010, alpha: 0.8 });
      if (hp >= 2) {
        gfx.rect(x + 1, 1, 12, 10).fill({ color: 0xd83030 });
      } else if (hp === 1) {
        gfx.rect(x + 1, 1, 6, 10).fill({ color: 0xd83030 });
      }
    }
    this.container.addChild(gfx);
  }

  get width(): number {
    return 10 * 18 - 4;
  }
}

/** The always-visible 9-slot hotbar, bottom center of the screen. */
export class HotbarUI {
  readonly container = new Container();

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {}

  update(slots: InventorySlots, selected: number): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = slotWidget(slots[i] ?? null, this.blockTextures, { highlighted: i === selected });
      cell.position.set(i * (SLOT + PAD), 0);
      this.container.addChild(cell);
    }
  }

  get width(): number {
    return HOTBAR_SIZE * (SLOT + PAD) - PAD;
  }

  get height(): number {
    return SLOT;
  }
}

/**
 * Inventory screen with a real crafting grid (2x2, or 3x3 at a crafting
 * table), result slot, the full inventory, and a recipe-book list that
 * quick-crafts on click. All slot clicks go through the server.
 */
export class CraftingPanelUI {
  readonly container = new Container();
  onSlotClick: SlotClickHandler | null = null;
  onQuickCraft: ((recipeId: string) => void) | null = null;

  /** 3 at a crafting table, 2 otherwise. */
  gridSize: 2 | 3 = 2;
  maxHeight = 620;

  private slots: InventorySlots = [];
  private selected = 0;
  private craftGrid: (ItemStack | null)[] = new Array(9).fill(null);
  private listOffset = 0;
  private listViewport = 200;
  private listContent = 0;

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
  }

  open(gridSize: 2 | 3): void {
    this.gridSize = gridSize;
    this.container.visible = true;
    this.listOffset = 0;
    this.rebuild();
  }

  close(): void {
    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  update(slots: InventorySlots, selected: number, craftGrid: (ItemStack | null)[]): void {
    this.slots = slots;
    this.selected = selected;
    this.craftGrid = craftGrid;
    if (this.container.visible) this.rebuild();
  }

  scrollBy(delta: number): void {
    const maxOffset = Math.max(0, this.listContent - this.listViewport);
    this.listOffset = Math.max(0, Math.min(maxOffset, this.listOffset + delta * 0.5));
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));

    const invCols = 9;
    const width = invCols * (SLOT + PAD) + 2 * PAD + 80;
    const click = (slot: SlotRef) => (button: "left" | "right") => this.onSlotClick?.(slot, button);

    let y = 8;

    // --- Crafting grid + result ---
    const title = new Text({
      text: this.gridSize === 3 ? "Crafting (3x3)" : "Crafting (2x2)",
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    title.position.set(PAD * 2, y);
    this.container.addChild(title);
    y += 20;

    const gridDim = this.gridSize;
    for (let row = 0; row < gridDim; row++) {
      for (let col = 0; col < gridDim; col++) {
        const index = row * 3 + col;
        const cell = slotWidget(this.craftGrid[index] ?? null, this.blockTextures, {
          onClick: click({ container: "craft_grid", index }),
        });
        cell.position.set(PAD * 2 + col * (SLOT + PAD), y + row * (SLOT + PAD));
        this.container.addChild(cell);
      }
    }

    // Arrow and result slot.
    const gridPx = gridDim * (SLOT + PAD) - PAD;
    const arrow = new Text({
      text: "->",
      style: { fill: "#cccccc", fontSize: 20, fontFamily: "monospace" },
    });
    arrow.position.set(PAD * 2 + gridPx + 14, y + gridPx / 2 - 12);
    this.container.addChild(arrow);

    const recipe = matchGrid(this.craftGrid, RECIPES.values(), this.gridSize);
    const resultStack = recipe ? { item: recipe.result.item, count: recipe.result.count } : null;
    const resultCell = slotWidget(resultStack, this.blockTextures, {
      highlighted: recipe !== null,
      onClick: click({ container: "craft_result" }),
    });
    resultCell.position.set(PAD * 2 + gridPx + 48, y + gridPx / 2 - SLOT / 2);
    this.container.addChild(resultCell);

    y += gridPx + 12;

    // --- Main inventory (9..35) + hotbar row (0..8) ---
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < invCols; col++) {
        const index = 9 + row * invCols + col;
        const cell = slotWidget(this.slots[index] ?? null, this.blockTextures, {
          onClick: click({ container: "inventory", index }),
        });
        cell.position.set(PAD * 2 + col * (SLOT + PAD), y + row * (SLOT + PAD));
        this.container.addChild(cell);
      }
    }
    y += 3 * (SLOT + PAD) + 6;
    for (let col = 0; col < invCols; col++) {
      const cell = slotWidget(this.slots[col] ?? null, this.blockTextures, {
        highlighted: col === this.selected,
        onClick: click({ container: "inventory", index: col }),
      });
      cell.position.set(PAD * 2 + col * (SLOT + PAD), y);
      this.container.addChild(cell);
    }
    y += SLOT + 12;

    // --- Recipe book (scrollable) ---
    const bookTitle = new Text({
      text: "Recipe book (click to craft, wheel to scroll)",
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    bookTitle.position.set(PAD * 2, y);
    this.container.addChild(bookTitle);
    y += 20;

    const rowH = 26;
    this.listViewport = Math.max(3 * rowH, this.maxHeight - y - 10);
    this.listContent = RECIPES.size * rowH;

    const list = new Container();
    let rowY = 0;
    for (const recipeEntry of RECIPES.values()) {
      const row = this.recipeRow(recipeEntry, width - PAD * 4, rowH);
      row.position.set(0, rowY - this.listOffset);
      if (rowY - this.listOffset > -rowH && rowY - this.listOffset < this.listViewport) {
        list.addChild(row);
      } else {
        row.destroy({ children: true });
      }
      rowY += rowH;
    }
    list.position.set(PAD * 2, y);
    const mask = new Graphics().rect(PAD * 2, y, width - PAD * 4, this.listViewport).fill(0xffffff);
    list.mask = mask;
    this.container.addChild(mask);
    this.container.addChild(list);
    y += this.listViewport + 8;

    // Background behind everything.
    const background = new Graphics()
      .rect(0, 0, width, y)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    this.container.addChildAt(background, 0);
    background.eventMode = "static"; // swallow clicks on the panel body
  }

  private recipeRow(recipe: Recipe, width: number, height: number): Container {
    const row = new Container();
    const smelting = recipe.kind === "smelting";
    const craftable =
      !smelting &&
      [...recipe.ingredients].every(([item, count]) => countInInventory(this.slots, item) >= count);

    const bg = new Graphics().rect(0, 0, width, height - 3).fill({
      color: craftable ? 0x2e4e2e : 0x2a2a33,
      alpha: 0.9,
    });
    row.addChild(bg);

    const resultTexture = itemTexture(recipe.result.item, this.blockTextures);
    if (resultTexture) {
      const icon = new Sprite(resultTexture);
      icon.width = 18;
      icon.height = 18;
      icon.position.set(3, (height - 3 - 18) / 2);
      row.addChild(icon);
    }

    const needs = [...recipe.ingredients].map(([item, count]) => `${count}x ${item}`).join(", ");
    const suffix = smelting ? " [furnace]" : recipe.gridSize === 3 ? " [table]" : "";
    const label = new Text({
      text: `${recipe.result.count}x ${recipe.result.item}  <-  ${needs}${suffix}`,
      style: {
        fill: craftable ? "#ffffff" : "#8a8a8a",
        fontSize: 12,
        fontFamily: "monospace",
      },
    });
    label.position.set(26, (height - 3 - label.height) / 2);
    row.addChild(label);

    if (craftable) {
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.onQuickCraft?.(recipe.id);
      });
    }
    return row;
  }
}

/**
 * Generic item-container screen (chest: 27 slots, backpack: 9). The
 * slot-ref factory decides where clicks are routed server-side.
 */
export class ContainerPanelUI {
  readonly container = new Container();
  onSlotClick: SlotClickHandler | null = null;

  private slots: (ItemStack | null)[] = [];
  private makeRef: ((index: number) => SlotRef) | null = null;

  constructor(
    private readonly blockTextures: Map<BlockId, Texture>,
    private readonly title: string,
    private readonly cols: number,
    private readonly count: number,
  ) {
    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  get width(): number {
    return this.cols * (SLOT + PAD) + 3 * PAD;
  }

  open(makeRef: (index: number) => SlotRef): void {
    this.makeRef = makeRef;
    this.slots = new Array<ItemStack | null>(this.count).fill(null);
    this.container.visible = true;
    this.rebuild();
  }

  close(): void {
    this.container.visible = false;
  }

  update(slots: (ItemStack | null)[]): void {
    this.slots = slots;
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const rows = Math.ceil(this.count / this.cols);
    const width = this.width;
    const height = rows * (SLOT + PAD) + 34;

    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    background.eventMode = "static";
    this.container.addChild(background);

    const label = new Text({
      text: this.title,
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    label.position.set(PAD * 2, 8);
    this.container.addChild(label);

    for (let i = 0; i < this.count; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const cell = slotWidget(this.slots[i] ?? null, this.blockTextures, {
        onClick: (button) => {
          if (this.makeRef) this.onSlotClick?.(this.makeRef(i), button);
        },
      });
      cell.position.set(PAD * 2 + col * (SLOT + PAD), 28 + row * (SLOT + PAD));
      this.container.addChild(cell);
    }
  }
}

export interface FurnaceView {
  x: number;
  y: number;
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  burnLeft: number;
  burnTotal: number;
  cookProgress: number;
  cookTotal: number;
}

/** Furnace screen: input above fuel, flame + arrow, output. */
export class FurnacePanelUI {
  readonly container = new Container();
  onSlotClick: SlotClickHandler | null = null;

  private view: FurnaceView | null = null;

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  get position(): { x: number; y: number } | null {
    return this.view ? { x: this.view.x, y: this.view.y } : null;
  }

  open(x: number, y: number): void {
    this.view = { x, y, input: null, fuel: null, output: null, burnLeft: 0, burnTotal: 0, cookProgress: 0, cookTotal: 200 };
    this.container.visible = true;
    this.rebuild();
  }

  close(): void {
    this.container.visible = false;
    this.view = null;
  }

  update(view: FurnaceView): void {
    if (!this.view || this.view.x !== view.x || this.view.y !== view.y) return;
    this.view = view;
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const view = this.view;
    if (!view) return;

    const width = 250;
    const height = 170;
    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    background.eventMode = "static";
    this.container.addChild(background);

    const title = new Text({
      text: "Furnace",
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    title.position.set(10, 8);
    this.container.addChild(title);

    const click =
      (slot: "input" | "fuel" | "output") =>
      (button: "left" | "right") =>
        this.onSlotClick?.({ container: "furnace", x: view.x, y: view.y, slot }, button);

    const inputCell = slotWidget(view.input, this.blockTextures, { onClick: click("input") });
    inputCell.position.set(30, 34);
    this.container.addChild(inputCell);

    // Flame indicator between input and fuel.
    const flameRatio = view.burnTotal > 0 ? view.burnLeft / view.burnTotal : 0;
    const flame = new Graphics();
    flame.rect(34, 82, 28, 8).fill({ color: 0x3a3a44 });
    if (flameRatio > 0) {
      flame.rect(34, 82, 28 * flameRatio, 8).fill({ color: 0xe68c28 });
    }
    this.container.addChild(flame);

    const fuelCell = slotWidget(view.fuel, this.blockTextures, { onClick: click("fuel") });
    fuelCell.position.set(30, 96);
    this.container.addChild(fuelCell);

    // Cook progress arrow.
    const cookRatio = view.cookTotal > 0 ? view.cookProgress / view.cookTotal : 0;
    const arrow = new Graphics();
    arrow.rect(90, 66, 60, 10).fill({ color: 0x3a3a44 });
    if (cookRatio > 0) {
      arrow.rect(90, 66, 60 * cookRatio, 10).fill({ color: 0xffffff });
    }
    this.container.addChild(arrow);

    const outputCell = slotWidget(view.output, this.blockTextures, { onClick: click("output") });
    outputCell.position.set(170, 64);
    this.container.addChild(outputCell);
  }
}
