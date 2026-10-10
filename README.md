# Heart & Soul Save Editor

A local, browser-based save editor for **Pokémon Heart & Soul v1.2.1** (a pokeemerald-based GBA hack).
It edits only the `.sav` file. The ROM is never touched.

## Quick start

1. **Close the game in mGBA.** A running emulator writes its own copy of the save and would overwrite your edit.
2. Double-click **`Start Editor.cmd`**. It installs dependencies the first time, then opens <http://localhost:5173>.
3. Click **Open save folder** and pick `C:\Users\marco\Saved Games\Roms\GBA`, then choose your `.sav`.
   (Firefox: use **Open a .sav file** instead; you'll download the edited file.)
4. Edit, then click **Review & save** (Ctrl+S). Check the change list, confirm the game is closed, save.
5. Start the game in mGBA as usual.

Keep the black console window open while using the editor; closing it stops the editor.

## What you can edit

| Area | What |
|---|---|
| **Pokémon** | Party and all 15 PC boxes. Species, nickname, level, nature, ability, shiny, held item, Poké Ball, friendship, moves with PP Ups, IVs, EVs, current HP. Create new Pokémon in empty slots, release, drag to move or swap. |
| **Bag** | All pockets plus PC item storage. Add, remove, change quantities. Quick actions: *Add all TMs*, *Add all HMs*, *Max all*. |
| **Trainer** | Money, coins, Battle Points. Shows your challenge and randomizer settings (read-only). |

Stats are calculated with the hack's exact formula, including your save's options (Base Stat Equalizer, level-50 rule, old/new stats).
Nature changes use the hack's hidden-nature field (like a Mint), so PID, gender and shininess stay intact.

## Safety

- **Backup first:** in folder mode, the current save is copied to `backups/<name> <timestamp>.sav` next to it before every save.
- **Changed-on-disk check:** if the file changed since you opened it (e.g. the game saved), nothing is written.
- **Verified write:** the result is re-read and checked before it counts. All checksums must be valid, every edit must read back correctly, and every Pokémon must be valid. Bytes outside the edited sectors (the other save slot, Hall of Fame, mGBA's clock data) must be identical to before. If any check fails, nothing is kept.
- **Undo/redo:** Ctrl+Z and Ctrl+Y. Nothing is written until you save.

To restore a backup, close the game, then copy the file from `backups/` back over your `.sav`, using the original file name.

## Not included (by design)

Map position, event flags, Pokédex editor, eggs, ribbons, contest stats, Pokérus, mail, daycare,
decorations, Hall of Fame, and changing challenge/randomizer settings. See [docs/SCOPE.md](docs/SCOPE.md).

## Development

Requires Node.js 23.6+ (runs TypeScript directly).

| Command | What it does |
|---|---|
| `npm run dev` | Start the editor locally |
| `npm run build` | Typecheck and build a static version into `dist/` |
| `npm test` | Unit, real-save and randomized tests (Vitest) |
| `npm run typecheck` | TypeScript only |
| `npm run gen` | Regenerate layout and game data from the hack (see below) |
| `npm run verify:emu -- <file.sav>` | Boot a save in mGBA and check it against the editor |

### Project layout

```
src/core/     save format, Pokémon encoding, game rules, bag, trainer, validation (pure TS, no UI)
src/ui/       React app
src/data/     generated: layout.json (struct offsets), game.json (species, moves, items, …)
public/       generated sprite atlases (Pokémon icons, front sprites, item icons)
tools/        data generators + emulator verifier
tests/        Vitest tests; tests/fixtures/ holds real saves (git-ignored)
docs/         SCOPE.md (product scope and tooling)
```

### Game data comes from the hack itself

Nothing is hand-copied from vanilla Emerald. The generators read the hack's own source and build output.

- **`gen:layout`** compiles a small probe against the hack's headers, using the game's ARM compiler and flags (in Docker).
  This gives exact struct offsets and bitfield positions.
- **`gen:data`** reads species, moves, items, abilities, EXP curves, learnsets and sprites straight out of `pokemonHnS.elf`.
  Add `-- --verify-rom "<path to your .gba>"` to prove the tables match your ROM byte for byte.

The generators expect:
- the hack source at `C:\Users\marco\Repos\pokemonHnS` (override with `HNS_SOURCE`),
- a build of it (`pokemonHnS.elf`, `pokemonHnS.gba`; built with the hack's `build.ps1`),
- Docker Desktop with the `hns-build` image (context `desktop-linux`; override with `HNS_DOCKER_IMAGE` / `HNS_DOCKER_CONTEXT`).

The generated files are committed, so you only need this when the hack changes.

### Tests

- **Real saves:** copy `.sav` files into `tests/fixtures/` (git-ignored). Each one is checked for byte-identical round-trips,
  stats that match what the game stored, and full edit/export/reload cycles.
- **Synthetic saves** are built in the tests, so the suite also runs without fixtures.
- **Randomized edit sequences** must always export a verified, re-loadable save.

### Emulator verification

`npm run verify:emu -- tests/fixtures/<file>.sav` boots the real game in a private, portable mGBA copy
(`.cache/mgba/mGBA.exe`, or set `HNS_MGBA`) through its GDB server. It checks that:

1. the game's loader accepts the save,
2. the save data in the game's RAM is byte-identical to what the editor reads,
3. the game's `GetBoxMonData` accepts every Pokémon,
4. the game's `CalculateMonStats` matches the editor's stats, for your party and for random Pokémon under random settings.

Status: checks 1–2 pass on real saves. Checks 3–4 needed a fix for an mGBA GDB quirk
(register writes use the opposite byte order); that fix hasn't been re-verified end to end yet.
