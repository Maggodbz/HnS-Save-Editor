// Game formulas, ported from src/pokemon.c of Heart & Soul 1.2.1 (CalculateMonStats, GetNature,
// GetBoxMonGender, IsShinyOtIdPersonality, GetAbilityBySpecies, CalculatePPWithBonus, ...).
// Each function names the C function it mirrors; behaviour (including quirks) is kept identical.
import { constant } from '../layout/index.ts';
import { game, speciesIdByName } from '../gamedata/index.ts';
import type { SaveSettings } from '../save/settings.ts';
import type { BoxMon } from './boxmon.ts';

export const HIDDEN_NATURE_NONE = constant('HIDDEN_NATURE_NONE');
export const MAX_LEVEL = constant('MAX_LEVEL');
export const NUM_NATURES = constant('NUM_NATURES');
const SHEDINJA = constant('SPECIES_SHEDINJA');
const MON_MALE = constant('MON_MALE');
const MON_FEMALE = constant('MON_FEMALE');
const MON_GENDERLESS = constant('MON_GENDERLESS');

export type Gender = 'male' | 'female' | 'genderless';

// ---- Level / EXP -------------------------------------------------------------------------------------------

/** GetLevelFromBoxMonExp */
export function levelFromExp(speciesId: number, exp: number): number {
  const table = game.expTables[game.species[speciesId]?.growthRate ?? 0]!;
  let level = 1;
  while (level <= MAX_LEVEL && table[level]! <= exp) level++;
  return level - 1;
}

/** gExperienceTables[growthRate][level]: minimum EXP for a level. */
export function expForLevel(speciesId: number, level: number): number {
  return game.expTables[game.species[speciesId]?.growthRate ?? 0]![level]!;
}

// ---- Nature ------------------------------------------------------------------------------------------------

/** GetNatureFromPersonality */
export function natureFromPersonality(personality: number): number {
  return (personality >>> 0) % NUM_NATURES;
}

/** GetNature(mon, TRUE): the hidden nature (mints) overrides the personality nature. */
export function effectiveNature(mon: BoxMon): number {
  const hidden = mon.sub0.get('hiddenNature');
  return hidden === HIDDEN_NATURE_NONE ? natureFromPersonality(mon.personality) : hidden;
}

/** ModifyStatByNature (BUGFIX build: 32-bit intermediate). statIndex: 1..5 = Atk, Def, Speed, SpAtk, SpDef. */
export function modifyStatByNature(nature: number, stat: number, statIndex: number): number {
  if (statIndex <= 0 || statIndex > 5) return stat;
  const mod = game.natureStatTable[nature]?.[statIndex - 1] ?? 0;
  if (mod === 1) return Math.floor((stat * 110) / 100);
  if (mod === -1) return Math.floor((stat * 90) / 100);
  return stat;
}

// ---- Stats -------------------------------------------------------------------------------------------------

export interface StatInput {
  species: number;
  exp: number;
  ivs: number[];
  evs: number[];
  nature: number;
}

export interface StatResult {
  /** The level the game stores (50 when the "limit to 50" flag is set). */
  level: number;
  /** maxHP, Atk, Def, Speed, SpAtk, SpDef */
  stats: number[];
}

/** CalculateMonStats (stat part). */
export function calculateStats(input: StatInput, settings: SaveSettings): StatResult {
  const sp = game.species[input.species];
  if (!sp) throw new Error(`Unknown species ${input.species}`);
  const base = sp.baseStats;
  const old = sp.baseStatsOld ?? [0, 0, 0, 0, 0, 0];
  const level = settings.limitToLevel50 ? 50 : levelFromExp(input.species, input.exp);
  const ev4 = (i: number) => Math.floor(input.evs[i]! / 4);
  const useOld = (i: number) => old[i] !== 0 && !settings.newStats;
  const eq = settings.baseStatEqualizer;
  const stats: number[] = [];

  // HP
  if (input.species === SHEDINJA) {
    stats.push(1);
  } else {
    const iv = input.ivs[0]!;
    let n = 2 * base[0] + iv;
    let nOld = 2 * old[0] + iv;
    if (eq === 1 || eq === 2) {
      const equal = eq === 1 ? 100 : 255;
      if (useOld(0)) nOld = 2 * equal + iv;
      else n = 2 * equal + iv;
    } else if (eq === 3) {
      n = 2 * 500 + iv; // the game only sets n here, even when the old-stat path is used
    }
    const x = useOld(0) ? nOld : n;
    stats.push(Math.floor(((x + ev4(0)) * level) / 100) + level + 10);
  }

  // Atk, Def, Speed, SpAtk, SpDef (statIndex 1..5 = same order as the arrays)
  for (let i = 1; i < 6; i++) {
    const baseStat = eq ? [100, 255, 500][eq - 1]! : useOld(i) ? old[i]! : base[i]!;
    const raw = Math.floor(((2 * baseStat + input.ivs[i]! + ev4(i)) * level) / 100) + 5;
    stats.push(modifyStatByNature(input.nature, raw, i));
  }
  return { level, stats: stats.map((s) => s & 0xffff) };
}

