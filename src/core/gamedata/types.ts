// Shape of the generated game data (src/data/game.json). Produced by tools/gen-data.ts from the hack's ELF.

/** Stat order used throughout the editor: HP, Atk, Def, Speed, SpAtk, SpDef (the game's internal order). */
export type StatTuple = [number, number, number, number, number, number];

export interface SpeciesData {
  id: number;
  name: string;
  /** Placeholder species slot; never offered in pickers. */
  unused: boolean;
  nationalDex: number;
  baseStats: StatTuple;
  /**
   * Pre-buff stats, used per stat (a 0 entry means "no old value for this stat") when the save's
   * "New Stats" mode is off. null if the species has no old stats at all.
   */
  baseStatsOld: StatTuple | null;
  types: [number, number];
  abilities: [number, number];
  /** Original abilities used for some legendaries / Noctowl depending on save settings. */
  abilitiesOld: [number, number];
  genderRatio: number;
  growthRate: number;
  friendship: number;
  catchRate: number;
  eggGroups: [number, number];
  /** Index into the icon atlas (gMonIconTable index), or -1. */
  icon: number;
}

export interface MoveData {
  id: number;
  name: string;
  type: number;
  power: number;
  accuracy: number;
  pp: number;
  category: number;
  priority: number;
  description: string;
}

export interface ItemData {
  id: number;
  name: string;
  /** Placeholder slot in the item table (ITEM_NONE or a gap); never offered in pickers. */
  unused: boolean;
  pocket: number;
  /** "Important" items (key-item style: quantity always 1, cannot toss) in the default ruleset. */
  important: boolean;
  /** Same flag when the save uses the Finite TMs option (the hack swaps to a second item table). */
  importantFinite: boolean;
  price: number;
  holdEffect: number;
  description: string;
  /** For TMs/HMs: the move taught. */
  tmMove?: number;
}

export interface NatureData {
  name: string;
  /** Stat index (1..5 = Atk, Def, Speed, SpAtk, SpDef) raised / lowered, or 0 for neutral. */
  up: number;
  down: number;
}

export interface GameData {
  meta: {
    generator: string;
    elf: string;
    verifiedRom: string | null;
    verifiedTables: string[];
  };
  constants: Record<string, number>;
  charmap: Record<string, string>;
  species: SpeciesData[];
  moves: MoveData[];
  items: ItemData[];
  abilities: { name: string; description: string }[];
  natures: NatureData[];
  types: string[];
  /** expTables[growthRate][level] = minimum EXP for that level. */
  expTables: number[][];
  /** natureStatTable[nature][stat-1] ∈ {-1, 0, 1} for Atk, Def, Speed, SpAtk, SpDef. */
  natureStatTable: number[][];
  /** Moves taught by TM01.. then HM01.. */
  tmhmMoves: number[];
  /** Per species: TM/HM indices it can learn. */
  tmhmLearnsets: number[][];
  /** Per species: [level, move] pairs. `modern` is used unless the save's "Modern Moves" mode is off. */
  learnsets: { modern: [number, number][][]; original: [number, number][][] };
  /** Region map section names (met locations). */
  mapsecs: string[];
  atlases: {
    icons: { file: string; cell: number; columns: number };
    front: { file: string; cell: number; columns: number };
    frontShiny: { file: string; cell: number; columns: number };
    items: { file: string; cell: number; columns: number };
  };
}
