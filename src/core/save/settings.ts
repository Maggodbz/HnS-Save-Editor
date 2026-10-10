// Challenge / randomizer / mode settings stored in SaveBlock1 (tx_* fields) and the event flags
// that change game rules. Read-only in this editor; used to apply the right formulas.
import { constant, rangeField, StructView } from '../layout/index.ts';

export interface SaveSettings {
  /** Raw tx_* values by field name (e.g. tx_Challenges_BaseStatEqualizer). */
  tx: Record<string, number>;
  baseStatEqualizer: number;
  newStats: boolean;
  modernMoves: boolean;
  modernTypes: boolean;
  legendaryAbilities: boolean;
  randomAbilities: boolean;
  shinyChance: number;
  maxPartyIVs: number;
  limitToLevel50: boolean;
  finiteTMs: boolean;
  pcHeal: boolean;
}

export function getFlag(saveBlock1: Uint8Array, flagId: number): boolean {
  const flags = rangeField('SaveBlock1', 'flags');
  const byte = saveBlock1[flags.offset + (flagId >> 3)]!;
  return ((byte >> (flagId & 7)) & 1) === 1;
}

export function readSettings(saveBlock1: Uint8Array): SaveSettings {
  const sb1 = new StructView('SaveBlock1', saveBlock1, 0);
  const tx: Record<string, number> = {};
  for (const name of Object.keys(sb1.def.fields)) if (name.startsWith('tx_')) tx[name] = sb1.get(name);
  const t = (name: string) => tx[name] ?? 0;
  return {
    tx,
    baseStatEqualizer: t('tx_Challenges_BaseStatEqualizer'),
    newStats: t('tx_Mode_New_Stats') === 1,
    modernMoves: t('tx_Mode_Modern_Moves') === 1,
    modernTypes: t('tx_Mode_Modern_Types') === 1,
    legendaryAbilities: t('tx_Mode_Legendary_Abilities') === 1,
    randomAbilities: t('tx_Random_Abilities') === 1,
    shinyChance: t('tx_Features_ShinyChance'),
    maxPartyIVs: t('tx_Challenges_MaxPartyIVs'),
    limitToLevel50: getFlag(saveBlock1, constant('FLAG_LIMIT_TO_50')),
    finiteTMs: getFlag(saveBlock1, constant('FLAG_FINITE_TMS')),
    pcHeal: t('tx_Challenges_PkmnCenter') === 1 || t('tx_Challenges_PCHeal') === 1,
  };
}
