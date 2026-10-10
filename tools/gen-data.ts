// Generates src/data/game.json and the sprite atlases in public/sprites from the hack's build output.
//
// Every table is read from pokemonHnS.elf by symbol name, using struct layouts from layout.json, so the data
// is exactly what the game uses. With `--verify-rom <file.gba>` each table is also searched for byte-for-byte
// in that ROM (e.g. the release ROM you play), proving the data matches it.
import fs from 'node:fs';
import path from 'node:path';
import { EDITOR_ROOT, DATA_DIR, HACK_ELF, HACK_ROOT } from './lib/config.ts';
import { Elf } from './lib/elf.ts';
import { Atlas, decode4bpp, decodePalette, lz77Decompress } from './lib/gba-gfx.ts';
import { encodePng } from './lib/png.ts';
import { constant, struct, StructView } from '../src/core/layout/index.ts';
import { Charset } from '../src/core/text/charset.ts';
import type { GameData, ItemData, MoveData, NatureData, SpeciesData, StatTuple } from '../src/core/gamedata/types.ts';

const SPRITE_DIR = path.join(EDITOR_ROOT, 'public', 'sprites');

function parseCharmap(): Record<string, string> {
  const text = fs.readFileSync(path.join(HACK_ROOT, 'charmap.txt'), 'utf8');
  const map: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^'(\\'|[^'\\])'\s*=\s*([0-9A-Fa-f]{2})\s*(@.*)?$/.exec(line.trim());
    if (!m) continue;
    const ch = m[1] === "\\'" ? "'" : m[1]!;
    const byte = String(parseInt(m[2]!, 16));
    if (!(byte in map)) map[byte] = ch; // first definition wins (western block comes first)
  }
  // Line-break control codes (scroll, paragraph, newline) — only appear in descriptions.
  for (const b of [0xfa, 0xfb, 0xfe]) map[String(b)] = '\n';
  return map;
}

function readMaxMoney(): number {
  const src = fs.readFileSync(path.join(HACK_ROOT, 'src', 'money.c'), 'utf8');
  const m = /#define MAX_MONEY\s+(\d+)/.exec(src);
  if (!m) throw new Error('MAX_MONEY not found in src/money.c');
  return Number(m[1]);
}

