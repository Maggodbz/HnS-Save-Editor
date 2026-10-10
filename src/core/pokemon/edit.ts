// Editing operations on Pokémon. Each keeps the record consistent the way the game would
// (species ↔ hasSpecies, level ↔ EXP, move ↔ PP, party stats recalculated, …).
import { constant } from '../layout/index.ts';
import { charset, game } from '../gamedata/index.ts';
import type { SaveSettings } from '../save/settings.ts';
import type { TrainerInfo } from '../save/trainer.ts';
import { BOX_MON_SIZE, BoxMon, PARTY_MON_SIZE, PartyMon } from './boxmon.ts';
import {
  adjustCurrentHP, calculateStats, effectiveNature, expForLevel, HIDDEN_NATURE_NONE, levelFromExp, MAX_LEVEL,
  maxPP, natureFromPersonality, rerollPersonalityForShiny,
} from './rules.ts';

const NAME_LEN = constant('POKEMON_NAME_LENGTH');
export const MAX_EV = constant('MAX_PER_STAT_EVS');
export const MAX_TOTAL_EV = constant('MAX_TOTAL_EVS');
export const MAIL_NONE = 0xff;
export const METLOC_FATEFUL_ENCOUNTER = 0xff;

export function level(mon: BoxMon): number {
  return levelFromExp(mon.species, mon.sub0.get('experience'));
}

export function nickname(mon: BoxMon): string {
  return charset.decode(mon.header.range('nickname'));
}

/** The species' default name as the game stores it in a fresh Pokémon's nickname. */
export function defaultNickname(speciesId: number): string {
  return game.species[speciesId]?.name ?? '';
}

export function setNickname(mon: BoxMon, text: string): void {
  if (!text.trim()) throw new Error('Nickname cannot be empty');
  mon.header.range('nickname').set(charset.encode(text, NAME_LEN));
}

export function setLevel(mon: BoxMon, lvl: number): void {
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > MAX_LEVEL) throw new RangeError(`Level must be 1-${MAX_LEVEL}`);
  if (level(mon) === lvl) return;
  mon.sub0.set('experience', expForLevel(mon.species, lvl));
}

/** Changes species, keeping the level; renames if the nickname was the old species name. */
export function setSpecies(mon: BoxMon, speciesId: number): void {
  const sp = game.species[speciesId];
  if (!sp || sp.unused) throw new Error('Invalid species');
  const oldLevel = level(mon);
  const wasDefaultName = nickname(mon) === defaultNickname(mon.species);
  mon.species = speciesId;
  mon.sub0.set('experience', expForLevel(speciesId, oldLevel));
  if (wasDefaultName) setNickname(mon, defaultNickname(speciesId));
  if (mon.sub3.get('abilityNum') === 1 && sp.abilities[1] === 0) mon.sub3.set('abilityNum', 0);
}

/** Sets the nature via the hidden-nature field (like a Mint); clears it when it equals the PID nature. */
export function setNature(mon: BoxMon, nature: number): void {
  if (!Number.isInteger(nature) || nature < 0 || nature >= game.natures.length) throw new RangeError('Invalid nature');
  mon.sub0.set('hiddenNature', nature === natureFromPersonality(mon.personality) ? HIDDEN_NATURE_NONE : nature);
}

/** Makes the Pokémon shiny / not shiny. Gender and effective nature are preserved. */
export function setShiny(mon: BoxMon, shiny: boolean, settings: SaveSettings): void {
  const nature = effectiveNature(mon);
  const { personality } = rerollPersonalityForShiny(mon.otId, mon.personality, shiny, settings);
  mon.personality = personality;
  setNature(mon, nature);
}

export function setMove(mon: BoxMon, slot: number, moveId: number): void {
  if (moveId !== 0 && !game.moves[moveId]) throw new Error('Invalid move');
  if (moveId !== 0 && mon.moves.some((m, i) => m === moveId && i !== slot)) throw new Error('Move already known');
  mon.setMove(slot, moveId);
  if (moveId === 0) mon.setPPUps(slot, 0);
  mon.setPP(slot, moveId === 0 ? 0 : maxPP(moveId, mon.ppUps[slot]!));
}

export function setPPUps(mon: BoxMon, slot: number, ups: number): void {
  mon.setPPUps(slot, ups);
  const move = mon.moves[slot]!;
  mon.setPP(slot, move ? maxPP(move, ups) : 0);
}

/** Moves stored first-to-last without gaps (the game expects moves packed from slot 1). */
export function compactMoves(mon: BoxMon): void {
  const entries = [0, 1, 2, 3].map((i) => ({ move: mon.moves[i]!, pp: mon.pp[i]!, ups: mon.ppUps[i]! })).filter((e) => e.move);
  for (let i = 0; i < 4; i++) {
    const e = entries[i];
    mon.setMove(i, e?.move ?? 0);
    mon.setPP(i, e?.pp ?? 0);
    mon.setPPUps(i, e?.ups ?? 0);
  }
}

export function restorePP(mon: BoxMon): void {
  mon.moves.forEach((m, i) => mon.setPP(i, m ? maxPP(m, mon.ppUps[i]!) : 0));
}

