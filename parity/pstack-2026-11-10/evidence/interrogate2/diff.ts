import { seccompFilter } from '../../../../extensions/pi-pstack/src/linux-readonly-sandbox.ts';
// independent BPF interpreter (written separately from the test's)
type A = { audit: number; be: boolean; sock: number; pair: number; sc: boolean };
const A: Record<string, A> = {
  x64: { audit: 0xc000003e, be: false, sock: 41, pair: 53, sc: false },
  arm64: { audit: 0xc00000b7, be: false, sock: 198, pair: 199, sc: false },
  arm: { audit: 0x40000028, be: false, sock: 281, pair: 288, sc: true },
  ppc64: { audit: 0xc0000015, be: false, sock: 326, pair: 333, sc: true },
  s390x: { audit: 0x80000016, be: true, sock: 359, pair: 360, sc: true },
};
function run(prog: Buffer, be: boolean, d: Buffer): number {
  const r16 = (o: number) => (be ? prog.readUInt16BE(o) : prog.readUInt16LE(o));
  const r32 = (b: Buffer, o: number) => (be ? b.readUInt32BE(o) : b.readUInt32LE(o));
  let a = 0;
  const n = prog.length / 8;
  for (let pc = 0; pc < n; pc++) {
    const c = r16(pc * 8), jt = prog[pc * 8 + 2]!, jf = prog[pc * 8 + 3]!, k = r32(prog, pc * 8 + 4);
    if (c === 0x20) a = r32(d, k);
    else if (c === 0x15) pc += a === k ? jt : jf;
    else if (c === 0x35) pc += a >= k ? jt : jf;
    else if (c === 0x54) a = (a & k) >>> 0;
    else if (c === 0x06) return k;
    else throw new Error('op ' + c);
  }
  throw new Error('fell off');
}
const EPERM = 0x50001, ALLOW = 0x7fff0000;
function data(be: boolean, audit: number, nr: number, args: bigint[]) {
  const b = Buffer.alloc(64);
  const w32 = (v: number, o: number) => (be ? b.writeUInt32BE(v >>> 0, o) : b.writeUInt32LE(v >>> 0, o));
  w32(nr, 0); w32(audit, 4);
  args.forEach((v, i) => (be ? b.writeBigUInt64BE(v, 16 + i * 8) : b.writeBigUInt64LE(v, 16 + i * 8)));
  return b;
}
let bad = 0;
for (const [name, x] of Object.entries(A)) {
  const p = seccompFilter(name);
  const doms = [0n, 1n, 2n, 10n, 16n, 0x1_0000_0001n, 0x1_0000_0002n, 0xffff_ffffn, 0x8000_0001n];
  const types = [...Array(32).keys()].map(BigInt).concat([0x80000n, 0x800n, 0x80800n, 0x80801n, 0x80802n, 0x80805n, 0x1_0000_0001n, 0x1_0000_0002n, 0x1_0000_0000n, 0x10n, 0x11n, 0x100n, 0x101n, 0x81n, 0xffff_fff1n, 0xffff_fffn]);
  for (const dom of doms) for (const t of types) for (const proto of [0n, 1n, 6n]) {
    const got = run(p, x.be, data(x.be, x.audit, x.pair, [dom, t, proto, 0n, 0n, 0n]));
    // what the kernel would do with socketpair(domain, type): int truncation, flags = type & ~0xf must be subset of NONBLOCK|CLOEXEC
    const fam = Number(dom & 0xffff_ffffn), ty = Number(t & 0xffff_ffffn);
    const kernelValid = (ty & ~0xf & ~0x80800) === 0;
    const wantEperm = fam === 1 && (ty & 0xf) !== 1;
    const want = wantEperm ? EPERM : ALLOW;
    if (got !== want) { bad++; if (bad < 20) console.log('MISMATCH', name, 'dom', dom, 'type', t.toString(16), 'got', got.toString(16), 'want', want.toString(16), 'kernelValid', kernelValid); }
  }
  // socketcall
  if (x.sc) for (const call of [1, 8, 3, 11]) {
    const got = run(p, x.be, data(x.be, x.audit, 102, [BigInt(call), 0xdead0000n, 0n, 0n, 0n, 0n]));
    console.log(name, `socketcall(call=${call}${call === 1 ? ' SYS_SOCKET' : call === 8 ? ' SYS_SOCKETPAIR' : ''}, argsptr) ->`, got === EPERM ? 'EPERM' : got === ALLOW ? 'ALLOW' : got.toString(16));
  }
}
console.log('mismatches (direct socketpair, vs int-truncated kernel semantics):', bad);
