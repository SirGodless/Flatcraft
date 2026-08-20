import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMessage } from "@flatcraft/server";
import {
  addToInventory,
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_IDLE_EVICT_TICKS,
  CHUNK_WIDTH,
  countInInventory,
  findSpawnX,
  furnaceKey,
  surfaceHeight,
  type Command,
  type SimEvent,
} from "@flatcraft/sim";
import { startDedicatedServer, type DedicatedServer } from "../src/server.js";

/**
 * End-to-end multiplayer tests over the real WebSocket transport: a real
 * dedicated server on an ephemeral port, real sockets, JSON on the wire.
 * Sessions are bootstrapped via DedicatedServer.issueSession, the same
 * Accounts.establishSession call a real anfall-auth login triggers from
 * /auth/callback - the OIDC round trip itself isn't exercised here.
 * White-box access to server.gameServer.simulation is used to seed
 * inventories - everything else goes through the network.
 */

const SEED = 1337;
const SPAWN_X = findSpawnX(SEED);
const SURFACE = surfaceHeight(SEED, SPAWN_X);

class TestClient {
  readonly events: SimEvent[] = [];
  readonly pongs: number[] = [];
  playerId = 0;
  name = "";
  token = "";
  private socket!: WebSocket;

  static connect(port: number, auth: { name: string; token: string }): Promise<TestClient> {
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
        } else if (message.type === "pong") {
          client.pongs.push(message.sentAt);
        }
      });
      client.socket.on("error", (error) => reject(error));
    });
  }

  send(command: Command): void {
    this.socket.send(JSON.stringify({ type: "command", command }));
  }

  ping(sentAt: number): void {
    this.socket.send(JSON.stringify({ type: "ping", sentAt }));
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

  /** Wait until a pong for the given sentAt arrived (or time out). */
  waitForPong(sentAt: number, timeoutMs = 2000): Promise<void> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const poll = (): void => {
        if (this.pongs.includes(sentAt)) {
          resolve();
        } else if (Date.now() - started > timeoutMs) {
          reject(new Error("timed out waiting for pong"));
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

async function startServer(
  existingDataDir?: string,
  opts?: { resetWorld?: boolean; resetPlayers?: boolean },
): Promise<DedicatedServer> {
  dataDir = existingDataDir ?? mkdtempSync(join(tmpdir(), "flatcraft-test-"));
  server = await startDedicatedServer({
    port: 0,
    dataDir,
    seed: SEED,
    log: () => {},
    ...opts,
  });
  return server;
}

/** Bootstraps a session the way a real anfall-auth login would, and connects with it. */
async function connectAs(ded: DedicatedServer, name: string): Promise<TestClient> {
  const { token } = ded.issueSession(name);
  return TestClient.connect(ded.port, { name, token });
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
  it("accepts a session token issued via issueSession, rejects invalid or unknown ones", async () => {
    const ded = await startServer();
    const { token } = ded.issueSession("Alice");
    const alice = await TestClient.connect(ded.port, { name: "Alice", token });
    expect(alice.token).toBe(token);
    await alice.close();

    await expect(TestClient.connect(ded.port, { name: "Alice", token: "wrong" })).rejects.toThrow(
      "invalid session, log in again",
    );
    await expect(TestClient.connect(ded.port, { name: "x", token: "whatever" })).rejects.toThrow(
      "invalid name",
    );
  });

  it("allows only one live session per account", async () => {
    const ded = await startServer();
    const { token } = ded.issueSession("Bob");
    const first = await TestClient.connect(ded.port, { name: "Bob", token });
    await expect(TestClient.connect(ded.port, { name: "Bob", token })).rejects.toThrow("already connected");
    await first.close();
    // After disconnecting, the account is free again.
    const again = await TestClient.connect(ded.port, { name: "Bob", token });
    await again.close();
  });

  it("forces the account name onto join commands", async () => {
    const ded = await startServer();
    const mallory = await connectAs(ded, "Mallory");
    mallory.send({ type: "join", name: "Admin" });
    const joined = await mallory.waitFor((e) => e.type === "player_joined");
    expect(joined.type === "player_joined" && joined.name).toBe("Mallory");
    await mallory.close();
  });

  it("carries the chosen player color and broadcasts color changes", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.send({ type: "join", name: alice.name, color: 0x48b048 });
    const joined = await alice.waitFor((e) => e.type === "player_joined");
    expect(joined.type === "player_joined" && joined.color).toBe(0x48b048);

    const bob = await connectAs(ded, "Bob");
    bob.join();
    // Bob sees Alice's color in the join replay...
    const replay = await bob.waitFor(
      (e) => e.type === "player_joined" && e.player === alice.playerId,
    );
    expect(replay.type === "player_joined" && replay.color).toBe(0x48b048);
    // ...and a live color change reaches him too.
    alice.send({ type: "set_color", color: 0xe060b0 });
    const change = await bob.waitFor((e) => e.type === "player_color");
    expect(change.type === "player_color" && change.color).toBe(0xe060b0);
    await alice.close();
    await bob.close();
  });
});

describe("two players", () => {
  it("see each other join and move", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);

    const bob = await connectAs(ded, "Bob");
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
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const bob = await connectAs(ded, "Bob");
    bob.join();
    await bob.waitFor((e) => e.type === "player_joined" && e.player === bob.playerId);

    // Seed Alice's inventory white-box, then act over the wire.
    const sim = ded.gameServer.simulation;
    const aliceState = sim.players.get(alice.playerId)!;
    addToInventory(aliceState.inventory, "flatcraft:item:chest", 1);
    addToInventory(aliceState.inventory, "flatcraft:item:cobblestone", 3);

    // Place the chest beside the spawn, resting on the ground (the
    // placement rules require support).
    const chestX = SPAWN_X + 2;
    const chestY = SURFACE - 1;
    alice.send({ type: "place_block", x: chestX, y: chestY });
    const change = await bob.waitFor(
      (e) => e.type === "block_changed" && e.x === chestX && e.y === chestY,
    );
    expect(change.type === "block_changed" && change.block).toBe(BlockId.Chest);

    // Alice puts cobblestone into the chest: pick up from inventory slot,
    // drop into chest slot 0.
    const slot = aliceState.inventory.findIndex((s) => s?.item === "flatcraft:item:cobblestone");
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
        e.slots[0]?.item === "flatcraft:item:cobblestone" &&
        e.slots[0].count === 3,
    );
    expect(chestUpdate.type).toBe("chest_changed");
    await alice.close();
    await bob.close();
  });

  it("keeps a player's health private - a fight isn't broadcast to bystanders", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const bob = await connectAs(ded, "Bob");
    bob.join();
    await bob.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    await alice.waitFor((e) => e.type === "player_joined" && e.player === bob.playerId);

    const sim = ded.gameServer.simulation;
    const aliceState = sim.players.get(alice.playerId)!;
    sim.spawnMob("flatcraft:mob:zombie", aliceState.x, aliceState.y, []);

    // Alice sees her own health drop...
    await alice.waitFor((e) => e.type === "player_health");
    // ...but Bob, watching the same fight over the wire, never learns
    // Alice's health (he may get his own private player_health events
    // too - the zombie can tag him as well since both spawned at the
    // same default point - so the check is specifically about whose
    // health event reaches him, not whether he gets any at all).
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(bob.events.some((e) => e.type === "player_health" && e.player === alice.playerId)).toBe(false);
    await alice.close();
    await bob.close();
  });
});

