import { Container, Graphics, Sprite, Text, type FederatedPointerEvent, type Texture } from "pixi.js";
import {
  allItems,
  BlockId,
  countInInventory,
  HOTBAR_SIZE,
  ingredientLabel,
  ingredientOptions,
  itemDef,
  liquidDef,
  matchGrid,
  RECIPES,
  SMALL_GRID_INDICES,
  TRADES,
  type InventorySlots,
  type ItemStack,
  type Recipe,
  type SlotRef,
} from "@flatcraft/sim";
import { hexToNumber } from "./color.js";
import { itemTexture } from "./icons.js";

const SLOT = 40;
const PAD = 4;
const ICON = 32;

export type SlotClickHandler = (slot: SlotRef, button: "left" | "right") => void;

/**
 * Item tooltip state: slot widgets set the hovered item's name here and
 * the renderer draws it next to the pointer each frame.
 */
let tooltipText: string | null = null;

export function currentTooltip(): string | null {
  return tooltipText;
}

/** "cooked_beef" -> "Cooked Beef" */
function prettyName(id: string): string {
  return id
    .split("_")
    .map((word) => (word[0] ?? "").toUpperCase() + word.slice(1))
    .join(" ");
}

function tooltipFor(stack: ItemStack): string {
  // The datapack display name, falling back to the prettified id.
  const lines = [itemDef(stack.item)?.name ?? prettyName(stack.item)];
  if (stack.data?.liquid !== undefined) {
    const capacity = itemDef(stack.item)?.bucket ?? stack.data.amount ?? 0;
    lines.push(`${prettyName(stack.data.liquid)} ${stack.data.amount ?? 0}/${capacity}`);
  }
  for (const ench of stack.ench ?? []) {
    lines.push(`${prettyName(ench.id)} ${ench.level}`);
  }
  return lines.join("\n");
}

/** Tints a bucket icon to show what it's carrying (undefined = empty). */
export function liquidTint(stack: ItemStack): number | undefined {
  const tint = stack.data?.liquid !== undefined ? liquidDef(stack.data.liquid)?.tint : undefined;
  return tint !== undefined ? hexToNumber(tint) : undefined;
}

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
      const tint = liquidTint(stack);
      if (tint !== undefined) sprite.tint = tint;
      else if (stack.ench?.length) sprite.tint = 0xccaaff; // enchanted shimmer
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
  if (stack) {
    // Hovering shows the item name (pointermove keeps it fresh across
    // panel rebuilds, pointerout clears it).
    cell.eventMode = "static";
    const text = tooltipFor(stack);
    const show = (): void => {
      tooltipText = text;
    };
    cell.on("pointerover", show);
    cell.on("pointermove", show);
    cell.on("pointerout", () => {
      if (tooltipText === text) tooltipText = null;
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
    const tint = liquidTint(stack);
    if (tint !== undefined) sprite.tint = tint;
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

/**
 * The player's inventory (3 rows + hotbar row) as a clickable grid, shown
 * inside container screens (furnace, chest, backpack) so items can be
 * moved in and out. Returns the section's pixel height via `sectionHeight`.
 */
function inventorySection(
  slots: InventorySlots,
  selected: number,
  blockTextures: Map<BlockId, Texture>,
  onSlotClick: SlotClickHandler | null,
): Container {
  const section = new Container();
  const label = new Text({
    text: "Inventory",
    style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
  });
  section.addChild(label);
  const y0 = 20;
  const click = (index: number) => (button: "left" | "right") =>
    onSlotClick?.({ container: "inventory", index }, button);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      const index = 9 + row * 9 + col;
      const cell = slotWidget(slots[index] ?? null, blockTextures, { onClick: click(index) });
      cell.position.set(col * (SLOT + PAD), y0 + row * (SLOT + PAD));
      section.addChild(cell);
    }
  }
  const hotbarY = y0 + 3 * (SLOT + PAD) + 6;
  for (let col = 0; col < 9; col++) {
    const cell = slotWidget(slots[col] ?? null, blockTextures, {
      highlighted: col === selected,
      onClick: click(col),
    });
    cell.position.set(col * (SLOT + PAD), hotbarY);
    section.addChild(cell);
  }
  return section;
}

/** Pixel height of an inventorySection. */
const INVENTORY_SECTION_HEIGHT = 20 + 4 * (SLOT + PAD) + 6;
/** Pixel width of an inventorySection (9 columns). */
const INVENTORY_SECTION_WIDTH = 9 * (SLOT + PAD) - PAD;

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

/** Hunger row (drumsticks) above the hotbar, mirroring the hearts. */
export class HungerUI {
  readonly container = new Container();

  update(hunger: number, max: number): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const icons = Math.ceil(max / 2);
    const gfx = new Graphics();
    for (let i = 0; i < icons; i++) {
      // Drawn right-to-left so the bar drains from the left, like Minecraft.
      const x = (icons - 1 - i) * 18;
      const points = hunger - i * 2;
      gfx.rect(x, 0, 14, 12).fill({ color: 0x2e1e0e, alpha: 0.8 });
      if (points >= 2) {
        gfx.rect(x + 1, 1, 12, 10).fill({ color: 0xc88a3a });
      } else if (points === 1) {
        gfx.rect(x + 7, 1, 6, 10).fill({ color: 0xc88a3a });
      }
    }
    this.container.addChild(gfx);
  }

  get width(): number {
    return 10 * 18 - 4;
  }
}

