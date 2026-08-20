import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const spritesDir = join(here, "public/sprites");
const contentDir = join(here, "../../content/flatcraft");

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

/** flatcraft's own content/flatcraft/**\/*.json, decoded into one plain
 * object keyed by path ("blocks/stone.json" -> parsed JSON) - the client
 * fetches this ONE file at boot and re-encodes each value back to bytes
 * before handing it to loadContentPackage (see src/content.ts). A plain
 * node:fs walk rather than reusing @flatcraft/content's discoverContentDir
 * - that package is TS-source-only (no build step, `main` points at
 * src/index.ts) and Vite's own config loader can't resolve its `.js`-
 * suffixed internal imports back to `.ts` files the way tsc/vitest do,
 * so pulling it in here would break `vite build` itself. Same
 * self-contained-walk style as scanSprites() above for that reason. */
function buildFlatcraftContentManifest(): string {
  if (!existsSync(join(contentDir, "content.json"))) {
    throw new Error(`expected a "flatcraft" content package under ${contentDir}`);
  }
  const manifest: Record<string, unknown> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".json") && entry.name !== "content.json") {
        const path = relative(contentDir, full).replaceAll("\\", "/");
        manifest[path] = JSON.parse(readFileSync(full, "utf8"));
      }
    }
  };
  walk(contentDir);
  return JSON.stringify(manifest);
}

/**
 * content/flatcraft (repo root, shared with the dedicated server - see
 * @flatcraft/dedicated's server.ts) has no filesystem in the browser, so
 * it's bundled the same way sprites are: a generated static file the
 * client fetches once at boot (dev: on the fly; build: written into
 * dist).
 */
function flatcraftContentManifest(): Plugin {
  return {
    name: "flatcraft-content-manifest",
    configureServer(server) {
      server.middlewares.use("/content/flatcraft-manifest.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(buildFlatcraftContentManifest());
      });
    },
    closeBundle() {
      const outDir = join(here, "dist/content");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "flatcraft-manifest.json"), buildFlatcraftContentManifest());
    },
  };
}

export default defineConfig({
  plugins: [spriteManifest(), flatcraftContentManifest()],
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
