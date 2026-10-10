// Pokédex seen/caught flags (GetSetPokedexFlag / HandleSetPokedexFlag in the game).
// "Seen" lives in three copies (SaveBlock2.pokedex.seen, SaveBlock1.seen1, SaveBlock1.seen2) that must agree,
// otherwise the game clears the flag; "caught" additionally needs the seen bit.
import { constant, rangeField, StructView } from '../layout/index.ts';
import { game } from '../gamedata/index.ts';

function bit(nationalDex: number): [number, number] {
  const n = nationalDex - 1;
  return [n >> 3, 1 << (n & 7)];
}

export function isCaught(saveBlock1: Uint8Array, saveBlock2: Uint8Array, speciesId: number): boolean {
  const dex = game.species[speciesId]?.nationalDex ?? 0;
  if (dex <= 0) return false;
  const [i, m] = bit(dex);
  const owned = rangeField('SaveBlock2', 'pokedexOwned');
  const seen = rangeField('SaveBlock2', 'pokedexSeen');
  const seen1 = rangeField('SaveBlock1', 'seen1');
  const seen2 = rangeField('SaveBlock1', 'seen2');
  const o = saveBlock2[owned.offset + i]! & m;
  return o !== 0 && o === (saveBlock2[seen.offset + i]! & m) && o === (saveBlock1[seen1.offset + i]! & m)
    && o === (saveBlock1[seen2.offset + i]! & m);
}

/** Marks a species as seen and caught, as catching it would (incl. first-seen Unown/Spinda personality). */
export function registerCaught(saveBlock1: Uint8Array, saveBlock2: Uint8Array, speciesId: number, personality: number): void {
  const dex = game.species[speciesId]?.nationalDex ?? 0;
  if (dex <= 0 || dex > constant('NUM_DEX_FLAG_BYTES') * 8) return;
  const [i, m] = bit(dex);
  const seen = rangeField('SaveBlock2', 'pokedexSeen');
  const wasSeen = (saveBlock2[seen.offset + i]! & m) !== 0;
  for (const [block, field] of [[saveBlock2, 'pokedexSeen'], [saveBlock1, 'seen1'], [saveBlock1, 'seen2']] as const) {
    const r = rangeField(block === saveBlock2 ? 'SaveBlock2' : 'SaveBlock1', field);
    block[r.offset + i]! |= m;
  }
  const owned = rangeField('SaveBlock2', 'pokedexOwned');
  saveBlock2[owned.offset + i]! |= m;
  if (!wasSeen) {
    const sb2 = new StructView('SaveBlock2', saveBlock2, 0);
    if (speciesId === constant('SPECIES_UNOWN')) sb2.set('pokedexUnownPersonality', personality >>> 0);
    if (game.species[speciesId]?.name === 'SPINDA') sb2.set('pokedexSpindaPersonality', personality >>> 0);
  }
}
