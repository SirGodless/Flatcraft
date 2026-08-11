# FlatCraft Architecture

The guiding rule: **singleplayer is multiplayer with an embedded server.**
Everything below exists to make the later jump to real netcode a transport
swap, not a rewrite.

## Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ @flatcraft/client (browser only)                                │
│                                                                 │
│   Input ──► Commands ──┐            ┌──► Renderer (PixiJS)      │
│                        │            │       ▲                   │
│                        ▼            │       │ SimEvents         │
│              ClientConnection ──────┘       │                   │
└────────────────────────┼────────────────────┼───────────────────┘
                         │  transport boundary │
        singleplayer: loopback (in-process)    │
        multiplayer:  WebSocket (later)        │
┌────────────────────────┼────────────────────┼───────────────────┐
│ @flatcraft/server      ▼                    │                   │
│              ServerConnection(s)            │                   │
│                        │                    │                   │
│                        ▼                    │                   │
│   GameServer: buffers commands, runs fixed-timestep ticks,      │
│               broadcasts events                                 │
└────────────────────────┼────────────────────────────────────────┘
                         │ PlayerCommand[] per tick
┌────────────────────────▼────────────────────────────────────────┐
│ @flatcraft/sim (pure, deterministic, environment-free)          │
│                                                                 │
│   Simulation.tick(commands) ──► SimEvent[]                      │
│   World / Chunks / Blocks / Entities / Physics / Inventory      │
└─────────────────────────────────────────────────────────────────┘
```

## Core rules

1. **Simulation is pure.** `@flatcraft/sim` never imports DOM, PixiJS, Node
   APIs, wall-clock time or `Math.random`. All randomness comes from the
   seeded RNG (`createRng`/`hashSeed`), all inputs arrive as commands, all
   time is tick counts. Same seed + same command stream = identical state on
   every machine. This is what makes server-authoritative sync (and replays,
   and headless testing) possible.

2. **Fixed timestep.** The simulation advances in 50 ms ticks (20 TPS).
   `GameServer.advance(elapsedMs)` accumulates real time and runs whole
   ticks; rendering interpolates per frame on top. Frame rate never affects
   game outcomes.

3. **Commands in, events out.** Nothing outside the simulation mutates game
   state. The client expresses intent as `Command` values ("I want to break
   block (x,y)"); the simulation validates and either applies the change and
   emits a `SimEvent`, or rejects it. Commands and events are plain JSON
   data - they *are* the future wire protocol.

4. **Transport is an interface.** `ServerConnection`/`ClientConnection` hide
   how messages travel. Today there is one implementation (in-process
   loopback, which structured-clones every message so nothing
   non-serializable can sneak across). The WebSocket implementation comes
   later and changes nothing above or below the boundary.

5. **Serializable state only.** World state lives in typed arrays
   (`Uint16Array` per chunk) and plain data structures, so chunks can be
   snapshotted for save files today and streamed to clients tomorrow.

## Hosting modes (target picture)

| Mode | How it runs |
| --- | --- |
| Singleplayer | `GameServer` embedded in the browser client, loopback transport. Works today. |
| Listen server (host & friends) | Same embedded `GameServer`; host uses loopback, friends connect via WebSocket connections added with `addConnection`. |
| Dedicated server | `@flatcraft/dedicated` runs `GameServer` headless under Node, WebSocket only. |

All three share the same `GameServer` and `Simulation` code; only the entry
point and the set of connections differ.

## Package dependency graph

```
client ──► server ──► sim
dedicated ─┘            ▲
        └───────────────┘
```

`sim` depends on nothing. `server` depends only on `sim`. Rendering/input
concerns never leak downward.