describe("persistence", () => {
  it("keeps player state across reconnects", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    addToInventory(sim.players.get(alice.playerId)!.inventory, "flatcraft:item:diamond", 5);
    await alice.close();

    // Wait until the leave is processed by a tick.
    await new Promise((r) => setTimeout(r, 200));
    const again = await TestClient.connect(ded.port, { name: "Alice", token: alice.token });
    again.join();
    const inventory = await again.waitFor((e) => e.type === "inventory_changed");
    expect(
      inventory.type === "inventory_changed" && countInInventory(inventory.slots, "flatcraft:item:diamond"),
    ).toBe(5);
    await again.close();
  });

  it("persists world, players and accounts across a server restart", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    addToInventory(sim.players.get(alice.playerId)!.inventory, "flatcraft:item:emerald", 7);
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
      inventory.type === "inventory_changed" && countInInventory(inventory.slots, "flatcraft:item:emerald"),
    ).toBe(7);
    await again.close();
  });

  it("RESET_PLAYERS keeps the world but drops saved player state", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    addToInventory(sim.players.get(alice.playerId)!.inventory, "flatcraft:item:emerald", 7);
    sim.world.setBlock(SPAWN_X + 4, SURFACE - 3, BlockId.Glowstone);
    await alice.close();
    await new Promise((r) => setTimeout(r, 200));
    await server!.close();
    server = null;

    const restarted = await startServer(dir, { resetPlayers: true });
    // The world survived...
    expect(
      restarted.gameServer.simulation.world.getBlockGenerating(SPAWN_X + 4, SURFACE - 3),
    ).toBe(BlockId.Glowstone);
    // ...but Alice's saved inventory did not - same name, fresh start.
    const again = await TestClient.connect(restarted.port, { name: "Alice", token: alice.token });
    again.join();
    const inventory = await again.waitFor((e) => e.type === "inventory_changed");
    expect(
      inventory.type === "inventory_changed" && countInInventory(inventory.slots, "flatcraft:item:emerald"),
    ).toBe(0);
    await again.close();
  });

  it("RESET_WORLD starts fresh and backs up the old save instead of deleting it", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    ded.gameServer.simulation.world.setBlock(SPAWN_X + 4, SURFACE - 3, BlockId.Glowstone);
    await alice.close();
    await new Promise((r) => setTimeout(r, 200));
    await server!.close();
    server = null;

    const restarted = await startServer(dir, { resetWorld: true });
    // The old block is gone - it's a brand new world now...
    expect(
      restarted.gameServer.simulation.world.getBlockGenerating(SPAWN_X + 4, SURFACE - 3),
    ).not.toBe(BlockId.Glowstone);
    // ...but the previous save wasn't deleted, just moved aside.
    expect(readdirSync(dir).some((f) => f.startsWith("world.json.reset-"))).toBe(true);
    expect(readdirSync(dir).some((f) => f.startsWith("world.reset-"))).toBe(true);
  });

  it("terrain lives in chunk files, not in world.json - and only where actually modified", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    // Explore a wide area (forces chunk generation for physics/collision)
    // but only actually change one block.
    for (let dx = -60; dx <= 60; dx += 10) sim.world.getBlockGenerating(SPAWN_X + dx, SURFACE);
    sim.world.setBlock(SPAWN_X + 2, SURFACE - 1, BlockId.Glowstone);
    ded.save();

    const meta = JSON.parse(readFileSync(join(dir, "world.json"), "utf8")) as Record<string, unknown>;
    expect(meta["worlds"]).toBeUndefined();
    expect(meta["furnaces"]).toBeUndefined();
    expect(meta["chests"]).toBeUndefined();
    expect(existsSync(join(dir, "world", "flatcraft_dimension_overworld"))).toBe(true);
    // Exactly one chunk file - all the merely-visited chunks generated
    // nothing worth saving, only the one containing the edited block did.
    const chunkFiles = readdirSync(join(dir, "world", "flatcraft_dimension_overworld")).filter((f) => f.endsWith(".bin"));
    expect(chunkFiles).toHaveLength(1);
    await alice.close();
  });

  it("a chest's contents survive a restart, anchored with its own chunk", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;
    const aliceState = sim.players.get(alice.playerId)!;
    addToInventory(aliceState.inventory, "flatcraft:item:chest", 1);

    const chestX = SPAWN_X + 5;
    const chestY = SURFACE - 1;
    alice.send({ type: "place_block", x: chestX, y: chestY });
    await alice.waitFor((e) => e.type === "block_changed" && e.x === chestX && e.y === chestY);
    alice.send({ type: "open_chest", x: chestX, y: chestY });
    await alice.waitFor((e) => e.type === "chest_changed");
    // Put an item straight into the sim's chest state (simpler than
    // scripting slot clicks over the wire for this test's purpose).
    const chest = sim.chests.get(furnaceKey("flatcraft:dimension:overworld", chestX, chestY));
    expect(chest).toBeDefined();
    chest!.slots[0] = { item: "flatcraft:item:diamond", count: 9 };
    await alice.close();
    await new Promise((r) => setTimeout(r, 200));
    await server!.close();
    server = null;

    const restarted = await startServer(dir);
    expect(
      restarted.gameServer.simulation.world.getBlockGenerating(chestX, chestY),
    ).toBe(BlockId.Chest);
    const restoredChest = restarted.gameServer.simulation.chests.get(furnaceKey("flatcraft:dimension:overworld", chestX, chestY));
    expect(restoredChest?.slots[0]).toEqual({ item: "flatcraft:item:diamond", count: 9 });
  });

  it("an idle chunk is evicted from memory after a save, and reloads identically on next touch", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);
    const sim = ded.gameServer.simulation;

    const farX = SPAWN_X + 500; // far enough that nothing else keeps it resident
    const farY = SURFACE - 1;
    const cx = Math.floor(farX / CHUNK_WIDTH);
    const cy = Math.floor(farY / CHUNK_HEIGHT);
    sim.world.ensureChunk(cx, cy); // not resident yet - setBlock needs it loaded first
    sim.world.setBlock(farX, farY, BlockId.Glowstone);
    ded.save(); // writes the chunk file and marks the chunk clean (see World.markSaved)
    expect(sim.world.getChunk(cx, cy)).toBeDefined();

    // Fast-forward past the idle threshold without touching the chunk
    // again - no await between these two calls, so the real tick timer
    // can't sneak in and overwrite World's currentTick in between.
    sim.world.setCurrentTick(sim.tickCount + CHUNK_IDLE_EVICT_TICKS);
    const evicted = sim.evictIdleChunks();

    expect(evicted).toBeGreaterThan(0);
    expect(sim.world.getChunk(cx, cy)).toBeUndefined();
    // Reloading it (via the chunk loader, from the file just saved)
    // reproduces the exact same edit - nothing was lost by evicting it.
    expect(sim.world.getBlockGenerating(farX, farY)).toBe(BlockId.Glowstone);
    await alice.close();
  });

  it("loads a pre-version-6 world.json (fixed {overworld,nether} portals shape)", async () => {
    const ded = await startServer();
    const dir = dataDir!;
    ded.gameServer.simulation.portalsOf("flatcraft:dimension:nether").set("9,40", { x: 9, y: 40 });
    ded.save();
    await server!.close();
    server = null;

    // Rewrite the just-saved world.json's `portals` field into the old,
    // pre-version-6 fixed-object shape (see Simulation's
    // normalizePortalsField) - simulating a save file that predates the
    // dimension registry.
    const worldFile = join(dir, "world.json");
    const meta = JSON.parse(readFileSync(worldFile, "utf8")) as { portals: Array<{ dim: string; positions: unknown }> };
    const legacyPortals: Record<string, unknown> = {};
    for (const { dim, positions } of meta.portals) legacyPortals[dim] = positions;
    writeFileSync(worldFile, JSON.stringify({ ...meta, version: 5, portals: legacyPortals }));

    const restarted = await startServer(dir);
    expect(restarted.gameServer.simulation.portalsOf("flatcraft:dimension:nether").get("9,40")).toEqual({ x: 9, y: 40 });
  });
});

describe("debug overlay", () => {
  it("broadcasts periodic debug_stats with real tps/tickCount/seed/player+entity counts", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);

    const stats = await alice.waitFor((e) => e.type === "debug_stats", 3000);
    expect(stats.type === "debug_stats" && stats.tps).toBeGreaterThan(0);
    expect(stats.type === "debug_stats" && stats.tickCount).toBeGreaterThan(0);
    expect(stats.type === "debug_stats" && stats.seed).toBe(SEED);
    expect(stats.type === "debug_stats" && stats.players).toBeGreaterThanOrEqual(1);
    expect(stats.type === "debug_stats" && stats.entities).toBeGreaterThanOrEqual(stats.players);
    await alice.close();
  });

  it("answers a ping probe with a pong carrying the same timestamp back", async () => {
    const ded = await startServer();
    const alice = await connectAs(ded, "Alice");
    alice.join();
    await alice.waitFor((e) => e.type === "player_joined" && e.player === alice.playerId);

    const sentAt = 123456.789;
    alice.ping(sentAt);
    await alice.waitForPong(sentAt);
    await alice.close();
  });
});
