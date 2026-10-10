// Minimal GDB Remote Serial Protocol client for mGBA's GDB stub (`mgba -g`).
// Supports what the verifier needs: continue / interrupt, memory read/write, registers, breakpoints.
import net from 'node:net';

const checksum = (s: string) => {
  let sum = 0;
  for (const c of s) sum = (sum + c.charCodeAt(0)) & 0xff;
  return sum.toString(16).padStart(2, '0');
};

export class GdbClient {
  private socket!: net.Socket;
  private buffer = '';
  private waiters: ((packet: string) => void)[] = [];

  static async connect(port: number, host = '127.0.0.1', timeoutMs = 15000): Promise<GdbClient> {
    const client = new GdbClient();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await client.open(port, host);
        return client;
      } catch (e) {
        if (Date.now() > deadline) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  private open(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host);
      socket.once('connect', () => {
        this.socket = socket;
        socket.on('data', (d) => this.onData(d.toString('latin1')));
        resolve();
      });
      socket.once('error', reject);
    });
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      this.buffer = this.buffer.replace(/^\++/, '');
      const start = this.buffer.indexOf('$');
      if (start < 0) return;
      const end = this.buffer.indexOf('#', start);
      if (end < 0 || this.buffer.length < end + 3) return;
      const packet = this.buffer.slice(start + 1, end);
      this.buffer = this.buffer.slice(end + 3);
      this.socket.write('+');
      const waiter = this.waiters.shift();
      if (waiter) waiter(packet);
    }
  }

  private next(timeoutMs = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        reject(new Error('GDB stub did not respond'));
      }, timeoutMs);
      const done = (p: string) => {
        clearTimeout(timer);
        resolve(p);
      };
      this.waiters.push(done);
    });
  }

  async command(body: string, timeoutMs?: number): Promise<string> {
    const reply = this.next(timeoutMs);
    this.socket.write(`$${body}#${checksum(body)}`);
    return reply;
  }

  /** Resumes execution (no reply until the target stops). */
  continue(): Promise<string> {
    const stop = this.next(600000);
    this.socket.write(`$c#${checksum('c')}`);
    return stop;
  }

  /** Interrupts a running target; resolves with the stop reply. */
  async interrupt(pendingStop: Promise<string>): Promise<string> {
    this.socket.write('\x03');
    return pendingStop;
  }

  async readMemory(addr: number, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    for (let off = 0; off < length; off += 0x200) {
      const n = Math.min(0x200, length - off);
      const hex = await this.command(`m${(addr + off).toString(16)},${n.toString(16)}`);
      if (hex.startsWith('E') && hex.length === 3) throw new Error(`Memory read failed at 0x${(addr + off).toString(16)}: ${hex}`);
      out.set(Buffer.from(hex, 'hex'), off);
    }
    return out;
  }

  async writeMemory(addr: number, data: Uint8Array): Promise<void> {
    for (let off = 0; off < data.length; off += 0x100) {
      const chunk = data.subarray(off, off + 0x100);
      const reply = await this.command(`M${(addr + off).toString(16)},${chunk.length.toString(16)}:${Buffer.from(chunk).toString('hex')}`);
      if (reply !== 'OK') throw new Error(`Memory write failed: ${reply}`);
    }
  }

  async u32(addr: number): Promise<number> {
    const b = await this.readMemory(addr, 4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  async u16(addr: number): Promise<number> {
    const b = await this.readMemory(addr, 2);
    return b[0]! | (b[1]! << 8);
  }

  /** All registers as the raw 'g' hex blob (restore with setAllRegisters). */
  async allRegisters(): Promise<string> {
    return this.command('g');
  }

  async setAllRegisters(blob: string): Promise<void> {
    // mGBA quirk: 'g' sends each register as little-endian bytes, but 'G' parses each 8-digit group as a
    // plain hex number. Convert every 32-bit group so the values round-trip.
    const parsed = blob.replace(/[0-9a-f]{8}/gi, (w) => w.match(/../g)!.reverse().join(''));
    const reply = await this.command(`G${parsed}`);
    if (reply !== 'OK') throw new Error(`Register write failed: ${reply}`);
  }

  async setBreakpoint(addr: number): Promise<void> {
    const reply = await this.command(`Z0,${addr.toString(16)},2`);
    if (reply !== 'OK') throw new Error(`Breakpoint not supported: ${reply}`);
  }

  async clearBreakpoint(addr: number): Promise<void> {
    await this.command(`z0,${addr.toString(16)},2`);
  }

  close() {
    this.socket?.destroy();
  }
}

/** Register blob helpers (ARM GDB layout: r0-r15 as 8 hex chars each, little-endian; CPSR at index 25). */
export function regGet(blob: string, index: number): number {
  const hex = blob.slice(index * 8, index * 8 + 8);
  return Buffer.from(hex, 'hex').readUInt32LE(0);
}

export function regSet(blob: string, index: number, value: number): string {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0, 0);
  return blob.slice(0, index * 8) + b.toString('hex') + blob.slice(index * 8 + 8);
}
