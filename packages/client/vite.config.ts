import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const spritesDir = join(here, "public/sprites");

/** All PNGs under public/sprites, as "item/x.png"-style paths. */
function scanSprites(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".png")) out.push(relative(spritesDir, full).replaceAll("\\", "/"));
    }
  };
  walk(spritesDir);
  return out;
}

/**
 * Sprites live in the repo under public/sprites/<type>/<id>.png; this
 * plugin generates /sprites/manifest.json automatically (dev server:
 * on the fly; build: written into dist), so dropping a PNG into the
 * folder is all it takes.
 */
function spriteManifest(): Plugin {
  return {
    name: "flatcraft-sprite-manifest",
    configureServer(server) {
      server.middlewares.use("/sprites/manifest.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(scanSprites()));
      });
    },
    closeBundle() {
      const outDir = join(here, "dist/sprites");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "manifest.json"), JSON.stringify(scanSprites()));
    },
  };
}

export default defineConfig({
  plugins: [spriteManifest()],
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
