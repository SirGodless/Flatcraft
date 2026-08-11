import { Application, Container, Graphics, Text } from "pixi.js";
import type { SimEvent } from "@flatcraft/sim";
import { Camera } from "./camera.js";
import { createBlockTextures, TILE_PX } from "./textures.js";
import { CHUNK_PX_H, CHUNK_PX_W, WorldView } from "./worldView.js";

export interface ChunkRange {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

/**
 * Rendering layer. Consumes SimEvents and draws; it never mutates game
 * state. Owns the camera (pure view state) and the client-side world mirror.
 */
export class Renderer {
  readonly camera = new Camera();
  worldView!: WorldView;

  private readonly app = new Application();
  private readonly worldContainer = new Container();
  private playerMarker!: Graphics;
  private hud!: Text;

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: container, background: "#87b9e7" });
    container.appendChild(this.app.canvas);

    this.worldView = new WorldView(this.app.renderer, createBlockTextures());
    this.worldContainer.addChild(this.worldView.container);

    this.playerMarker = new Graphics()
      .rect(0, 0, TILE_PX * 0.75, TILE_PX * 1.75)
      .fill({ color: 0xe04848 });
    this.playerMarker.visible = false;
    this.worldContainer.addChild(this.playerMarker);

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
      case "player_joined":
        this.camera.centerOnTile(event.x, event.y);
        this.playerMarker.position.set(event.x * TILE_PX + TILE_PX * 0.125, (event.y - 0.75) * TILE_PX);
        this.playerMarker.visible = true;
        break;
      case "chunk_data":
        this.worldView.setChunk(event.cx, event.cy, event.tiles);
        break;
      case "block_changed":
        this.worldView.setBlock(event.x, event.y, event.block);
        break;
      case "command_rejected":
        // Surfacing rejections in the UI comes with the HUD work later.
        break;
      case "player_left":
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

  draw(): void {
    this.camera.apply(this.worldContainer, this.screenWidth, this.screenHeight);
    const tx = Math.floor(this.camera.x / TILE_PX);
    const ty = Math.floor(this.camera.y / TILE_PX);
    this.hud.text = `FlatCraft | tile ${tx},${ty} | zoom ${this.camera.zoom.toFixed(1)} | LMB break, RMB place, WASD pan, wheel zoom`;
  }
}
