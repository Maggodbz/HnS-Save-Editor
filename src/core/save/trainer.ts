// Trainer card data: name, IDs, play time (read-only) and money, coins, Battle Points (editable).
// Money and coins are XOR-encrypted with SaveBlock2.encryptionKey (src/money.c, src/coins.c).
import { constant, StructView } from '../layout/index.ts';
import { charset, game } from '../gamedata/index.ts';

export const MAX_MONEY = game.constants['MAX_MONEY']!;
export const MAX_COINS = constant('MAX_COINS');
export const MAX_BP = constant('MAX_BATTLE_FRONTIER_POINTS');

export interface TrainerInfo {
  name: string;
  gender: 'male' | 'female';
  trainerId: number;
  secretId: number;
  /** Full 32-bit OT id (SID << 16 | TID), as stored in Pokémon. */
  otId: number;
  playTime: { hours: number; minutes: number; seconds: number };
  money: number;
  coins: number;
  battlePoints: number;
}

export function readTrainer(saveBlock1: Uint8Array, saveBlock2: Uint8Array): TrainerInfo {
  const sb1 = new StructView('SaveBlock1', saveBlock1, 0);
  const sb2 = new StructView('SaveBlock2', saveBlock2, 0);
  const key = sb2.get('encryptionKey');
  const id = sb2.range('playerTrainerId');
  const otId = (id[0]! | (id[1]! << 8) | (id[2]! << 16) | (id[3]! << 24)) >>> 0;
  return {
    name: charset.decode(sb2.range('playerName')),
    gender: sb2.get('playerGender') === 0 ? 'male' : 'female',
    trainerId: otId & 0xffff,
    secretId: otId >>> 16,
    otId,
    playTime: { hours: sb2.get('playTimeHours'), minutes: sb2.get('playTimeMinutes'), seconds: sb2.get('playTimeSeconds') },
    money: (sb1.get('money') ^ key) >>> 0,
    coins: (sb1.get('coins') ^ key) & 0xffff,
    battlePoints: sb2.get('battlePoints'),
  };
}

function checkRange(label: string, value: number, max: number) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be 0-${max}`);
}

export function setMoney(saveBlock1: Uint8Array, saveBlock2: Uint8Array, value: number): void {
  checkRange('Money', value, MAX_MONEY);
  const key = new StructView('SaveBlock2', saveBlock2, 0).get('encryptionKey');
  new StructView('SaveBlock1', saveBlock1, 0).set('money', (value ^ key) >>> 0);
}

export function setCoins(saveBlock1: Uint8Array, saveBlock2: Uint8Array, value: number): void {
  checkRange('Coins', value, MAX_COINS);
  const key = new StructView('SaveBlock2', saveBlock2, 0).get('encryptionKey');
  new StructView('SaveBlock1', saveBlock1, 0).set('coins', (value ^ key) & 0xffff);
}

export function setBattlePoints(saveBlock2: Uint8Array, value: number): void {
  checkRange('Battle Points', value, MAX_BP);
  new StructView('SaveBlock2', saveBlock2, 0).set('battlePoints', value);
}
