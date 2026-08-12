import type { Container } from "pixi.js";
import { TILE_PX } from "./textures.js";

/**
 * View state only - which part of the world is on screen. Purely client-side;
 * the simulation never knows or cares where the camera is.
 */
export class Camera {
  /** World-pixel coordinates of the screen center. */
  x = 0;
  y = 0;
  zoom = 2;

  centerOnTile(tileX: number, tileY: number): void {
    this.x = (tileX + 0.5) * TILE_PX;
    this.y = (tileY + 0.5) * TILE_PX;
  }

  apply(container: Container, screenWidth: number, screenHeight: number): void {
    container.scale.set(this.zoom);
    container.position.set(screenWidth / 2 - this.x * this.zoom, screenHeight / 2 - this.y * this.zoom);
  }

  screenToWorld(sx: number, sy: number, screenWidth: number, screenHeight: number): { x: number; y: number } {
    return {
      x: this.x + (sx - screenWidth / 2) / this.zoom,
      y: this.y + (sy - screenHeight / 2) / this.zoom,
    };
  }

  screenToTile(sx: number, sy: number, screenWidth: number, screenHeight: number): { x: number; y: number } {
    const world = this.screenToWorld(sx, sy, screenWidth, screenHeight);
    return { x: Math.floor(world.x / TILE_PX), y: Math.floor(world.y / TILE_PX) };
  }
}
