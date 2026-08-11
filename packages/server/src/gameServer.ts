import { Simulation, TICK_MS, type PlayerCommand } from "@flatcraft/sim";
import type { ServerConnection } from "./transport.js";

/**
 * The authoritative server loop. One instance per world, regardless of how
 * it is hosted:
 *   - singleplayer: created inside the client, connected via loopback
 *   - listen server: same, plus WebSocket connections for friends (later)
 *   - dedicated: created by a headless entry point, WebSocket only (later)
 *
 * It buffers incoming commands between ticks, feeds them to the simulation
 * at a fixed timestep, and broadcasts the resulting events to every client.
 * Scheduling (when ticks fire) is injected via `advance`, so the host
 * environment decides the clock; the server itself never reads wall time.
 */
export class GameServer {
  readonly simulation: Simulation;

  private readonly connections = new Set<ServerConnection>();
  private pendingCommands: PlayerCommand[] = [];
  private accumulatorMs = 0;

  constructor(seedOrSimulation: number | Simulation) {
    this.simulation =
      typeof seedOrSimulation === "number" ? new Simulation(seedOrSimulation) : seedOrSimulation;
  }

  addConnection(connection: ServerConnection): void {
    this.connections.add(connection);
    connection.onCommand((command) => {
      this.pendingCommands.push({ player: connection.playerId, command });
    });
  }

  removeConnection(connection: ServerConnection): void {
    if (this.connections.delete(connection)) {
      this.pendingCommands.push({ player: connection.playerId, command: { type: "leave" } });
      connection.close();
    }
  }

  /**
   * Feed elapsed wall-clock time; runs zero or more fixed-size ticks.
   * Call this from requestAnimationFrame (embedded) or setInterval (headless).
   */
  advance(elapsedMs: number): void {
    this.accumulatorMs += elapsedMs;
    // Cap the backlog so a suspended tab doesn't fast-forward thousands of ticks.
    const maxBacklogMs = TICK_MS * 20;
    if (this.accumulatorMs > maxBacklogMs) this.accumulatorMs = maxBacklogMs;

    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;
      this.runTick();
    }
  }

  private runTick(): void {
    const commands = this.pendingCommands;
    this.pendingCommands = [];
    const outbound = this.simulation.tick(commands);
    if (outbound.length === 0) return;
    for (const connection of this.connections) {
      const events = outbound
        .filter((o) => o.to === undefined || o.to === connection.playerId)
        .map((o) => o.event);
      if (events.length > 0) {
        connection.send(events);
      }
    }
  }
}
