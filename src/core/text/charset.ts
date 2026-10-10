// Game text encoding (the hack's charmap.txt). Strings end at 0xFF (EOS).
export const EOS = 0xff;

export class Charset {
  private readonly toChar = new Map<number, string>();
  private readonly toByte = new Map<string, number>();

  /** `map` is byte (decimal string) → character, as generated into game.json. */
  constructor(map: Record<string, string>) {
    for (const [byte, ch] of Object.entries(map)) {
      const b = Number(byte);
      this.toChar.set(b, ch);
      if (!this.toByte.has(ch)) this.toByte.set(ch, b);
    }
  }

  /** Decodes up to the first EOS. Unknown bytes become U+FFFD. */
  decode(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) {
      if (b === EOS) break;
      out += this.toChar.get(b) ?? '�';
    }
    return out;
  }

  /** True if every byte up to EOS has a known character (so the text can be round-tripped). */
  isExact(bytes: Uint8Array): boolean {
    for (const b of bytes) {
      if (b === EOS) return true;
      if (!this.toChar.has(b)) return false;
    }
    return true;
  }

  /** Characters in `text` that the game cannot display. */
  invalidChars(text: string): string[] {
    return [...new Set([...text].filter((c) => !this.toByte.has(c)))];
  }

  /**
   * Encodes into a fixed-size field: the text, then EOS, then EOS padding.
   * If the text exactly fills the field there is no terminator (as in the game's nickname storage).
   */
  encode(text: string, fieldSize: number): Uint8Array {
    const chars = [...text];
    const bad = this.invalidChars(text);
    if (bad.length) throw new Error(`Characters not available in the game: ${bad.join(' ')}`);
    if (chars.length > fieldSize) throw new Error(`Text is longer than ${fieldSize} characters`);
    const out = new Uint8Array(fieldSize).fill(EOS);
    chars.forEach((c, i) => (out[i] = this.toByte.get(c)!));
    return out;
  }
}
