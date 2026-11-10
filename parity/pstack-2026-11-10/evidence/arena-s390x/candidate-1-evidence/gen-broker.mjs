// Scratch stand-in for the TS change: ONE table row yields both the BPF program and the helper's --policy string.
import { writeFileSync } from 'node:fs';
const AF_UNIX = 1, SOCK_STREAM = 1, SOCK_TYPE_MASK = 0xf, SYS_SOCKET = 1, SYS_SOCKETPAIR = 8, NOTIF = 0x7fc00000;
const row = { audit: 0x80000016, le: false, socket: 359, socketpair: 360, socketcall: 102 };
const ins = [], labels = {};
const I = (code, jt, jf, k) => ins.push({ code, jt, jf, k }), at = (n) => (labels[n] = ins.length);
const ld = (o) => I(0x20, 0, 0, o), jeq = (k, t, f) => I(0x15, t, f, k), ret = (k) => I(0x06, 0, 0, k), and = (k) => I(0x54, 0, 0, k);
const arg = (n) => 16 + 8 * n + (row.le ? 0 : 4);
ld(4); jeq(row.audit, 'ok', 'kill'); at('ok'); ld(0);
jeq(row.socket, 's1', 'n1'); at('s1'); ld(arg(0)); jeq(AF_UNIX, 'eperm', 'allow'); at('n1'); ld(0);
jeq(row.socketpair, 'p1', 'n2'); at('p1'); ld(arg(0)); jeq(AF_UNIX, 'p2', 'allow'); at('p2'); ld(arg(1)); and(SOCK_TYPE_MASK); jeq(SOCK_STREAM, 'allow', 'eperm'); at('n2'); ld(0);
jeq(row.socketcall, 'c1', 'n3'); at('c1'); ld(arg(0)); jeq(SYS_SOCKET, 'notif', 'c2'); at('c2'); jeq(SYS_SOCKETPAIR, 'notif', 'allow'); at('n3'); ld(0);
jeq(425, 'eperm', 'allow');
at('allow'); ret(0x7fff0000); at('eperm'); ret(0x00050001); at('notif'); ret(NOTIF); at('kill'); ret(0x80000000);
const buf = Buffer.alloc(ins.length * 8);
ins.forEach((x, i) => { const r = (v) => typeof v !== 'string' ? v : labels[v] - i - 1; buf.writeUInt16BE(x.code, i * 8); buf.writeUInt32BE(x.k >>> 0, i * 8 + 4); buf.writeUInt8(r(x.jt), i * 8 + 2); buf.writeUInt8(r(x.jf), i * 8 + 3); });
writeFileSync(process.argv[2], buf);
console.log(`socketcall=${row.socketcall},socket=${SYS_SOCKET},socketpair=${SYS_SOCKETPAIR},unix=${AF_UNIX},stream=${SOCK_STREAM},typemask=${SOCK_TYPE_MASK}`);
