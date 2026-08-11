import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  BlockId,
  countInInventory,
  HOTBAR_SIZE,
  RECIPES,
  type InventorySlots,
  type Recipe,
} from "@flatcraft/sim";
import { itemTexture } from "./icons.js";

const SLOT = 40;
const PAD = 4;
const ICON = 32;

function slotBackground(g: Graphics, x: number, y: number, highlighted: boolean): void {
  g.rect(x, y, SLOT, SLOT)
    .fill({ color: 0x000000, alpha: 0.45 })
    .stroke({ color: highlighted ? 0xffffff : 0x888888, width: highlighted ? 3 : 1 });
}

function makeSlotIcon(
  item: string,
  count: number,
  blockTextures: Map<BlockId, Texture>,
): Container {
  const cell = new Container();
  const texture = itemTexture(item, blockTextures);
  if (texture) {
    const sprite = new Sprite(texture);
    sprite.width = ICON;
    sprite.height = ICON;
    sprite.position.set((SLOT - ICON) / 2, (SLOT - ICON) / 2);
    cell.addChild(sprite);
  }
  if (count > 1) {
    const label = new Text({
      text: String(count),
      style: { fill: "#ffffff", fontSize: 12, fontFamily: "monospace", fontWeight: "bold" },
    });
    label.position.set(SLOT - PAD - label.width, SLOT - PAD - label.height);
    cell.addChild(label);
  }
  return cell;
}

/** The 9-slot hotbar, bottom center of the screen. */
export class HotbarUI {
  readonly container = new Container();

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {}

  update(slots: InventorySlots, selected: number): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));
    const background = new Graphics();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      slotBackground(background, i * (SLOT + PAD), 0, i === selected);
    }
    this.container.addChild(background);
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const stack = slots[i];
      if (!stack) continue;
      const cell = makeSlotIcon(stack.item, stack.count, this.blockTextures);
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
 * Inventory + recipe-book panel (toggled with E). Shows the main
 * inventory grid and every recipe; craftable ones are clickable.
 */
export class CraftingPanelUI {
  readonly container = new Container();
  onCraft: ((recipeId: string) => void) | null = null;

  private slots: InventorySlots = [];

  constructor(private readonly blockTextures: Map<BlockId, Texture>) {
    this.container.visible = false;
  }

  toggle(): void {
    this.container.visible = !this.container.visible;
    if (this.container.visible) this.rebuild();
  }

  update(slots: InventorySlots): void {
    this.slots = slots;
    if (this.container.visible) this.rebuild();
  }

  private rebuild(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }));

    const rows = Math.ceil(RECIPES.size / 1);
    const invCols = 9;
    const invRows = 3;
    const recipeRowH = 26;
    const width = Math.max(invCols * (SLOT + PAD) + 2 * PAD, 480);
    const height = invRows * (SLOT + PAD) + rows * 0 + 40 + RECIPES.size * recipeRowH + 30;

    const background = new Graphics()
      .rect(0, 0, width, height)
      .fill({ color: 0x1a1a22, alpha: 0.92 })
      .stroke({ color: 0x555566, width: 2 });
    this.container.addChild(background);

    const invTitle = new Text({
      text: "Inventory",
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    invTitle.position.set(PAD * 2, 6);
    this.container.addChild(invTitle);

    // Main inventory (slots 9..35), hotbar is always visible below anyway.
    const gridTop = 26;
    const gridGfx = new Graphics();
    for (let row = 0; row < invRows; row++) {
      for (let col = 0; col < invCols; col++) {
        slotBackground(gridGfx, PAD * 2 + col * (SLOT + PAD), gridTop + row * (SLOT + PAD), false);
      }
    }
    this.container.addChild(gridGfx);
    for (let row = 0; row < invRows; row++) {
      for (let col = 0; col < invCols; col++) {
        const stack = this.slots[9 + row * invCols + col];
        if (!stack) continue;
        const cell = makeSlotIcon(stack.item, stack.count, this.blockTextures);
        cell.position.set(PAD * 2 + col * (SLOT + PAD), gridTop + row * (SLOT + PAD));
        this.container.addChild(cell);
      }
    }

    const craftTitle = new Text({
      text: "Crafting (click a recipe)",
      style: { fill: "#cccccc", fontSize: 13, fontFamily: "monospace" },
    });
    const recipesTop = gridTop + invRows * (SLOT + PAD) + 8;
    craftTitle.position.set(PAD * 2, recipesTop - 4);
    this.container.addChild(craftTitle);

    let y = recipesTop + 16;
    for (const recipe of RECIPES.values()) {
      this.container.addChild(this.recipeRow(recipe, PAD * 2, y, width - PAD * 4, recipeRowH));
      y += recipeRowH;
    }
  }

  private recipeRow(recipe: Recipe, x: number, y: number, width: number, height: number): Container {
    const row = new Container();
    row.position.set(x, y);

    const craftable = [...recipe.ingredients].every(
      ([item, count]) => countInInventory(this.slots, item) >= count,
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
      .map(([item, count]) => `${count}x ${item}`)
      .join(", ");
    const suffix = recipe.gridSize === 3 ? " [table]" : "";
    const label = new Text({
      text: `${recipe.result.count}x ${recipe.result.item}  <-  ${needs}${suffix}`,
      style: {
        fill: craftable ? "#ffffff" : "#777777",
        fontSize: 12,
        fontFamily: "monospace",
      },
    });
    label.position.set(26, (height - 3 - label.height) / 2);
    row.addChild(label);

    if (craftable) {
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointerdown", (e) => {
        e.stopPropagation();
        this.onCraft?.(recipe.id);
      });
    }
    return row;
  }
}
