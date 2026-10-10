// Display formatting for game strings (the game stores names in upper case).
import { game } from '../core/gamedata/index.ts';

const KEEP_UPPER = new Set(['HP', 'PP', 'TM', 'HM', 'GS', 'SS', 'EXP.', 'X', 'BP', 'UV', 'TV', 'HQ']);
const TYPE_NAMES: Record<string, string> = { FIGHT: 'Fighting', ELECTR: 'Electric', PSYCHC: 'Psychic', '???': '???' };

/** "POKé BALL" → "Poké Ball", "TM01" → "TM01", "HP UP" → "HP Up". */
export function pretty(name: string): string {
  return name
    .split(' ')
    .map((w) => {
      if (!w) return w;
      if (KEEP_UPPER.has(w) || /\d/.test(w)) return w;
      return w
        .split('-')
        .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1).toLowerCase() : p))
        .join('-');
    })
    .join(' ');
}

export const speciesName = (id: number) => pretty(game.species[id]?.name ?? `#${id}`);
export const moveName = (id: number) => (id ? pretty(game.moves[id]?.name ?? `#${id}`) : '—');
export const itemName = (id: number) => (id ? pretty(game.items[id]?.name ?? `#${id}`) : 'None');
export const abilityName = (id: number | null) => (id === null ? 'Randomized' : pretty(game.abilities[id]?.name ?? '—'));
export const natureName = (id: number) => pretty(game.natures[id]?.name ?? '?');
export const typeName = (id: number) => {
  const raw = game.types[id] ?? '?';
  return TYPE_NAMES[raw] ?? pretty(raw);
};

export const STAT_LABELS = ['HP', 'Attack', 'Defense', 'Speed', 'Sp. Atk', 'Sp. Def'];
export const STAT_SHORT = ['HP', 'Atk', 'Def', 'Spe', 'SpA', 'SpD'];

export function natureEffect(nature: number): string {
  const n = game.natures[nature];
  if (!n || !n.up) return 'neutral';
  return `+${STAT_SHORT[n.up]} −${STAT_SHORT[n.down]}`;
}

export function mapsecName(id: number): string {
  if (id === 0xff) return 'Fateful encounter';
  if (id === 0xfe) return 'In-game trade';
  return pretty(game.mapsecs[id] ?? `Area ${id}`);
}

export const TYPE_COLORS: Record<string, string> = {
  Normal: '#a8a77a', Fighting: '#c22e28', Flying: '#a98ff3', Poison: '#a33ea1', Ground: '#e2bf65', Rock: '#b6a136',
  Bug: '#a6b91a', Ghost: '#735797', Steel: '#b7b7ce', Fire: '#ee8130', Water: '#6390f0', Grass: '#7ac74c',
  Electric: '#f7d02c', Psychic: '#f95587', Ice: '#96d9d6', Dragon: '#6f35fc', Dark: '#705746', Fairy: '#d685ad',
  '???': '#68a090',
};

export function formatTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}
