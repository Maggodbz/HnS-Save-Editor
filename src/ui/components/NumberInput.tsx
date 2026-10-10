// Integer input that commits on blur / Enter and clamps to [min, max].
import { useEffect, useState } from 'react';

interface Props {
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
  ariaLabel: string;
  width?: number;
  disabled?: boolean;
}

export function NumberInput({ value, min, max, onCommit, ariaLabel, width, disabled }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Number(text.replace(/[^\d-]/g, ''));
    if (!Number.isFinite(n) || text.trim() === '') { setText(String(value)); return; }
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      className="num"
      inputMode="numeric"
      aria-label={ariaLabel}
      style={width ? { width } : undefined}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(String(value)); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
          const n = Math.min(max, Math.max(min, (Number(text) || 0) + step));
          setText(String(n));
          if (n !== value) onCommit(n);
        }
      }}
    />
  );
}
