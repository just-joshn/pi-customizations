import { seccompFilter } from '/tmp/pstack-interrogate3.vj8vm2/review-1/extensions/pi-pstack/src/linux-readonly-sandbox.ts';
const A: Record<string, { audit: number; be: boolean; sock: number; sp: number; sc: boolean; scpair: boolean; extra: number[] }> = {
  x64: { audit: 0xc000003e, be: false, sock: 41, sp: 53, sc: false, scpair: false, extra: [425] },
  arm64: { audit: 0xc00000b7, be: false, sock: 198, sp: 199, sc: false, scpair: false, extra: [425] },
  arm: { audit: 0x40000028, be: false, sock: 281, sp: 288, sc: true, scpair: true, extra: [425, 113] },
  ppc64: { audit: 0xc0000015, be: false, sock: 326, sp: 333, sc: true, scpair: true, extra: [425] },
  s390x: { audit: 0x80000016, be: true, sock: 359, sp: 360, sc: true, scpair: false, extra: [425] },
};
const ALLOW = 0x7fff0000, EPERM = 0x50001, KILL = 0x80000000;
function run(prog: Buffer, be: boolean, audit: number, nr: number, args: bigint[]): number {
  const d = Buffer.alloc(64);
  const w32 = (v: number, o: number) => (be ? d.writeUInt32BE(v >>> 0, o) : d.writeUInt32LE(v >>> 0, o));
  w32(nr, 0); w32(audit, 4);
  args.forEach((a, i) => { const lo = Number(a & 0xffffffffn), hi = Number(a >> 32n); if (be) { w32(hi, 16 + 8 * i); w32(lo, 20 + 8 * i); } else { w32(lo, 16 + 8 * i); w32(hi, 20 + 8 * i); } });
  const n = prog.length / 8; let pc = 0, acc = 0, steps = 0;
  while (true) {
    if (pc < 0 || pc >= n) throw new Error(`pc out of range ${pc}`);
    if (++steps > 200) throw new Error('loop');
    const o = pc * 8;
    const code = be ? prog.readUInt16BE(o) : prog.readUInt16LE(o); const jt = prog[o + 2]!, jf = prog[o + 3]!; const k = be ? prog.readUInt32BE(o + 4) : prog.readUInt32LE(o + 4);
    pc++;
    switch (code) {
      case 0x20: if (k + 4 > 64) throw new Error('oob load'); acc = be ? d.readUInt32BE(k) : d.readUInt32LE(k); break;
      case 0x15: pc += acc === k ? jt : jf; break;
      case 0x35: pc += acc >= k ? jt : jf; break;
      case 0x54: acc = (acc & k) >>> 0; break;
      case 0x06: return k;
      default: throw new Error(`bad opcode ${code.toString(16)} at ${pc - 1}`);
    }
  }
}
const lo = (x: bigint) => Number(x & 0xffffffffn);
const vals = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 0xfn, 0x10n, 0x11n, 0x12n, 0x80000n, 0x80001n, 0x80002n, 0x80800n, 0x80801n, 0x80805n, 0xffffffffn, 0x100000001n, 0x100000002n, 0x200000008n, 0x100000008n, 0x7fffffffffffffffn, 0xffffffffffffffffn, 0x8000000000000001n];
let bad = 0, checked = 0;
for (const [arch, a] of Object.entries(A)) {
  const prog = seccompFilter(arch);
  if (prog.length % 8) throw new Error('len');
  // structural: every jump lands in range, last 3 are returns
  const n = prog.length / 8;
  for (let i = 0; i < n; i++) { const o = i * 8; const code = a.be ? prog.readUInt16BE(o) : prog.readUInt16LE(o); if (code === 0x15 || code === 0x35) { for (const j of [prog[o + 2]!, prog[o + 3]!]) if (i + 1 + j >= n) { console.log(arch, 'JUMP OUT OF RANGE at', i); bad++; } } }
  const nrs = new Set<number>([0, 1, 2, 3, 8, 53, 102, 113, 199, 198, 288, 281, 333, 326, 360, 359, 41, 425, 424, 426, 0x3fffffff, 0x40000000, 0x40000001, 0x4000007f, 0xffffffff, 0x7fffffff, a.sock, a.sp, a.sock + 1, a.sp - 1, a.sp + 1, ...a.extra]);
  for (let i = 0; i < 600; i++) nrs.add(i);
  const audits = [a.audit, 0, 0x40000003, 0xc000003e, a.audit ^ 0x80000000, a.audit ^ 0x40000000, a.audit ^ 1];
  for (const au of audits) for (const nr of nrs) for (const a0 of vals) for (const a1 of vals) {
    const got = run(prog, a.be, au, nr, [a0, a1, 0n, 0n]);
    let want: number;
    if (au !== a.audit) want = KILL;
    else if (nr >= 0x40000000) want = KILL;
    else if (nr === a.sock && lo(a0) === 1) want = EPERM;
    else if (a.sc && nr === 102 && lo(a0) === 1) want = EPERM;
    else if (a.scpair && nr === 102 && lo(a0) === 8) want = EPERM;
    else if (nr === a.sp && lo(a0) === 1 && (lo(a1) & 0xf) !== 1) want = EPERM;
    else if (a.extra.includes(nr)) want = EPERM;
    else want = ALLOW;
    checked++;
    if (got !== want) { bad++; if (bad < 30) console.log(`MISMATCH ${arch} audit=${au.toString(16)} nr=${nr} a0=${a0.toString(16)} a1=${a1.toString(16)} got=${got.toString(16)} want=${want.toString(16)}`); }
  }
  console.log(arch, 'instructions', n);
}
console.log('checked', checked, 'mismatches', bad);