/** CalculateMonStats for a party Pokémon after any edit (keeps current HP relative, like the game). */
export function recalcPartyStats(p: PartyMon, settings: SaveSettings): void {
  const m = p.box;
  const result = calculateStats(
    { species: m.species, exp: m.sub0.get('experience'), ivs: m.ivs, evs: m.evs, nature: effectiveNature(m) },
    settings,
  );
  const oldMax = p.maxHP;
  const hp = adjustCurrentHP(m.species, p.hp, oldMax, result.stats[0]!);
  p.level = result.level;
  p.setStats(result.stats);
  p.hp = Math.min(hp, result.stats[0]!);
}

export function healParty(p: PartyMon): void {
  p.hp = p.maxHP;
  p.status = 0;
  restorePP(p.box);
}

export interface NewMonOptions {
  species: number;
  level: number;
  nature?: number;
  shiny?: boolean;
  gender?: 'male' | 'female';
  abilityNum?: 0 | 1;
  ivs?: number[];
  ball?: number;
  random?: () => number;
}

/** Initial moveset as GiveBoxMonInitialMoveset: level-up moves up to the level, last four kept. */
export function initialMoves(speciesId: number, lvl: number, settings: SaveSettings): number[] {
  const learnset = (settings.modernMoves ? game.learnsets.modern : game.learnsets.original)[speciesId] ?? [];
  const moves: number[] = [];
  for (const [moveLevel, move] of learnset) {
    if (moveLevel > lvl) break;
    if (moves.includes(move)) continue;
    if (moves.length === 4) moves.shift();
    moves.push(move);
  }
  return moves;
}

/**
 * Creates a Pokémon caught by the player (CreateBoxMon with OT = player), as a BoxMon.
 * Met location is "fateful encounter" so editor-made Pokémon are recognisable.
 */
export function createMon(opts: NewMonOptions, trainer: TrainerInfo, playerNameBytes: Uint8Array, settings: SaveSettings): BoxMon {
  const sp = game.species[opts.species];
  if (!sp || sp.unused) throw new Error('Invalid species');
  if (!Number.isInteger(opts.level) || opts.level < 1 || opts.level > MAX_LEVEL) throw new RangeError('Invalid level');
  const rand = opts.random ?? Math.random;
  const rand32 = () => Math.floor(rand() * 0x100000000) >>> 0;

  // Personality: honour requested gender (low byte vs gender ratio); shininess handled after.
  let personality = rand32();
  if (opts.gender && sp.genderRatio > 0 && sp.genderRatio < 254) {
    for (let i = 0; i < 1000; i++) {
      const female = sp.genderRatio > (personality & 0xff);
      if (female === (opts.gender === 'female')) break;
      personality = rand32();
    }
  }

  const mon = BoxMon.empty();
  mon.personality = personality;
  mon.otId = trainer.otId;
  mon.header.range('nickname').set(charset.encode(defaultNickname(opts.species), NAME_LEN));
  mon.header.set('language', constant('GAME_LANGUAGE'));
  mon.header.range('otName').set(playerNameBytes.subarray(0, mon.header.range('otName').length));
  mon.species = opts.species;
  mon.sub0.set('experience', expForLevel(opts.species, opts.level));
  mon.sub0.set('friendship', sp.friendship);
  mon.sub3.set('metLocation', METLOC_FATEFUL_ENCOUNTER);
  mon.sub3.set('metLevel', opts.level);
  mon.sub3.set('metGame', constant('VERSION_EMERALD'));
  mon.sub3.set('pokeball', opts.ball ?? constant('ITEM_POKE_BALL'));
  mon.sub3.set('otGender', trainer.gender === 'male' ? 0 : 1);

  const ivs = opts.ivs ?? Array.from({ length: 6 }, () =>
    settings.maxPartyIVs === 1 ? 31 : settings.maxPartyIVs === 2 ? 30 + Math.floor(rand() * 2) : Math.floor(rand() * 32));
  ivs.forEach((v, i) => mon.setIV(i, v));

  const abilityNum = opts.abilityNum ?? (sp.abilities[1] ? personality & 1 : 0);
  mon.sub3.set('abilityNum', sp.abilities[1] ? abilityNum : 0);
  mon.sub0.set('hiddenNature', HIDDEN_NATURE_NONE);

  initialMoves(opts.species, opts.level, settings).forEach((move, i) => {
    mon.setMove(i, move);
    mon.setPP(i, maxPP(move, 0));
  });

  if (opts.shiny) setShiny(mon, true, settings);
  if (opts.nature !== undefined) setNature(mon, opts.nature);
  return mon;
}

/** BoxMonToMon + CalculateMonStats: a party Pokémon from a box Pokémon (full HP, no status). */
export function toPartyMon(box: BoxMon, settings: SaveSettings): PartyMon {
  const p = new PartyMon(box, new Uint8Array(PARTY_MON_SIZE - BOX_MON_SIZE));
  p.mail = MAIL_NONE;
  recalcPartyStats(p, settings);
  return p;
}
