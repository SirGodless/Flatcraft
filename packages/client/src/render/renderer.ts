import { Application, Text } from "pixi.js";
import type { SimEvent } from "@flatcraft/sim";

/**
 * Rendering layer. Consumes SimEvents and draws; it never mutates game
 * state. Tile/chunk rendering will replace this placeholder once the
 * tilemap system lands.
 */
export class Renderer {
  private readonly app = new Application();
  private status!: Text;

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({ resizeTo: container, background: "#0e0e12" });
    container.appendChild(this.app.canvas);

    this.status = new Text({
      text: "FlatCraft - waiting for simulation...",
      style: { fill: "#e8e8e8", fontSize: 20, fontFamily: "monospace" },
    });
    this.status.position.set(24, 24);
    this.app.stage.addChild(this.status);
  }

  handleEvent(event: SimEvent): void {
    if (event.type === "player_joined") {
      this.status.text = `FlatCraft - ${event.name} joined at (${event.x}, ${event.y})`;
    }
  }

  draw(): void {
    // Pixi renders automatically via its shared ticker; per-frame camera
    // and tile updates will hook in here.
  }
}
