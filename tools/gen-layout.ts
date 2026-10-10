// Generates src/data/layout.json: exact offsets, sizes and bitfield positions of every save structure
// the editor touches, plus the constants it relies on.
//
// How: we emit a C file that includes the hack's own headers, compile it with the same ARM compiler and
// flags as the game build (inside Docker), then read the results back out of the object file.
//   - plain fields:  offsetof/sizeof stored as u32 pairs
//   - bitfields:     a struct instance with only that field set to all-ones; the set bits reveal its position
//   - constants:     stored as u32 values
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, DATA_DIR, HACK_ROOT } from './lib/config.ts';
import { runInToolchain } from './lib/docker.ts';
import type { Layout, LayoutField, StructLayout } from '../src/core/layout/types.ts';

type FieldSpec = { path: string; kind: 'range' | 'bits'; name?: string };
const range = (p: string, name?: string): FieldSpec => ({ path: p, kind: 'range', name });
const bits = (p: string, name?: string): FieldSpec => ({ path: p, kind: 'bits', name });

const TX_FIELDS = [
  'tx_Random_Chaos', 'tx_Random_WildPokemon', 'tx_Random_Similar', 'tx_Random_MapBased',
  'tx_Random_IncludeLegendaries', 'tx_Random_Type', 'tx_Random_TypeEffectiveness', 'tx_Random_Abilities',
  'tx_Random_Moves', 'tx_Random_Trainer', 'tx_Random_Evolutions', 'tx_Random_EvolutionMethods',
  'tx_Random_Items', 'tx_Random_Static', 'tx_Random_Starter',
  'tx_Challenges_EvoLimit', 'tx_Challenges_Nuzlocke', 'tx_Challenges_NuzlockeHardcore',
  'tx_Challenges_OneTypeChallenge', 'tx_Challenges_PartyLimit', 'tx_Challenges_NoItemPlayer',
  'tx_Challenges_NoItemTrainer', 'tx_Challenges_PkmnCenter', 'tx_Challenges_LessEscapes',
  'tx_Challenges_BaseStatEqualizer', 'tx_Challenges_LevelCap', 'tx_Challenges_ExpMultiplier',
  'tx_Challenges_Mirror', 'tx_Challenges_Mirror_Thief', 'tx_Challenges_NoEVs',
  'tx_Challenges_TrainerScalingIVs', 'tx_Challenges_TrainerScalingEVs', 'tx_Challenges_MaxPartyIVs',
  'tx_Challenges_PCHeal', 'tx_Challenges_Expensive',
  'tx_Nuzlocke_SpeciesClause', 'tx_Nuzlocke_ShinyClause', 'tx_Nuzlocke_Nicknaming', 'tx_Nuzlocke_Deletion',
  'tx_Nuzlocke_EasyMode', 'tx_Nuzlocke_RareCandy',
  'tx_Mode_InfiniteTMs', 'tx_Mode_PoisonSurvive', 'tx_Mode_AlternateSpawns', 'tx_Mode_Synchronize',
  'tx_Mode_Mints', 'tx_Mode_New_Citrus', 'tx_Mode_Modern_Types', 'tx_Mode_Fairy_Types', 'tx_Mode_New_Stats',
  'tx_Mode_Sturdy', 'tx_Mode_Modern_Moves', 'tx_Mode_Legendary_Abilities', 'tx_Mode_New_Legendaries',
  'tx_Features_ShinyColors', 'tx_Features_RTCType', 'tx_Features_LimitDifficulty', 'tx_Features_ShinyChance',
  'tx_Features_WildMonDropItems', 'tx_Features_FrontierBans',
  'tx_Difficulty_EscapeRopeDig',
];

