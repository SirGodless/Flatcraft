import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMessage } from "@flatcraft/server";
import {
  addToInventory,
  BlockId,
  countInInventory,
  findSpawnX,
  surfaceHeight,
  type Command,
  type SimEvent,
} from "@flatcraft/sim";
import { startDedicatedServer, type DedicatedServer } from "../src/server.js";

/**
 * End-to-end multiplayer tests over the real WebSocket transport: a real
 * dedicated server on an ephemeral port, real sockets, JSON on the wire.
 * White-box access to server.gameServer.simulation is used to seed
 * inventories - everything else goes through the network.
 */

const SEED = 1337;
const SPAWN_X = findSpawnX(SEED);
const SURFACE = surfaceHeight(SEED, SPAWN_X);

class TestClient {
  readonly events: SimEvent[] = [];
  playerId = 0;
  name = "";
  token = "";
  private socket!: WebSocket;

  static connect(
    port: number,
    auth: { name: string; password?: string; token?: string },
  ): Promise<TestClient> {
    const client = new TestClient();
    client.socket = new WebSocket(`ws://localhost:${port}/ws`);
    return new Promise((resolve, reject) => {
      client.socket.on("open", () => {
        client.socket.send(JSON.stringify({ type: "auth", ...auth }));
      });
      client.socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as ServerMessage;
        if (message.type === "auth_ok") {
          client.playerId = message.playerId;
          client.name = message.name;
          client.token = message.token;
          resolve(client);
        } else if (message.type === "auth_error") {
          reject(new Error(message.reason));
        } else if (message.type === "events") {
          client.events.push(...message.events);
        }
      });
      client.socket.on("error", (error) => reject(error));
    });
  }

  send(command: Command): void {
    this.socket.send(JSON.stringify({ type: "command", command }));
  }

  join(): void {
    this.send({ type: "join", name: this.name });
  }

  /** Wait until an event matching the predicate arrived (or time out). */
  waitFor<T extends SimEvent>(predicate: (event: SimEvent) => event is T, timeoutMs = 3000): Promise<T>;
  waitFor(predicate: (event: SimEvent) => boolean, timeoutMs?: number): Promise<SimEvent>;
  waitFor(predicate: (event: SimEvent) => boolean, timeoutMs = 3000): Promise<SimEvent> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const poll = (): void => {
        const found = this.events.find(predicate);
        if (found) {
          resolve(found);
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error(`timed out waiting for event; got ${JSON.stringify(this.events.map((e) => e.type))}`));
        } else {
          setTimeout(poll, 25);
        }
      };
      poll();
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.on("close", () => resolve());
      this.socket.close();
    });
  }
}

let server: DedicatedServer | null = null;
let dataDir: string | null = null;

async function startServer(existingDataDir?: string): Promise<DedicatedServer> {
  dataDir = existingDataDir ?? mkdtempSync(join(tmpdir(), "flatcraft-test-"));
  server = await startDedicatedServer({
    port: 0,
    dataDir,
    seed: SEED,
    log: () => {},
  });
  return server;
}

afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = null;
  }
});

describe("auth", () => {
  it("registers on first login, rejects wrong passwords, accepts tokens", async () => {
    const ded = await startServer();
    const alice = await TestClient.connect(ded.port, { name: "Alice", password: "secret1" });
    expect(alice.token.length).toBeGreaterThan(10);
    await alice.close();

    await expect(TestClient.connect(ded.port, { name: "Alice", password: "wrong" })).rejects.toThrow(
      "wrong password",
    );
    const byToken = await TestClient.connect(ded.port, { name: "Alice", token: alice.token });
    expect(byToken.playerId).not.toBe(alice.playerId);
    await byToken.close();

    await expect(TestClient.connect(ded.port, { name: "x", password: "secret1" })).rejects.toThrow(
      "invalid name",
    );
  });

  it("allows only one live session per account", async () => {
    const ded = await startServer();
    const first = await TestClient.connect(ded.port, { name: "Bob", password: "secret1" });
    await expect(TestClient.connect(ded.port, { name: "Bob", password: "secret1" })).rejects.toThrow(
      "already connected",
    );
    await first.close();
    // After disconnecting, the account is free again.
    const again = await TestClient.connect(ded.port, { name: "Bob", password: "secret1" });
    await again.close();
  });

  it("forces the account name onto join commands", async () => {
    const ded = await startServer();
    const mallory = await TestClient.connect(ded.port, { name: "Mallory", password: "secret1" });
    mallory.send({ type: "join", name: "Admin" });
    const joined = await mallory.waitFor((e) => e.type === "player_joined");
    expect(joined.type === "player_joined" && joined.name).toBe("Mallory");
    await mallory.close();
  });
});

