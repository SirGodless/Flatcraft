import { Application, Container, Graphics, Text } from "pixi.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH, TICK_MS, type PlayerId, type SimEvent } from "@flatcraft/sim";
import { Camera } from "./camera.js";
import { createBlockTextures, TILE_PX } from "./textures.js";
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

  private readonly app = new Application();
  private readonly worldContainer = new Container();
  private readonly players = new Map<PlayerId, PlayerMarker>();
  private hud!: Text;

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: container, background: "#87b9e7" });
    container.appendChild(this.app.canvas);

    this.worldView = new WorldView(this.app.renderer, createBlockTextures());
    this.worldContainer.addChild(this.worldView.container);
    this.app.stage.addChild(this.worldContainer);

    this.hud = new Text({
      text: "",
      style: { fill: "#ffffff", fontSize: 14, fontFamily: "monospace" },
    });
    this.hud.position.set(8, 8);
    this.app.stage.addChild(this.hud);
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
        break;
      }
      case "chunk_data":
        this.worldView.setChunk(event.cx, event.cy, event.tiles);
        break;
      case "block_changed":
        this.worldView.setBlock(event.x, event.y, event.block);
        break;
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

    const px = localX !== null ? Math.floor(localX) : Math.floor(this.camera.x / TILE_PX);
    const py = localY !== null ? Math.floor(localY) : Math.floor(this.camera.y / TILE_PX);
    this.hud.text = `FlatCraft | tile ${px},${py} | zoom ${this.camera.zoom.toFixed(1)} | A/D walk, Space jump, LMB break, RMB place, wheel zoom`;
  }
}
