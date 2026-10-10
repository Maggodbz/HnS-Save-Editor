// Bag pockets and PC item storage (SaveBlock1). Bag quantities are XOR-encrypted with the low 16 bits of
// SaveBlock2.encryptionKey; PC item quantities are stored plainly (src/item.c).
import { u16, setU16 } from '../binary.ts';
import { constant, rangeField, StructView } from '../layout/index.ts';
import { game } from '../gamedata/index.ts';
import type { ItemData } from '../gamedata/types.ts';
import type { SaveSettings } from './settings.ts';

export type PocketId = 'items' | 'keyItems' | 'pokeBalls' | 'tmhm' | 'berries' | 'pc';

export interface PocketDef {
  id: PocketId;
  label: string;
  field: string;
  /** Item pocket number this pocket accepts (POCKET_*), or null for the PC (accepts any non-key item). */
  pocket: number | null;
  encrypted: boolean;
  maxQuantity: number;
}

export const POCKETS: PocketDef[] = [
  { id: 'items', label: 'Items', field: 'bagPocket_Items', pocket: constant('POCKET_ITEMS'), encrypted: true, maxQuantity: constant('MAX_BAG_ITEM_CAPACITY') },
  { id: 'pokeBalls', label: 'Poké Balls', field: 'bagPocket_PokeBalls', pocket: constant('POCKET_POKE_BALLS'), encrypted: true, maxQuantity: constant('MAX_BAG_ITEM_CAPACITY') },
  { id: 'tmhm', label: 'TMs & HMs', field: 'bagPocket_TMHM', pocket: constant('POCKET_TM_HM'), encrypted: true, maxQuantity: constant('MAX_BAG_ITEM_CAPACITY') },
  { id: 'berries', label: 'Berries', field: 'bagPocket_Berries', pocket: constant('POCKET_BERRIES'), encrypted: true, maxQuantity: constant('MAX_BERRY_CAPACITY') },
  { id: 'keyItems', label: 'Key Items', field: 'bagPocket_KeyItems', pocket: constant('POCKET_KEY_ITEMS'), encrypted: true, maxQuantity: constant('MAX_BAG_ITEM_CAPACITY') },
  { id: 'pc', label: 'PC Storage', field: 'pcItems', pocket: null, encrypted: false, maxQuantity: constant('MAX_PC_ITEM_CAPACITY') },
];

export function pocketDef(id: PocketId): PocketDef {
  return POCKETS.find((p) => p.id === id)!;
}

export interface ItemStack {
  itemId: number;
  quantity: number;
}

export function pocketCapacity(def: PocketDef): number {
  return rangeField('SaveBlock1', def.field).size / 4;
}

function key16(saveBlock2: Uint8Array): number {
  return new StructView('SaveBlock2', saveBlock2, 0).get('encryptionKey') & 0xffff;
}

/** Reads a pocket's slots in order, skipping empty ones (ITEM_NONE). */
export function readPocket(saveBlock1: Uint8Array, saveBlock2: Uint8Array, def: PocketDef): ItemStack[] {
  const r = rangeField('SaveBlock1', def.field);
  const key = def.encrypted ? key16(saveBlock2) : 0;
  const out: ItemStack[] = [];
  for (let i = 0; i < r.size / 4; i++) {
    const itemId = u16(saveBlock1, r.offset + i * 4);
    if (itemId === 0) continue;
    out.push({ itemId, quantity: u16(saveBlock1, r.offset + i * 4 + 2) ^ key });
  }
  return out;
}

/** True if an item is "important" (quantity fixed at 1) under the save's TM mode. */
export function isImportant(item: ItemData, settings: SaveSettings): boolean {
  return settings.finiteTMs ? item.importantFinite : item.important;
}

export function maxQuantityFor(item: ItemData, def: PocketDef, settings: SaveSettings): number {
  return isImportant(item, settings) ? 1 : def.maxQuantity;
}

/** Problems that make a pocket's contents invalid for the game. Empty list = OK. */
export function validatePocket(def: PocketDef, stacks: ItemStack[], settings: SaveSettings): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  if (stacks.length > pocketCapacity(def)) errors.push(`${def.label}: more than ${pocketCapacity(def)} different items`);
  for (const s of stacks) {
    const item = game.items[s.itemId];
    if (!item || item.unused) {
      errors.push(`${def.label}: unknown item #${s.itemId}`);
      continue;
    }
    if (def.pocket !== null && item.pocket !== def.pocket) errors.push(`${def.label}: ${item.name} belongs in another pocket`);
    if (def.pocket === null && item.pocket === constant('POCKET_KEY_ITEMS')) errors.push(`${def.label}: key items can't be stored in the PC`);
    if (seen.has(s.itemId)) errors.push(`${def.label}: ${item.name} is listed twice`);
    seen.add(s.itemId);
    const max = maxQuantityFor(item, def, settings);
    if (!Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > max) {
      errors.push(`${def.label}: ${item.name} quantity must be 1-${max}`);
    }
  }
  return errors;
}

/** Writes a pocket: stacks first (in order), remaining slots cleared. Throws if invalid. */
export function writePocket(
  saveBlock1: Uint8Array,
  saveBlock2: Uint8Array,
  def: PocketDef,
  stacks: ItemStack[],
  settings: SaveSettings,
): void {
  const errors = validatePocket(def, stacks, settings);
  if (errors.length) throw new Error(errors.join('\n'));
  const r = rangeField('SaveBlock1', def.field);
  const key = def.encrypted ? key16(saveBlock2) : 0;
  for (let i = 0; i < r.size / 4; i++) {
    const s = stacks[i];
    setU16(saveBlock1, r.offset + i * 4, s ? s.itemId : 0);
    // An empty slot holds quantity 0, which is stored encrypted (0 ^ key) in bag pockets.
    setU16(saveBlock1, r.offset + i * 4 + 2, (s ? s.quantity : 0) ^ key);
  }
}

/** Items that can go into a pocket (for pickers). */
export function itemsForPocket(def: PocketDef): ItemData[] {
  return game.items.filter((it) =>
    !it.unused && (def.pocket === null ? it.pocket !== constant('POCKET_KEY_ITEMS') : it.pocket === def.pocket));
}
