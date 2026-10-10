import type { SaveSession } from '../../core/save/session.ts';
import { MAX_BP, MAX_COINS, MAX_MONEY } from '../../core/save/trainer.ts';
import { useSessionVersion } from '../App.tsx';
import { NumberInput } from '../components/NumberInput.tsx';
import { useGuard } from '../components/Toasts.tsx';
import { typeName } from '../format.ts';

// Human-readable labels for the challenge settings worth showing (value 0 = off is hidden).
const SETTING_LABELS: Record<string, (v: number) => string> = {
  tx_Challenges_OneTypeChallenge: (v) => `One type only: ${typeName(v)}`,
  tx_Challenges_Nuzlocke: () => 'Nuzlocke',
  tx_Challenges_NuzlockeHardcore: () => 'Nuzlocke hardcore',
  tx_Challenges_LevelCap: (v) => `Level cap: ${['off', 'normal', 'hard'][v] ?? v}`,
  tx_Challenges_ExpMultiplier: (v) => `EXP multiplier ${['1.0×', '1.5×', '2.0×', '0×'][v] ?? v}`,
  tx_Challenges_BaseStatEqualizer: (v) => `Base stat equalizer (${[0, 100, 255, 500][v]})`,
  tx_Challenges_TrainerScalingIVs: (v) => `Trainer IVs: ${['off', 'scale', 'hard'][v] ?? v}`,
  tx_Challenges_TrainerScalingEVs: (v) => `Trainer EVs: ${['off', 'scale', 'hard', 'extreme'][v] ?? v}`,
  tx_Challenges_MaxPartyIVs: (v) => `Your IVs: ${['normal', 'max', '30–31'][v] ?? v}`,
  tx_Challenges_NoItemPlayer: () => 'No items in battle (player)',
  tx_Challenges_NoItemTrainer: () => 'No items in battle (trainers)',
  tx_Challenges_PkmnCenter: () => 'Pokémon Center challenge',
  tx_Challenges_PCHeal: () => 'PC healing challenge',
  tx_Challenges_PartyLimit: (v) => `Party limit ${v}`,
  tx_Challenges_NoEVs: () => 'No EVs',
  tx_Challenges_Mirror: () => 'Mirror mode',
  tx_Random_WildPokemon: () => 'Random wild Pokémon',
  tx_Random_Similar: () => 'Randomizer: similar strength',
  tx_Random_MapBased: () => 'Randomizer: map-based',
  tx_Random_Starter: () => 'Random starter',
  tx_Random_Trainer: () => 'Random trainers',
  tx_Random_Abilities: () => 'Random abilities',
  tx_Random_Moves: () => 'Random moves',
  tx_Random_Items: () => 'Random items',
  tx_Random_Evolutions: () => 'Random evolutions',
  tx_Mode_InfiniteTMs: () => 'Infinite TMs',
  tx_Mode_Mints: () => 'Mints',
  tx_Mode_Fairy_Types: () => 'Fairy type',
  tx_Mode_Modern_Moves: () => 'Modern movesets',
  tx_Mode_Legendary_Abilities: () => 'Modern legendary abilities',
  tx_Mode_Synchronize: () => 'Modern Synchronize',
  tx_Mode_Sturdy: () => 'Modern Sturdy',
  tx_Mode_PoisonSurvive: () => 'Poison leaves 1 HP',
  tx_Features_ShinyChance: (v) => `Shiny odds 1/${[8192, 4096, 2048, 1024, 512][v] ?? '?'}`,
  tx_Features_WildMonDropItems: () => 'Wild Pokémon drop items',
};

export function TrainerView({ session }: { session: SaveSession }) {
  useSessionVersion(session);
  const guard = useGuard();
  const t = session.trainer;
  const original = session.originalTrainer;
  const settings = Object.entries(session.settings.tx)
    // One-type challenge uses 31 for "off" (TX_CHALLENGE_TYPE_OFF); every other option uses 0.
    .filter(([k, v]) => SETTING_LABELS[k] && (k === 'tx_Challenges_OneTypeChallenge' ? v !== 31 : v !== 0))
    .map(([k, v]) => SETTING_LABELS[k]!(v));

  const field = (label: string, value: number, orig: number, max: number, set: (v: number) => void, prefix = '') => (
    <div className={`field-row ${value !== orig ? 'changed' : ''}`}>
      <label>{label}</label>
      <div className="field-control">
        {prefix && <span className="muted">{prefix}</span>}
        <NumberInput value={value} min={0} max={max} ariaLabel={label} width={130} onCommit={(v) => guard(() => set(v))} />
        <button className="small ghost" onClick={() => guard(() => set(max))}>Max</button>
        {value !== orig && <button className="small ghost" onClick={() => guard(() => set(orig))} title={`Reset to ${orig}`}>Reset</button>}
      </div>
      <span className="muted small">max {max.toLocaleString()}</span>
    </div>
  );

  return (
    <div className="trainer">
      <section className="card trainer-card">
        <div className="trainer-head">
          <div className={`avatar ${t.gender}`} aria-hidden>{t.gender === 'male' ? '♂' : '♀'}</div>
          <div>
            <h2>{t.name}</h2>
            <div className="muted">ID No. {String(t.trainerId).padStart(5, '0')} · Secret ID {String(t.secretId).padStart(5, '0')}</div>
            <div className="muted">Play time {t.playTime.hours}:{String(t.playTime.minutes).padStart(2, '0')}:{String(t.playTime.seconds).padStart(2, '0')}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Wallet</h3>
        {field('Money', t.money, original.money, MAX_MONEY, (v) => session.setMoney(v), '₽')}
        {field('Coins', t.coins, original.coins, MAX_COINS, (v) => session.setCoins(v))}
        {field('Battle Points', t.battlePoints, original.battlePoints, MAX_BP, (v) => session.setBattlePoints(v))}
      </section>

      <section className="card">
        <h3>Game settings <span className="muted small">(read-only — chosen at New Game)</span></h3>
        {settings.length ? (
          <div className="chips">{settings.map((s) => <span key={s} className="chip">{s}</span>)}</div>
        ) : <p className="muted">No challenge or randomizer options are active.</p>}
        <p className="muted small">The editor uses these settings for stat calculation, TM rules and shiny odds, exactly like the game.</p>
      </section>
    </div>
  );
}
