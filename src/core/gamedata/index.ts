// Generated game data (src/data/game.json) with typed lookups.
import gameJson from '../../data/game.json' with { type: 'json' };
import { Charset } from '../text/charset.ts';
import type { GameData, ItemData, MoveData, SpeciesData } from './types.ts';

export const game = gameJson as unknown as GameData;
export const charset = new Charset(game.charmap);

export function species(id: number): SpeciesData | undefined {
  return game.species[id];
}

export function move(id: number): MoveData | undefined {
  return game.moves[id];
}

export function item(id: number): ItemData | undefined {
  return game.items[id];
}

/** Species id by in-game (upper-case) name; throws if absent so rule tables can't silently break. */
export function speciesIdByName(name: string): number {
  const s = game.species.find((x) => x.name === name);
  if (!s) throw new Error(`Species ${name} not found in game data`);
  return s.id;
}