const STRUCTS: Record<string, FieldSpec[]> = {
  SaveBlock2: [
    range('playerName'), bits('playerGender'), range('playerTrainerId'),
    bits('playTimeHours'), bits('playTimeMinutes'), bits('playTimeSeconds'),
    bits('pokedex.nationalMagic', 'pokedexNationalMagic'), range('pokedex.owned', 'pokedexOwned'),
    range('pokedex.seen', 'pokedexSeen'), bits('pokedex.unownPersonality', 'pokedexUnownPersonality'),
    bits('pokedex.spindaPersonality', 'pokedexSpindaPersonality'),
    bits('encryptionKey'), bits('frontier.battlePoints', 'battlePoints'),
  ],
  SaveBlock1: [
    bits('playerPartyCount'), range('playerParty'), bits('money'), bits('coins'), bits('registeredItem'),
    range('pcItems'), range('bagPocket_Items'), range('bagPocket_KeyItems'), range('bagPocket_PokeBalls'),
    range('bagPocket_TMHM'), range('bagPocket_Berries'), range('seen1'), range('seen2'),
    range('flags'), range('vars'),
    ...TX_FIELDS.map((f) => bits(f)),
  ],
  PokemonStorage: [bits('currentBox'), range('boxes'), range('boxNames'), range('boxWallpapers')],
  BoxPokemon: [
    bits('personality'), bits('otId'), range('nickname'), bits('language'), bits('isBadEgg'),
    bits('hasSpecies'), bits('isEgg'), bits('blockBoxRS'), bits('unused'), bits('inPC'), range('otName'),
    bits('markings'), bits('checksum'), bits('unknown'), range('secure'),
  ],
  Pokemon: [
    range('box'), bits('status'), bits('level'), bits('mail'), bits('hp'), bits('maxHP'), bits('attack'),
    bits('defense'), bits('speed'), bits('spAttack'), bits('spDefense'),
  ],
  PokemonSubstruct0: [
    bits('species'), bits('heldItem'), bits('experience'), bits('ppBonuses'), bits('friendship'),
    bits('hiddenNature'), bits('box_ailment'), bits('box_hp'),
  ],
  PokemonSubstruct1: [range('moves'), range('pp')],
  PokemonSubstruct2: [
    bits('hpEV'), bits('attackEV'), bits('defenseEV'), bits('speedEV'), bits('spAttackEV'), bits('spDefenseEV'),
    bits('cool'), bits('beauty'), bits('cute'), bits('smart'), bits('tough'), bits('sheen'),
  ],
  PokemonSubstruct3: [
    bits('pokerus'), bits('metLocation'), bits('metLevel'), bits('metGame'), bits('pokeball'), bits('otGender'),
    bits('hpIV'), bits('attackIV'), bits('defenseIV'), bits('speedIV'), bits('spAttackIV'), bits('spDefenseIV'),
    bits('isEgg'), bits('abilityNum'), bits('coolRibbon'), bits('beautyRibbon'), bits('cuteRibbon'),
    bits('smartRibbon'), bits('toughRibbon'), bits('championRibbon'), bits('winningRibbon'), bits('victoryRibbon'),
    bits('artistRibbon'), bits('effortRibbon'), bits('marineRibbon'), bits('landRibbon'), bits('skyRibbon'),
    bits('countryRibbon'), bits('nationalRibbon'), bits('earthRibbon'), bits('worldRibbon'),
    bits('unusedRibbons'), bits('nuzlockeRibbon'), bits('modernFatefulEncounter'),
  ],
  ItemSlot: [bits('itemId'), bits('quantity')],
  // ROM data tables (read from the ELF by gen-data)
  SpeciesInfo: [
    bits('baseHP'), bits('baseAttack'), bits('baseDefense'), bits('baseSpeed'), bits('baseSpAttack'),
    bits('baseSpDefense'), range('types'), bits('catchRate'), bits('expYield'), bits('itemCommon'),
    bits('itemRare'), bits('genderRatio'), bits('eggCycles'), bits('friendship'), bits('growthRate'),
    range('eggGroups'), range('abilities'), bits('safariZoneFleeRate'), bits('bodyColor'), bits('noFlip'),
    bits('baseHP_old'), bits('baseAttack_old'), bits('baseDefense_old'), bits('baseSpeed_old'),
    bits('baseSpAttack_old'), bits('baseSpDefense_old'), range('types_old'), range('abilities_old'),
    range('types_new'), bits('catchRate_hard'),
  ],
  BattleMove: [
    bits('effect'), bits('power'), bits('type'), bits('accuracy'), bits('pp'), bits('secondaryEffectChance'),
    bits('target'), bits('priority'), bits('flags'), bits('category'),
  ],
  Item: [
    range('name'), bits('itemId'), bits('price'), bits('holdEffect'), bits('holdEffectParam'),
    range('description'), bits('importance'), bits('pocket'), bits('type'), bits('battleUsage'), bits('secondaryId'),
  ],
};