/** CalculateMonStats (HP part): new current HP after max HP changed from oldMax to newMax. */
export function adjustCurrentHP(speciesId: number, currentHP: number, oldMax: number, newMax: number): number {
  if (speciesId === SHEDINJA) return currentHP !== 0 || oldMax === 0 ? 1 : currentHP;
  if (currentHP === 0 && oldMax === 0) return newMax;
  if (currentHP !== 0) return Math.max(1, currentHP + newMax - oldMax);
  return currentHP; // fainted stays fainted
}

// ---- Gender, shiny, ability, PP ----------------------------------------------------------------------------

/** GetGenderFromSpeciesAndPersonality */
export function gender(speciesId: number, personality: number): Gender {
  const ratio = game.species[speciesId]?.genderRatio ?? MON_GENDERLESS;
  if (ratio === MON_MALE) return 'male';
  if (ratio === MON_FEMALE) return 'female';
  if (ratio === MON_GENDERLESS) return 'genderless';
  return ratio > (personality & 0xff) ? 'female' : 'male';
}

export function shinyValue(otId: number, personality: number): number {
  return ((otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff)) >>> 0;
}

/** Shiny threshold for the save's tx_Features_ShinyChance setting (IsShinyOtIdPersonality). */
export function shinyThreshold(settings: SaveSettings): number {
  return [8, 16, 32, 64, 128][settings.shinyChance] ?? 8;
}

export function isShiny(otId: number, personality: number, settings: SaveSettings): boolean {
  return shinyValue(otId, personality) < shinyThreshold(settings);
}

/**
 * New personality with the requested shininess. Keeps the low 16 bits (gender, most form data) and, when
 * possible, the personality nature; returns null if the nature can't be kept (caller then pins it via the
 * hidden nature field).
 */
export function rerollPersonalityForShiny(
  otId: number,
  personality: number,
  shiny: boolean,
  settings: SaveSettings,
): { personality: number; natureKept: boolean } {
  const low = personality & 0xffff;
  const tsid = (otId >>> 16) ^ (otId & 0xffff);
  const nature = natureFromPersonality(personality);
  const threshold = shinyThreshold(settings);
  const candidates: number[] = [];
  if (shiny) {
    for (let k = 0; k < threshold; k++) candidates.push(tsid ^ low ^ k);
  } else {
    for (let k = 0x8000; k < 0x8000 + 64; k++) candidates.push(tsid ^ low ^ k);
  }
  const make = (high: number) => ((high << 16) | low) >>> 0;
  const keep = candidates.find((h) => natureFromPersonality(make(h)) === nature);
  if (keep !== undefined) return { personality: make(keep), natureKept: true };
  return { personality: make(candidates[0]!), natureKept: false };
}

let legendaryIds: Set<number> | null = null;
let noctowlId = -1;
function legendaries(): Set<number> {
  if (!legendaryIds) {
    legendaryIds = new Set(
      ['ARTICUNO', 'ZAPDOS', 'MOLTRES', 'MEWTWO', 'RAIKOU', 'ENTEI', 'SUICUNE', 'HO-OH', 'LUGIA'].map(speciesIdByName),
    );
    noctowlId = speciesIdByName('NOCTOWL');
  }
  return legendaryIds;
}

/**
 * GetAbilityBySpecies. Returns null when the save randomizes abilities (the result then depends on a
 * seeded shuffle we don't reproduce).
 */
export function abilityOf(speciesId: number, abilityNum: number, settings: SaveSettings): number | null {
  if (settings.randomAbilities) return null;
  const sp = game.species[speciesId];
  if (!sp) return 0;
  if (abilityNum === 0 && legendaries().has(speciesId) && !settings.legendaryAbilities) return sp.abilitiesOld[0];
  if (abilityNum === 1 && speciesId === noctowlId && !settings.modernTypes) return sp.abilitiesOld[1];
  return abilityNum ? sp.abilities[1] : sp.abilities[0];
}

/** CalculatePPWithBonus */
export function maxPP(moveId: number, ppUps: number): number {
  const base = game.moves[moveId]?.pp ?? 0;
  return base + Math.floor((base * 20 * ppUps) / 100);
}
