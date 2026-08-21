/**
 * Item tags, Minecraft-datapack-style: recipes may reference "tag:planks"
 * instead of a concrete item, and any member of the tag satisfies the
 * ingredient. Internally a tag ingredient is stored as "#planks". Tag
 * names themselves are a bare recipe-authoring grouping, not one of the
 * namespaced content types (see registry/schema.ts's needIngredientRef) -
 * only the item ids they list are qualified.
 */
export const TAGS: Readonly<Record<string, readonly string[]>> = {
  planks: ["flatcraft:item:oak_planks", "flatcraft:item:birch_planks", "flatcraft:item:spruce_planks"],
  logs: ["flatcraft:item:oak_log", "flatcraft:item:birch_log", "flatcraft:item:spruce_log"],
};