describe("two players", () => {
  it("see each other join and move", async () => {
    const ded = await startServer();
    const alice = await TestClient.connect(ded.port, { name: "Alice", password: "secret1" });
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);

    const bob = await TestClient.connect(ded.port, { name: "Bob", password: "secret1" });
    bob.join();
    // Bob learns about Alice (join replay) and Alice learns about Bob.
    const bobSeesAlice = await bob.waitFor(
      (e) => e.type === "player_joined" && e.player === alice.playerId,
    );
    expect(bobSeesAlice.type === "player_joined" && bobSeesAlice.name).toBe("Alice");
    await alice.waitFor((e) => e.type === "player_joined" && e.player === bob.playerId);

    // Alice walks; Bob sees her position change.
    alice.send({ type: "move", dx: 1, jump: false });
    const moved = await bob.waitFor(
      (e) => e.type === "player_moved" && e.player === alice.playerId && e.x > SPAWN_X + 1,
    );
    expect(moved.type).toBe("player_moved");
    await alice.close();
    await bob.close();
  });

  it("broadcast block changes and share chest contents", async () => {
    const ded = await startServer();
    const alice = await TestClient.connect(ded.port, { name: "Alice", password: "secret1" });
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const bob = await TestClient.connect(ded.port, { name: "Bob", password: "secret1" });
    bob.join();
    await bob.waitFor((e) => e.type === "player_joined" && e.player === bob.playerId);

    // Seed Alice's inventory white-box, then act over the wire.
    const sim = ded.gameServer.simulation;
    const aliceState = sim.players.get(alice.playerId)!;
    addToInventory(aliceState.inventory, "chest", 1);
    addToInventory(aliceState.inventory, "cobblestone", 3);

    // Place the chest into free air beside the spawn.
    const chestX = SPAWN_X + 2;
    const chestY = SURFACE - 2;
    alice.send({ type: "place_block", x: chestX, y: chestY });
    const change = await bob.waitFor(
      (e) => e.type === "block_changed" && e.x === chestX && e.y === chestY,
    );
    expect(change.type === "block_changed" && change.block).toBe(BlockId.Chest);

    // Alice puts cobblestone into the chest: pick up from inventory slot,
    // drop into chest slot 0.
    const slot = aliceState.inventory.findIndex((s) => s?.item === "cobblestone");
    alice.send({ type: "open_chest", x: chestX, y: chestY });
    await alice.waitFor((e) => e.type === "chest_changed");
    alice.send({ type: "slot_click", slot: { container: "inventory", index: slot }, button: "left" });
    alice.send({
      type: "slot_click",
      slot: { container: "chest", x: chestX, y: chestY, index: 0 },
      button: "left",
    });

    // Bob sees the shared chest content.
    const chestUpdate = await bob.waitFor(
      (e) =>
        e.type === "chest_changed" &&
        e.x === chestX &&
        e.slots[0]?.item === "cobblestone" &&
        e.slots[0].count === 3,
    );
    expect(chestUpdate.type).toBe("chest_changed");
    await alice.close();
    await bob.close();
  });
});

describe("persistence", () => {
  it("keeps player state across reconnects", async () => {
    const ded = await startServer();
    const alice = await TestClient.connect(ded.port, { name: "Alice", password: "secret1" });
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    addToInventory(sim.players.get(alice.playerId)!.inventory, "diamond", 5);
    await alice.close();

    // Wait until the leave is processed by a tick.
    await new Promise((r) => setTimeout(r, 200));
    const again = await TestClient.connect(ded.port, { name: "Alice", token: alice.token });
    again.join();
    const inventory = await again.waitFor((e) => e.type === "inventory_changed");
    expect(
      inventory.type === "inventory_changed" && countInInventory(inventory.slots, "diamond"),
    ).toBe(5);
    await again.close();
  });

  it("persists world, players and accounts across a server restart", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    const alice = await TestClient.connect(ded.port, { name: "Alice", password: "secret1" });
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    addToInventory(sim.players.get(alice.playerId)!.inventory, "emerald", 7);
    sim.world.setBlock(SPAWN_X + 4, SURFACE - 3, BlockId.Glowstone);
    await alice.close();
    await new Promise((r) => setTimeout(r, 200));
    await server!.close();
    server = null;

    const restarted = await startServer(dir);
    expect(
      restarted.gameServer.simulation.world.getBlockGenerating(SPAWN_X + 4, SURFACE - 3),
    ).toBe(BlockId.Glowstone);

    // The account (via token) and the player state survived the restart.
    const again = await TestClient.connect(restarted.port, { name: "Alice", token: alice.token });
    again.join();
    const inventory = await again.waitFor((e) => e.type === "inventory_changed");
    expect(
      inventory.type === "inventory_changed" && countInInventory(inventory.slots, "emerald"),
    ).toBe(7);
    await again.close();
  });
});