const CONSTANTS = [
  'NUM_SPECIES', 'NATIONAL_DEX_COUNT', 'NUM_DEX_FLAG_BYTES', 'SPECIES_EGG', 'SPECIES_UNOWN', 'SPECIES_SHEDINJA',
  'MOVES_COUNT', 'ITEMS_COUNT', 'ABILITIES_COUNT', 'NUMBER_OF_MON_TYPES',
  'NUM_NATURES', 'HIDDEN_NATURE_NONE', 'MAX_LEVEL', 'MAX_MON_MOVES', 'PARTY_SIZE', 'NUM_STATS',
  'TOTAL_BOXES_COUNT', 'IN_BOX_COUNT', 'BOX_NAME_LENGTH', 'POKEMON_NAME_LENGTH', 'PLAYER_NAME_LENGTH',
  'MOVE_NAME_LENGTH', 'ITEM_NAME_LENGTH', 'ABILITY_NAME_LENGTH', 'TRAINER_ID_LENGTH',
  'PC_ITEMS_COUNT', 'BAG_ITEMS_COUNT', 'BAG_KEYITEMS_COUNT', 'BAG_POKEBALLS_COUNT', 'BAG_TMHM_COUNT',
  'BAG_BERRIES_COUNT', 'MAX_BAG_ITEM_CAPACITY', 'MAX_PC_ITEM_CAPACITY', 'MAX_BERRY_CAPACITY',
  'MAX_COINS', 'MAX_BATTLE_FRONTIER_POINTS', 'MAX_PER_STAT_EVS', 'MAX_TOTAL_EVS', 'MAX_IV_MASK',
  'MAX_FRIENDSHIP', 'SHINY_ODDS',
  'SECTOR_DATA_SIZE', 'SECTOR_SIZE', 'SECTOR_SIGNATURE', 'NUM_SECTORS_PER_SLOT', 'NUM_SAVE_SLOTS', 'SECTORS_COUNT',
  'POCKET_ITEMS', 'POCKET_POKE_BALLS', 'POCKET_TM_HM', 'POCKET_BERRIES', 'POCKET_KEY_ITEMS',
  'ITEM_NONE', 'ITEM_TM01', 'ITEM_HM01', 'NUM_TECHNICAL_MACHINES', 'NUM_HIDDEN_MACHINES',
  'ITEM_POKE_BALL', 'ITEM_MASTER_BALL', 'ITEM_RARE_CANDY', 'ITEM_HEART_SCALE',
  'MON_MALE', 'MON_FEMALE', 'MON_GENDERLESS', 'FLAG_FINITE_TMS', 'FLAG_LIMIT_TO_50', 'FLAGS_COUNT', 'VARS_START',
  'VERSION_EMERALD', 'GAME_LANGUAGE', 'LANGUAGE_ENGLISH', 'MAIL_NONE', 'POKEDEX_NATIONAL_MAGIC',
  'STAT_HP', 'STAT_ATK', 'STAT_DEF', 'STAT_SPEED', 'STAT_SPATK', 'STAT_SPDEF',
  'GROWTH_MEDIUM_FAST', 'ABILITY_NONE', 'MOVE_NONE', 'TYPE_MYSTERY',
];

// Constants that might not exist in this source tree; emitted only if defined.
const OPTIONAL_CONSTANTS = new Set(['POKEDEX_NATIONAL_MAGIC', 'GAME_LANGUAGE', 'TYPE_MYSTERY', 'ITEM_HEART_SCALE']);

const HEADERS = [
  'global.h', 'pokemon.h', 'pokemon_storage_system.h', 'item.h', 'save.h', 'pokedex.h',
  'constants/items.h', 'constants/species.h', 'constants/moves.h', 'constants/abilities.h',
  'constants/pokemon.h', 'constants/flags.h', 'constants/vars.h', 'constants/global.h', 'constants/item.h',
  'constants/battle_frontier.h', 'constants/coins.h', 'constants/pokedex.h',
];

interface ProbeEntry { sym: string; struct: string; spec: FieldSpec }

function buildProbeSource(entries: ProbeEntry[]): string {
  const lines: string[] = [
    '// Generated by save-editor/tools/gen-layout.ts. Do not edit.',
    ...HEADERS.map((h) => `#include "${h}"`),
    '#define PROBE __attribute__((section(".probe"), used))',
    '#define OFFSIZE(S, F) { offsetof(struct S, F), sizeof(((struct S *)0)->F) }',
  ];
  for (const s of Object.keys(STRUCTS)) lines.push(`PROBE const u32 size_${s} = sizeof(struct ${s});`);
  for (const e of entries) {
    if (e.spec.kind === 'range') {
      lines.push(`PROBE const u32 ${e.sym}[2] = OFFSIZE(${e.struct}, ${e.spec.path});`);
    } else {
      lines.push(`PROBE const struct ${e.struct} ${e.sym} = { .${e.spec.path} = ~0 };`);
    }
  }
  for (const c of CONSTANTS) {
    const line = `PROBE const u32 const_${c} = ${c};`;
    lines.push(OPTIONAL_CONSTANTS.has(c) ? `#ifdef ${c}\n${line}\n#endif` : line);
  }
  return lines.join('\n') + '\n';
}