function main() {
  const args = process.argv.slice(2);
  const verifyIdx = args.indexOf('--verify-rom');
  const verifyRomPath = verifyIdx >= 0 ? args[verifyIdx + 1] : undefined;

  const elf = new Elf(HACK_ELF);
  const charmap = parseCharmap();
  const charset = new Charset(charmap);
  const text = (bytes: Uint8Array) => charset.decode(bytes);
  const textAt = (ptr: number) => {
    // Strings in ROM: read until EOS (bounded).
    let len = 0;
    while (len < 512 && elf.u8(ptr + len) !== 0xff) len++;
    return text(elf.read(ptr, len + 1)).replace(/\n/g, ' ');
  };
  const fixedStrings = (symbol: string, width: number) => {
    const bytes = elf.readSymbol(symbol);
    const out: string[] = [];
    for (let i = 0; i + width <= bytes.length; i += width) out.push(text(bytes.subarray(i, i + width)));
    return out;
  };
  const ptrTable = (symbol: string) => {
    const s = elf.symbol(symbol);
    return Array.from({ length: s.size / 4 }, (_, i) => elf.u32(s.value + i * 4));
  };

  const NUM_SPECIES = constant('NUM_SPECIES');
  const MOVES_COUNT = constant('MOVES_COUNT');
  const ITEMS_COUNT = constant('ITEMS_COUNT');

  // ---- Species ---------------------------------------------------------------------------------------------
  const speciesNames = fixedStrings('gSpeciesNames', constant('POKEMON_NAME_LENGTH') + 1);
  const infoSym = elf.symbol('gSpeciesInfo');
  const infoBytes = elf.read(infoSym.value, infoSym.size);
  const dexSym = elf.symbol('sSpeciesToNationalPokedexNum');
  const iconTable = ptrTable('gMonIconTable');
  const species: SpeciesData[] = [];
  for (let id = 0; id < NUM_SPECIES; id++) {
    const v = new StructView('SpeciesInfo', infoBytes, id * struct('SpeciesInfo').size);
    const stats = (suffix: string): StatTuple => [
      v.get(`baseHP${suffix}`), v.get(`baseAttack${suffix}`), v.get(`baseDefense${suffix}`),
      v.get(`baseSpeed${suffix}`), v.get(`baseSpAttack${suffix}`), v.get(`baseSpDefense${suffix}`),
    ];
    const old = stats('_old');
    const [a0, a1] = v.range('abilities');
    const [o0, o1] = v.range('abilities_old');
    const [t0, t1] = v.range('types');
    const [e0, e1] = v.range('eggGroups');
    const name = speciesNames[id] ?? '?';
    species.push({
      id,
      name,
      // Species 0, the "?" placeholders between Celebi and Treecko, and SPECIES_UNUSED slots.
      unused: id === 0 || name === '?' || /^UNUSED/.test(name),
      nationalDex: id === 0 ? 0 : elf.u16(dexSym.value + (id - 1) * 2),
      baseStats: stats(''),
      baseStatsOld: old.every((s) => s === 0) ? null : old,
      types: [t0!, t1!],
      abilities: [a0!, a1!],
      abilitiesOld: [o0!, o1!],
      genderRatio: v.get('genderRatio'),
      growthRate: v.get('growthRate'),
      friendship: v.get('friendship'),
      catchRate: v.get('catchRate'),
      eggGroups: [e0!, e1!],
      icon: id < iconTable.length ? id : -1,
    });
  }

  // ---- Moves -----------------------------------------------------------------------------------------------
  const moveNames = fixedStrings('gMoveNames', constant('MOVE_NAME_LENGTH') + 1);
  const movesSym = elf.symbol('gBattleMoves');
  const moveBytes = elf.read(movesSym.value, movesSym.size);
  const moveDescPtrs = ptrTable('gMoveDescriptionPointers');
  const moves: MoveData[] = [];
  for (let id = 0; id < MOVES_COUNT; id++) {
    const v = new StructView('BattleMove', moveBytes, id * struct('BattleMove').size);
    moves.push({
      id,
      name: moveNames[id] ?? `Move ${id}`,
      type: v.get('type'),
      power: v.get('power'),
      accuracy: v.get('accuracy'),
      pp: v.get('pp'),
      category: v.get('category'),
      priority: v.getSigned('priority'),
      // Description table starts at move 1.
      description: id > 0 && moveDescPtrs[id - 1] ? textAt(moveDescPtrs[id - 1]!) : '',
    });
  }

  // ---- Items -----------------------------------------------------------------------------------------------
  const itemSize = struct('Item').size;
  const items1 = elf.readSymbol('gItems');
  const items2 = elf.readSymbol('gItems2');
  const tmhmMoves = Array.from(
    { length: constant('NUM_TECHNICAL_MACHINES') + constant('NUM_HIDDEN_MACHINES') },
    (_, i) => elf.u16(elf.symbol('sTMHMMoves').value + i * 2),
  );
  const items: ItemData[] = [];
  for (let id = 0; id < ITEMS_COUNT; id++) {
    const v = new StructView('Item', items1, id * itemSize);
    const v2 = new StructView('Item', items2, id * itemSize);
    // Slots whose itemId doesn't match are gaps/dummies in the item enum (e.g. ITEM_UNUSED_BERRY_1).
    const listedId = v.get('itemId');
    const descPtr = elf.u32(v.rangeOffset('description') + elf.symbol('gItems').value);
    const item: ItemData = {
      id,
      name: text(v.range('name')),
      unused: id === 0 || listedId !== id,
      pocket: v.get('pocket'),
      important: v.get('importance') !== 0,
      importantFinite: v2.get('importance') !== 0,
      price: v.get('price'),
      holdEffect: v.get('holdEffect'),
      description: descPtr ? textAt(descPtr) : '',
    };
    const tm = id - constant('ITEM_TM01');
    if (tm >= 0 && tm < tmhmMoves.length) item.tmMove = tmhmMoves[tm];
    items.push(item);
  }

  // ---- Abilities, natures, types ---------------------------------------------------------------------------
  const abilityNames = fixedStrings('gAbilityNames', constant('ABILITY_NAME_LENGTH') + 1);
  const abilityDescs = ptrTable('gAbilityDescriptionPointers');
  const abilities = abilityNames.map((name, i) => ({ name, description: abilityDescs[i] ? textAt(abilityDescs[i]!) : '' }));

  const natureNames = ptrTable('gNatureNamePointers').map(textAt);
  const natureStatBytes = elf.readSymbol('gNatureStatTable');
  const natureStatTable = natureNames.map((_, n) =>
    Array.from({ length: 5 }, (_, s) => (natureStatBytes[n * 5 + s]! << 24) >> 24),
  );
  const natures: NatureData[] = natureNames.map((name, n) => ({
    name,
    up: natureStatTable[n]!.indexOf(1) + 1,
    down: natureStatTable[n]!.indexOf(-1) + 1,
  }));

  const typeNames = fixedStrings('gTypeNames', 7);

  // ---- EXP, TM compatibility, learnsets, map names ---------------------------------------------------------
  const expSym = elf.symbol('gExperienceTables');
  const levels = constant('MAX_LEVEL') + 1;
  const expTables = Array.from({ length: expSym.size / (levels * 4) }, (_, g) =>
    Array.from({ length: levels }, (_, l) => elf.u32(expSym.value + (g * levels + l) * 4)),
  );

  const tmhmSym = elf.symbol('gTMHMLearnsets');
  const tmhmLearnsets = species.map((_, id) => {
    const lo = elf.u32(tmhmSym.value + id * 8);
    const hi = elf.u32(tmhmSym.value + id * 8 + 4);
    return tmhmMoves.map((_, i) => i).filter((i) => (i < 32 ? (lo >>> i) & 1 : (hi >>> (i - 32)) & 1));
  });

  const readLearnsets = (symbol: string) =>
    ptrTable(symbol).slice(0, NUM_SPECIES).map((ptr) => {
      const list: [number, number][] = [];
      for (let i = 0; i < 64 && ptr; i++) {
        const entry = elf.u16(ptr + i * 2);
        if (entry === 0xffff) break;
        list.push([entry >> 9, entry & 0x1ff]);
      }
      return list;
    });

  const mapSym = elf.symbol('gRegionMapEntries');
  const mapsecs = Array.from({ length: mapSym.size / 8 }, (_, i) => {
    const ptr = elf.u32(mapSym.value + i * 8 + 4);
    return ptr ? textAt(ptr) : '';
  });

  // ---- Sprites ---------------------------------------------------------------------------------------------
  fs.mkdirSync(SPRITE_DIR, { recursive: true });
  const iconPalettes = Array.from({ length: elf.symbol('gMonIconPaletteTable').size / 8 }, (_, i) =>
    decodePalette(elf.read(elf.u32(elf.symbol('gMonIconPaletteTable').value + i * 8), 32)),
  );
  const iconPalIdx = elf.readSymbol('gMonIconPaletteIndices');
  const icons = new Atlas(32, 32, iconTable.length);
  iconTable.forEach((ptr, i) => {
    if (!ptr) return;
    const pal = iconPalettes[iconPalIdx[i] ?? 0]!;
    icons.put(i, decode4bpp(elf.read(ptr, 32 * 32 / 2), 32, 32, pal), 32, 32);
  });

  const frontSym = elf.symbol('gMonFrontPicTable');
  const palSym = elf.symbol('gMonPaletteTable');
  const shinySym = elf.symbol('gMonShinyPaletteTable');
  const frontCount = frontSym.size / 8;
  const front = new Atlas(64, 32, frontCount);
  const frontShiny = new Atlas(64, 32, frontCount);
  const lz = (ptr: number) => lz77Decompress(elf.readAvailable(ptr, 0x10000));
  for (let i = 0; i < frontCount; i++) {
    const picPtr = elf.u32(frontSym.value + i * 8);
    const palPtr = elf.u32(palSym.value + i * 8);
    const shinyPtr = elf.u32(shinySym.value + i * 8);
    if (!picPtr || !palPtr) continue;
    const tiles = lz(picPtr).subarray(0, 64 * 64 / 2);
    front.put(i, decode4bpp(tiles, 64, 64, decodePalette(lz(palPtr))), 64, 64);
    if (shinyPtr) frontShiny.put(i, decode4bpp(tiles, 64, 64, decodePalette(lz(shinyPtr))), 64, 64);
  }

  const itemIconSym = elf.symbol('gItemIconTable');
  const itemIconCount = itemIconSym.size / 8;
  const itemAtlas = new Atlas(24, 32, itemIconCount);
  for (let i = 0; i < itemIconCount; i++) {
    const gfx = elf.u32(itemIconSym.value + i * 8);
    const pal = elf.u32(itemIconSym.value + i * 8 + 4);
    if (!gfx || !pal) continue;
    itemAtlas.put(i, decode4bpp(lz(gfx).subarray(0, 24 * 24 / 2), 24, 24, decodePalette(lz(pal))), 24, 24);
  }

  const writeAtlas = (name: string, a: Atlas) => {
    fs.writeFileSync(path.join(SPRITE_DIR, name), encodePng(a.pixels, a.width, a.height));
    return { file: `sprites/${name}`, cell: a.cell, columns: a.columns };
  };

  // ---- Verification against a release ROM ------------------------------------------------------------------
  const verifiedTables: string[] = [];
  if (verifyRomPath) {
    const rom = new Uint8Array(fs.readFileSync(verifyRomPath));
    const romBuf = Buffer.from(rom.buffer, rom.byteOffset, rom.byteLength);
    const tables = ['gSpeciesInfo', 'gSpeciesNames', 'gBattleMoves', 'gMoveNames', 'gItems', 'gItems2',
      'gAbilityNames', 'gExperienceTables', 'gNatureStatTable', 'sTMHMMoves', 'gTMHMLearnsets', 'gTypeNames'];
    const failed: string[] = [];
    for (const t of tables) {
      // Item tables contain pointers (descriptions/functions) that differ between builds; compare names only.
      const bytes = t === 'gItems' || t === 'gItems2' ? null : elf.readSymbol(t);
      if (bytes === null) {
        const raw = elf.readSymbol(t);
        const ok = items.every((it, id) => {
          const v = new StructView('Item', raw, id * itemSize);
          return romBuf.indexOf(Buffer.from(v.bytes().subarray(0, v.def.fields['description']!.offset))) >= 0;
        });
        (ok ? verifiedTables : failed).push(t);
        continue;
      }
      (romBuf.indexOf(Buffer.from(bytes)) >= 0 ? verifiedTables : failed).push(t);
    }
    console.log(`Verified against ${path.basename(verifyRomPath)}: ${verifiedTables.length}/${tables.length} tables match`);
    if (failed.length) throw new Error(`Tables not found in ${verifyRomPath}: ${failed.join(', ')}`);
  }

  const game: GameData = {
    meta: {
      generator: 'tools/gen-data.ts',
      elf: path.basename(HACK_ELF),
      verifiedRom: verifyRomPath ? path.basename(verifyRomPath) : null,
      verifiedTables,
    },
    constants: { MAX_MONEY: readMaxMoney() },
    charmap,
    species,
    moves,
    items,
    abilities,
    natures,
    types: typeNames,
    expTables,
    natureStatTable,
    tmhmMoves,
    tmhmLearnsets,
    learnsets: { modern: readLearnsets('gLevelUpLearnsets'), original: readLearnsets('gLevelUpLearnsets_Original') },
    mapsecs,
    atlases: {
      icons: writeAtlas('icons.png', icons),
      front: writeAtlas('front.png', front),
      frontShiny: writeAtlas('front-shiny.png', frontShiny),
      items: writeAtlas('items.png', itemAtlas),
    },
  };
  fs.writeFileSync(path.join(DATA_DIR, 'game.json'), JSON.stringify(game) + '\n');
  console.log(`game.json: ${species.length} species, ${moves.length} moves, ${items.length} items, `
    + `${abilities.length} abilities, ${natures.length} natures, ${typeNames.length} types, ${mapsecs.length} map sections`);
}

main();
