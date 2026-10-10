// Picker option lists built once from game data.
import { createElement } from 'react';
import { game } from '../core/gamedata/index.ts';
import { constant } from '../core/layout/index.ts';
import type { Option } from './components/Combobox.tsx';
import { ItemIcon, MonIcon } from './components/Sprite.tsx';
import { itemName, moveName, natureEffect, natureName, pretty, speciesName, typeName } from './format.ts';

export const speciesOptions: Option[] = game.species
  .filter((s) => !s.unused)
  .sort((a, b) => a.nationalDex - b.nationalDex || a.id - b.id)
  .map((s) => ({
    value: s.id,
    label: speciesName(s.id),
    hint: `#${String(s.nationalDex).padStart(3, '0')} · ${[...new Set(s.types)].map(typeName).join('/')}`,
    icon: createElement(MonIcon, { species: s.id }),
    keywords: String(s.nationalDex),
  }));

export const moveOptions: Option[] = game.moves
  .filter((m) => m.id > 0)
  .map((m) => ({
    value: m.id,
    label: moveName(m.id),
    hint: `${typeName(m.type)} · ${['Physical', 'Special', 'Status'][m.category] ?? ''}${m.power > 1 ? ` · ${m.power}` : ''} · ${m.pp} PP`,
    keywords: typeName(m.type),
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** Items a Pokémon can hold (everything except key items), plus "None". */
export const heldItemOptions: Option[] = [
  { value: 0, label: 'None' },
  ...game.items
    .filter((i) => !i.unused && i.pocket !== constant('POCKET_KEY_ITEMS'))
    .map((i) => ({ value: i.id, label: itemName(i.id), icon: createElement(ItemIcon, { item: i.id }) }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];

export const ballOptions: Option[] = game.items
  .filter((i) => !i.unused && i.pocket === constant('POCKET_POKE_BALLS'))
  .map((i) => ({ value: i.id, label: itemName(i.id), icon: createElement(ItemIcon, { item: i.id }) }));

export const natureOptions: Option[] = game.natures.map((_, i) => ({
  value: i,
  label: natureName(i),
  hint: natureEffect(i),
}));

export function itemOptionsFor(items: { id: number; name: string; description: string }[]): Option[] {
  return items
    .map((i) => ({ value: i.id, label: pretty(i.name), hint: i.description, icon: createElement(ItemIcon, { item: i.id }) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
