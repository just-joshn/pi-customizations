import { seccompFilter as oldF } from './pre-refactor-filter.ts';
import { seccompFilter as newF } from '../../../../extensions/pi-pstack/src/linux-readonly-sandbox.ts';

// Compares the filter before the label refactor with the current unbrokered filter over every syscall number 0 to 519
// plus two x32-flagged numbers, 12 values for each of the first two arguments, and three architecture ids.
const ARCH: Record<string, { be: boolean; audit: number }> = {
  x64: { be: false, audit: 0xc000003e },
  arm64: { be: false, audit: 0xc00000b7 },
  arm: { be: false, audit: 0x40000028 },
  ppc64: { be: false, audit: 0xc0000015 },
  s390x: { be: true, audit: 0x80000016 },
};
function run(p: Buffer, be: boolean, nr: number, audit: number, args: number[]): number {
  const d = Buffer.alloc(64);
  const w = (v: number, at: number) => (be ? d.writeUInt32BE(v >>> 0, at) : d.writeUInt32LE(v >>> 0, at));
  w(nr, 0);
  w(audit, 4);
  args.forEach((a, i) => {
    const lo = a >>> 0;
    const hi = Math.floor(a / 2 ** 32) >>> 0;
    if (be) {
      w(hi, 16 + i * 8);
      w(lo, 20 + i * 8);
    } else {
      w(lo, 16 + i * 8);
      w(hi, 20 + i * 8);
    }
  });
  const r16 = (at: number) => (be ? p.readUInt16BE(at) : p.readUInt16LE(at));
  const r32 = (at: number) => (be ? p.readUInt32BE(at) : p.readUInt32LE(at));
  let A = 0;
  for (let pc = 0; pc < p.length / 8; pc++) {
    const c = r16(pc * 8);
    const jt = p[pc * 8 + 2] as number;
    const jf = p[pc * 8 + 3] as number;
    const k = r32(pc * 8 + 4);
    if (c === 0x20) A = be ? d.readUInt32BE(k) : d.readUInt32LE(k);
    else if (c === 0x15) pc += A === k ? jt : jf;
    else if (c === 0x35) pc += A >= k ? jt : jf;
    else if (c === 0x54) A = (A & k) >>> 0;
    else if (c === 0x06) return k;
    else throw new Error(`opcode ${c}`);
  }
  throw new Error('ran off');
}
const nrs = [...Array(520).keys(), 0x40000001, 0x40000029];
const vals = [0, 1, 2, 3, 5, 8, 10, 0xf, 0x80800, 0x80802, 0x1_0000_0001, 0xffffffff];
for (const [arch, { be, audit }] of Object.entries(ARCH)) {
  const o = oldF(arch);
  const n = newF(arch);
  let total = 0;
  let diff = 0;
  for (const aud of [audit, 0x40000003, 0xc000003e ^ 1])
    for (const nr of nrs)
      for (const a0 of vals)
        for (const a1 of vals) {
          total++;
          if (run(o, be, nr, aud, [a0, a1, 0]) !== run(n, be, nr, aud, [a0, a1, 0])) diff++;
        }
  console.log(arch.padEnd(6), 'cases', total, 'decision differences', diff, 'instructions', o.length / 8, '->', n.length / 8);
}