/** Air bubbles while diving, above the hunger bar. */
export class AirUI {
  readonly container = new Container();

  update(air: number, max: number): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (air >= max) return; // fully surfaced: no bubbles shown
    const bubbles = 10;
    const filled = Math.ceil((Math.max(0, air) / max) * bubbles);
    const gfx = new Graphics();
    for (let i = 0; i < bubbles; i++) {
      const x = (bubbles - 1 - i) * 18;
      if (i < filled) {
        gfx.circle(x + 7, 6, 5).fill({ color: 0x9adcf0 });
      } else {
        gfx.circle(x + 7, 6, 5).stroke({ color: 0x9adcf0, width: 1, alpha: 0.5 });
      }
    }
    this.container.addChild(gfx);
  }

  get width(): number {
    return 10 * 18 - 4;
  }
}

/**
 * Creative item picker: every registered item in a scrollable grid.
 * Left click gives 1, right click a full stack.
 */
export class CreativePanelUI {
  readonly container = new Container();
  onGive: ((item: string, count: number) => void) | null = null;

  private offset = 0;
  private readonly items: string[];

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
    this.items = [...allItems()].map((def) => def.id);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  open(): void {
    this.container.visible = true;
    this.rebuild();
  }

  close(): void {
    this.container.visible = false;
  }

