/**
 * Item tags, Minecraft-datapack-style: recipes may reference
 * { "tag": "flatcraft:planks" } instead of a concrete item, and any
 * member of the tag satisfies the ingredient. Internally a tag ingredient
 * is stored as "#planks".
 */
export const TAGS: Readonly<Record<string, readonly string[]>> = {
  planks: ["oak_planks", "birch_planks", "spruce_planks"],
  logs: ["oak_log", "birch_log", "spruce_log"],
};