function parseNm(output: string): Map<string, { addr: number; size: number }> {
  const out = new Map<string, { addr: number; size: number }>();
  for (const line of output.split('\n')) {
    const m = /^([0-9a-f]+) ([0-9a-f]+) \w (\S+)$/.exec(line.trim());
    if (m) out.set(m[3]!, { addr: parseInt(m[1]!, 16), size: parseInt(m[2]!, 16) });
  }
  return out;
}

function findBits(bytes: Uint8Array, label: string): LayoutField {
  const set: number[] = [];
  bytes.forEach((b, i) => {
    for (let bit = 0; bit < 8; bit++) if (b & (1 << bit)) set.push(i * 8 + bit);
  });
  if (set.length === 0) throw new Error(`Bitfield probe for ${label} produced no set bits`);
  const first = set[0]!;
  const last = set[set.length - 1]!;
  if (last - first + 1 !== set.length) throw new Error(`Bitfield probe for ${label} is not contiguous`);
  return { offset: Math.floor(first / 8), bit: first % 8, bits: set.length };
}

function main() {
  const entries: ProbeEntry[] = [];
  for (const [struct, specs] of Object.entries(STRUCTS)) {
    specs.forEach((spec, i) => entries.push({ sym: `f_${struct}_${i}`, struct, spec }));
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, 'layout_probe.c'), buildProbeSource(entries));

  const flags = '-mthumb -mthumb-interwork -O2 -mabi=apcs-gnu -mtune=arm7tdmi -march=armv4t '
    + '-iquote include -iquote gflib -Wno-trigraphs -DMODERN=1 -w';
  const nm = runInToolchain(
    `arm-none-eabi-gcc ${flags} -c /cache/layout_probe.c -o /cache/layout_probe.o && `
    + `arm-none-eabi-objcopy -O binary --only-section=.probe /cache/layout_probe.o /cache/layout_probe.bin && `
    + `arm-none-eabi-nm -S /cache/layout_probe.o`,
  );
  const symbols = parseNm(nm);
  const blob = new Uint8Array(fs.readFileSync(path.join(CACHE_DIR, 'layout_probe.bin')));
  const view = new DataView(blob.buffer);
  const u32At = (sym: string, index = 0): number => {
    const s = symbols.get(sym);
    if (!s) throw new Error(`Missing probe symbol ${sym}`);
    return view.getUint32(s.addr + index * 4, true);
  };

  const structs: Record<string, StructLayout> = {};
  for (const struct of Object.keys(STRUCTS)) structs[struct] = { size: u32At(`size_${struct}`), fields: {} };
  for (const e of entries) {
    const name = e.spec.name ?? e.spec.path;
    const target = structs[e.struct]!;
    if (e.spec.kind === 'range') {
      target.fields[name] = { offset: u32At(e.sym, 0), size: u32At(e.sym, 1) };
    } else {
      const s = symbols.get(e.sym);
      if (!s) throw new Error(`Missing probe symbol ${e.sym}`);
      target.fields[name] = findBits(blob.subarray(s.addr, s.addr + s.size), `${e.struct}.${e.spec.path}`);
    }
  }

  const constants: Record<string, number> = {};
  for (const c of CONSTANTS) if (symbols.has(`const_${c}`)) constants[c] = u32At(`const_${c}`);
  const missing = CONSTANTS.filter((c) => !(c in constants) && !OPTIONAL_CONSTANTS.has(c));
  if (missing.length) throw new Error(`Constants not defined as macros in the hack source: ${missing.join(', ')}`);

  const layout: Layout = {
    generator: 'tools/gen-layout.ts',
    source: path.basename(HACK_ROOT),
    constants,
    structs,
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'layout.json'), JSON.stringify(layout, null, 2) + '\n');
  console.log(`layout.json: ${Object.keys(structs).length} structs, ${entries.length} fields, `
    + `${Object.keys(constants).length} constants`);
  for (const [name, s] of Object.entries(structs)) console.log(`  ${name.padEnd(18)} size ${s.size}`);
}

main();