  scrollBy(delta: number): void {
    const cols = 9;
    const rows = Math.ceil(this.items.length / cols);
    const maxOffset = Math.max(0, rows * (SLOT + PAD) - 6 * (SLOT + PAD));
    this.offset = Math.max(0, Math.min(maxOffset, this.offset + delta * 0.5));
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const cols = 9;
    const viewRows = 6;
    const width = cols * (SLOT + PAD) + 3 * PAD;
    const height = viewRows * (SLOT + PAD) + 40;

    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    background.eventMode = "static";
    this.container.addChild(background);

    const title = new Text({
      text: "Creative (click: 1, right: stack, wheel: scroll)",
      style: { fill: "#cccccc", fontSize: 12, fontFamily: "monospace" },
    });
    title.position.set(PAD * 2, 8);
    this.container.addChild(title);

    const list = new Container();
    this.items.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const cellY = row * (SLOT + PAD) - this.offset;
      if (cellY < -SLOT || cellY > viewRows * (SLOT + PAD)) return;
      const cell = slotWidget({ item, count: 1 }, this.blockTextures, {
        onClick: (button) => this.onGive?.(item, button === "left" ? 1 : 64),
      });
      cell.position.set(PAD * 2 + col * (SLOT + PAD), cellY);
      list.addChild(cell);
    });
    list.position.set(0, 30);
    const mask = new Graphics().rect(0, 30, width, viewRows * (SLOT + PAD)).fill(0xffffff);
    list.mask = mask;
    this.container.addChild(mask);
    this.container.addChild(list);
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
  private armor: ItemStack | null = null;
  private offhand: ItemStack | null = null;
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

  update(
    slots: InventorySlots,
    selected: number,
    craftGrid: (ItemStack | null)[],
    armor: ItemStack | null = null,
    offhand: ItemStack | null = null,
  ): void {
    this.slots = slots;
    this.selected = selected;
    this.craftGrid = craftGrid;
    this.armor = armor;
    this.offhand = offhand;
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

    // Armor + offhand slots to the right of the crafting area.
    const gearX = PAD * 2 + gridPx + 130;
    const armorLabel = new Text({
      text: "Armor      Offhand",
      style: { fill: "#9a9aac", fontSize: 11, fontFamily: "monospace" },
    });
    armorLabel.position.set(gearX, y - 14);
    this.container.addChild(armorLabel);
    const armorCell = slotWidget(this.armor, this.blockTextures, {
      onClick: click({ container: "armor" }),
    });
    armorCell.position.set(gearX, y);
    this.container.addChild(armorCell);
    const offhandCell = slotWidget(this.offhand, this.blockTextures, {
      onClick: click({ container: "offhand" }),
    });
    offhandCell.position.set(gearX + 76, y);
    this.container.addChild(offhandCell);

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
      [...recipe.ingredients].every(
        ([key, count]) =>
          ingredientOptions(key).reduce((sum, item) => sum + countInInventory(this.slots, item), 0) >=
          count,
      );

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

    const needs = [...recipe.ingredients]
      .map(([key, count]) => `${count}x ${ingredientLabel(key)}`)
      .join(", ");
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
  private invSlots: InventorySlots = [];
  private invSelected = 0;

  constructor(
    private readonly blockTextures: Map<BlockId, Texture>,
    private readonly title: string,
    private cols: number,
    private count: number,
  ) {
    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  get width(): number {
    return this.cols * (SLOT + PAD) + 3 * PAD;
  }

  /**
   * `slotCount` resizes this opening to a datapack-declared capacity
   * that differs from the panel's constructed default (rows adjust,
   * columns stay put - a chest with more slots grows taller, not
   * wider). `colsOverride` additionally changes the column count
   * (the backpack wants exactly one row, whatever its capacity).
   */
  open(makeRef: (index: number) => SlotRef, slotCount?: number, colsOverride?: number): void {
    this.makeRef = makeRef;
    if (slotCount !== undefined) this.count = slotCount;
    if (colsOverride !== undefined) this.cols = colsOverride;
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

  setInventory(slots: InventorySlots, selected: number): void {
    this.invSlots = slots;
    this.invSelected = selected;
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const rows = Math.ceil(this.count / this.cols);
    const width = this.width;
    const height = rows * (SLOT + PAD) + 34 + INVENTORY_SECTION_HEIGHT + 12;

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

    const inv = inventorySection(this.invSlots, this.invSelected, this.blockTextures, this.onSlotClick);
    inv.position.set(PAD * 2, 34 + rows * (SLOT + PAD));
    this.container.addChild(inv);
  }
}

/** Villager trading screen: click a row to trade. */
export class TradePanelUI {
  readonly container = new Container();
  onTrade: ((villager: number, trade: number) => void) | null = null;

  private villagerId: number | null = null;
  private slots: InventorySlots = [];

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  open(villagerId: number): void {
    this.villagerId = villagerId;
    this.container.visible = true;
    this.rebuild();
  }

  close(): void {
    this.container.visible = false;
    this.villagerId = null;
  }

  update(slots: InventorySlots): void {
    this.slots = slots;
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const rowH = 28;
    const width = 340;
    const height = TRADES.length * rowH + 36;
    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    background.eventMode = "static";
    this.container.addChild(background);

    const title = new Text({
      text: "Trading (click to trade)",
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    title.position.set(PAD * 2, 8);
    this.container.addChild(title);

    TRADES.forEach((trade, index) => {
      const affordable = countInInventory(this.slots, trade.cost.item) >= trade.cost.count;
      const row = new Container();
      row.position.set(PAD * 2, 30 + index * rowH);
      const bg = new Graphics().rect(0, 0, width - PAD * 4, rowH - 3).fill({
        color: affordable ? 0x2e4e2e : 0x2a2a33,
        alpha: 0.9,
      });
      row.addChild(bg);
      for (const [i, stack] of [trade.cost, trade.result].entries()) {
        const texture = itemTexture(stack.item, this.blockTextures);
        if (texture) {
          const icon = new Sprite(texture);
          icon.width = 18;
          icon.height = 18;
          icon.position.set(4 + i * 150, 3);
          row.addChild(icon);
        }
      }
      const label = new Text({
        text: `${trade.cost.count}x ${trade.cost.item}  ->  ${trade.result.count}x ${trade.result.item}`,
        style: { fill: affordable ? "#ffffff" : "#8a8a8a", fontSize: 12, fontFamily: "monospace" },
      });
      label.position.set(28, 6);
      row.addChild(label);
      if (affordable) {
        row.eventMode = "static";
        row.cursor = "pointer";
        row.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          if (this.villagerId !== null) this.onTrade?.(this.villagerId, index);
        });
      }
      this.container.addChild(row);
    });
  }
}

/** Enchanting screen: one button, lapis cost, works on the held tool. */
export class EnchantPanelUI {
  readonly container = new Container();
  onEnchant: (() => void) | null = null;

  private slots: InventorySlots = [];
  private selected = 0;

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  open(): void {
    this.container.visible = true;
    this.rebuild();
  }

  close(): void {
    this.container.visible = false;
  }

  update(slots: InventorySlots, selected: number): void {
    this.slots = slots;
    this.selected = selected;
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const width = 300;
    const height = 120;
    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    background.eventMode = "static";
    this.container.addChild(background);

    const held = this.slots[this.selected];
    const enchText = held?.ench?.map((e) => `${e.id} ${e.level}`).join(", ") ?? "none";
    const title = new Text({
      text: `Enchanting\nHeld: ${held?.item ?? "nothing"}\nEnchants: ${enchText}`,
      style: { fill: "#cccccc", fontSize: 12, fontFamily: "monospace" },
    });
    title.position.set(10, 8);
    this.container.addChild(title);

    const lapis = countInInventory(this.slots, "lapis_lazuli");
    const affordable = lapis >= 8;
    const row = new Container();
    row.position.set(10, 84);
    const bg = new Graphics().rect(0, 0, width - 20, 26).fill({
      color: affordable ? 0x2e4e2e : 0x2a2a33,
      alpha: 0.9,
    });
    row.addChild(bg);
    const label = new Text({
      text: `Enchant held tool (8x lapis_lazuli, have ${lapis})`,
      style: { fill: affordable ? "#ffffff" : "#8a8a8a", fontSize: 12, fontFamily: "monospace" },
    });
    label.position.set(6, 5);
    row.addChild(label);
    if (affordable) {
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointerdown", (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.onEnchant?.();
      });
    }
    this.container.addChild(row);
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

/** Furnace screen: input above fuel, flame + arrow, output - plus the
 * player inventory below, so items can be dragged in. */
export class FurnacePanelUI {
  readonly container = new Container();
  onSlotClick: SlotClickHandler | null = null;

  private view: FurnaceView | null = null;
  private invSlots: InventorySlots = [];
  private invSelected = 0;

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
  }

  setInventory(slots: InventorySlots, selected: number): void {
    this.invSlots = slots;
    this.invSelected = selected;
    if (this.container.visible) this.rebuild();
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

    const width = INVENTORY_SECTION_WIDTH + 4 * PAD;
    const height = 156 + INVENTORY_SECTION_HEIGHT + 12;
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

    const inv = inventorySection(this.invSlots, this.invSelected, this.blockTextures, this.onSlotClick);
    inv.position.set(PAD * 2, 156);
    this.container.addChild(inv);
  }

  get panelWidth(): number {
    return INVENTORY_SECTION_WIDTH + 4 * PAD;
  }

  get panelHeight(): number {
    return 156 + INVENTORY_SECTION_HEIGHT + 12;
  }
}
