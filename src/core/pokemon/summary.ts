// Read-only, display-friendly view of a Pokémon (used by the UI and by the change list).
import { game } from '../gamedata/index.ts';
import type { SaveSettings } from '../save/settings.ts';
import type { BoxMon, PartyMon } from './boxmon.ts';
import { abilityOf, calculateStats, effectiveNature, gender, type Gender, HIDDEN_NATURE_NONE, isShiny, levelFromExp, maxPP } from './rules.ts';
import { nickname } from './edit.ts';

export interface MonSummary {
  species: number;
  speciesName: string;
  nickname: string;
  level: number;
  exp: number;
  nature: number;
  /** True when the nature comes from the hidden-nature field (Mint) rather than the PID. */
  natureFromMint: boolean;
  abilityNum: number;
  /** Ability id, or null when abilities are randomized by the save's settings. */
  ability: number | null;
  gender: Gender;
  shiny: boolean;
  heldItem: number;
  moves: number[];
  pp: number[];
  ppUps: number[];
  maxPP: number[];
  ivs: number[];
  evs: number[];
  friendship: number;
  ball: number;
  isEgg: boolean;
  isBadEgg: boolean;
  /** Stats: stored values for party Pokémon, calculated for boxed ones. */
  stats: number[];
  hp: number | null;
  status: number | null;
  metLocation: number;
  metLevel: number;
  otId: number;
}

export function summarize(mon: BoxMon, settings: SaveSettings, party?: PartyMon): MonSummary {
  const exp = mon.sub0.get('experience');
  const nature = effectiveNature(mon);
  const moves = mon.moves;
  const ppUps = mon.ppUps;
  const stats = party
    ? party.stats
    : mon.species && game.species[mon.species]
      ? calculateStats({ species: mon.species, exp, ivs: mon.ivs, evs: mon.evs, nature }, settings).stats
      : [0, 0, 0, 0, 0, 0];
  return {
    species: mon.species,
    speciesName: game.species[mon.species]?.name ?? `#${mon.species}`,
    nickname: nickname(mon),
    level: party ? party.level : levelFromExp(mon.species, exp),
    exp,
    nature,
    natureFromMint: mon.sub0.get('hiddenNature') !== HIDDEN_NATURE_NONE,
    abilityNum: mon.sub3.get('abilityNum'),
    ability: abilityOf(mon.species, mon.sub3.get('abilityNum'), settings),
    gender: gender(mon.species, mon.personality),
    shiny: isShiny(mon.otId, mon.personality, settings),
    heldItem: mon.sub0.get('heldItem'),
    moves,
    pp: mon.pp,
    ppUps,
    maxPP: moves.map((m, i) => (m ? maxPP(m, ppUps[i]!) : 0)),
    ivs: mon.ivs,
    evs: mon.evs,
    friendship: mon.sub0.get('friendship'),
    ball: mon.sub3.get('pokeball'),
    isEgg: mon.isEgg,
    isBadEgg: mon.isBadEgg,
    stats,
    hp: party ? party.hp : null,
    status: party ? party.status : null,
    metLocation: mon.sub3.get('metLocation'),
    metLevel: mon.sub3.get('metLevel'),
    otId: mon.otId,
  };
}

/** Human-readable differences between two summaries of the same slot. */
export function describeMonChanges(before: MonSummary, after: MonSummary): string[] {
  const out: string[] = [];
  const name = (s: MonSummary) => s.speciesName;
  const list = (ids: number[], table: { name: string }[]) => ids.filter(Boolean).map((i) => table[i]?.name ?? `#${i}`).join(', ') || '—';
  if (before.species !== after.species) out.push(`species ${name(before)} → ${name(after)}`);
  if (before.nickname !== after.nickname) out.push(`nickname "${before.nickname}" → "${after.nickname}"`);
  if (before.level !== after.level) out.push(`level ${before.level} → ${after.level}`);
  else if (before.exp !== after.exp) out.push(`EXP ${before.exp} → ${after.exp}`);
  if (before.nature !== after.nature) out.push(`nature ${game.natures[before.nature]?.name} → ${game.natures[after.nature]?.name}`);
  if (before.abilityNum !== after.abilityNum) out.push(`ability slot ${before.abilityNum + 1} → ${after.abilityNum + 1}`);
  if (before.shiny !== after.shiny) out.push(after.shiny ? 'made shiny' : 'made non-shiny');
  if (before.heldItem !== after.heldItem) out.push(`held item ${game.items[before.heldItem]?.name ?? '—'} → ${game.items[after.heldItem]?.name ?? '—'}`.replace(/NONE|\?\?\?\?\?\?\?\?/g, '—'));
  if (before.moves.join() !== after.moves.join()) out.push(`moves ${list(before.moves, game.moves)} → ${list(after.moves, game.moves)}`);
  else if (before.ppUps.join() !== after.ppUps.join()) out.push('PP Ups changed');
  else if (before.pp.join() !== after.pp.join()) out.push('PP restored');
  if (before.ivs.join() !== after.ivs.join()) out.push(`IVs ${before.ivs.join('/')} → ${after.ivs.join('/')}`);
  if (before.evs.join() !== after.evs.join()) out.push(`EVs ${before.evs.join('/')} → ${after.evs.join('/')}`);
  if (before.friendship !== after.friendship) out.push(`friendship ${before.friendship} → ${after.friendship}`);
  if (before.ball !== after.ball) out.push(`ball ${game.items[before.ball]?.name} → ${game.items[after.ball]?.name}`);
  if (before.hp !== after.hp || before.status !== after.status) {
    if (after.hp !== null && after.hp === after.stats[0] && !after.status) out.push('healed');
    else if (before.hp !== after.hp) out.push(`HP ${before.hp} → ${after.hp}`);
  }
  if (!out.length && before.stats.join() !== after.stats.join()) out.push('stats recalculated');
  return out;
}
