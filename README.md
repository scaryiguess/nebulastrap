# NebulaStrap

A Roblox Fast Flag injector for Windows. One portable `.exe` — no installer, no Python,
no Node needed on the machine it runs on.

**[Download the latest release](https://github.com/scaryiguess/nebulastrap/releases/latest)** —
grab `NebulaStrap.exe` and run it.

## What it does

- Applies Fast Flags to a running Roblox client in memory, with per-build offsets
- Undoes them again — detach or Uninject puts every original value back, byte for byte
- Built-in presets, plus your own (import, export, rename, copy)
- Live Monitor rewrites flags the client resets, without ever writing until you press Save
- Macros — record and replay keyboard and mouse, auto clicker, app hotkeys
- RAM flush, on demand or automatically above a memory threshold
- Multi-instance, uncap FPS, close to tray
- Updates itself

## First run

Four things that look like the app is broken, and are not:

1. **A UAC prompt appears.** The app relaunches itself elevated — reading and writing
   another process' memory requires it.
2. **SmartScreen or Defender will warn you.** It is an unsigned executable that writes
   into another process. *More info → Run anyway.*
3. **The first Attach needs internet.** The offset table is downloaded for your exact
   Roblox build. There is a disk cache after that.
4. **Settings live in `%APPDATA%\fflag-injector-v3`**, not next to the exe. Portable
   means no installer, not that it carries its data with it.

## "Build does not match"

The offsets are dumped per Roblox build. If your client is on a build nobody has dumped
yet, injection is blocked on purpose — every address would belong to a different build,
and the client would close.

Fix it by pinning your Roblox version with a bootstrapper (Bloxstrap, Fishstrap) to a
build that has offsets, or wait for the dump and press Attach again. **Do not turn Safe
writes off to push past it.**

## Safety

Safe writes, on by default, refuses any write that lands in an executable section,
overruns into the next flag, or corrupts a `std::string`. Sane limits clamps values that
are high enough to take the client down on their own — unbounded asset preloading, a
teleport preload percentage ten times its own maximum, million-thread runtime pools.

## Credits

Sidebar artwork by **Roulette** and **P'Fai**. Offsets from
[offsets.imtheo.lol](https://offsets.imtheo.lol).
