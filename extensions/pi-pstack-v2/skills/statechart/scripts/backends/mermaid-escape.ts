const BLANK = /\p{White_Space}/u;
const SAFE = /^[\p{L}\p{N} !'()+,\-./=?[\]"_|@{}:\\^%<>]$/u;
const HAZARD =
  /:(?=:|$|\S*#)|\\(?=n)|%(?=%)|<(?=[\p{L}/!?])|_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_/giu;
const DIRECTION = /(direction)\s+(?=LR|RL|TB|BT)/gi;
const DOUBLE_BRACKET = /\[(?=\[)/g;
const C4 = /C4(?=Container|Component|Dynamic|Deployment)/g;
const UNDRAWN = /[\0\x80-\x9f]/;
const REWRITTEN = ["ﬂ°", "¶ß"];
const MARKER = /(?<=marker-end=)"/g;
const firstOf = new Map<number, number>();
for (const pair of REWRITTEN) {
  const [first, second] = [...pair].map((c) => c.codePointAt(0) ?? 0);
  firstOf.set(second, first);
}
const KEPT = 0;
const BLANKED = 1;
const DROPPED = 2;
const CODED = 3;
const JOINS = 4;
const plainKind = (c: string) => {
  if (c === " ") return KEPT;
  if (BLANK.test(c)) return BLANKED;
  if (UNDRAWN.test(c)) return DROPPED;
  return SAFE.test(c) ? KEPT : CODED;
};
const kindOf = (n: number) => {
  const kind = plainKind(String.fromCodePoint(n));
  return firstOf.has(n) ? kind | JOINS : kind;
};
const ASCII = Uint8Array.from({ length: 128 }, (_, n) => kindOf(n));
const wide = new Map<number, number>();
const kindAt = (n: number) => {
  if (n < 128) return ASCII[n];
  let kind = wide.get(n);
  if (kind === undefined) wide.set(n, (kind = kindOf(n)));
  return kind;
};
const HIGH_SURROGATE = { from: 0xd800, to: 0xdbff };
const LOW_SURROGATE = { from: 0xdc00, to: 0xdfff };
const REPLACEMENT = 0xfffd;
const SUPPLEMENTARY = 0x10000;
const codePointAt = (s: string, i: number) => {
  const n = s.charCodeAt(i);
  if (n < HIGH_SURROGATE.from || n > LOW_SURROGATE.to) return { n, width: 1 };
  const low = s.charCodeAt(i + 1);
  if (n <= HIGH_SURROGATE.to && low >= LOW_SURROGATE.from && low <= LOW_SURROGATE.to)
    return {
      n: SUPPLEMENTARY + ((n - HIGH_SURROGATE.from) << 10) + (low - LOW_SURROGATE.from),
      width: 2,
    };
  return { n: REPLACEMENT, width: 1 };
};
const encode = (s: string, ref: (n: number) => string) => {
  let out = "";
  let run = 0;
  let last = -1;
  for (let i = 0; i < s.length;) {
    const start = i;
    const { n, width } = codePointAt(s, i);
    i += width;
    const kind = kindAt(n);
    if (kind === DROPPED) {
      out += s.slice(run, start);
      run = i;
      continue;
    }
    const joined = kind >= JOINS && firstOf.get(n) === last;
    const plain = kind & ~JOINS;
    last = n;
    if (!joined && plain === KEPT) continue;
    out += s.slice(run, start) + (joined ? ref(0x2060) : "");
    if (plain === KEPT) {
      run = start;
      continue;
    }
    out += plain === BLANKED ? " " : ref(n);
    run = i;
  }
  return out + s.slice(run);
};
export const code = (s: string, ref: (n: number) => string) =>
  encode(s, ref)
    .replace(MARKER, `${ref(0x2060)}"`)
    .replace(HAZARD, (c) => ref(c.charCodeAt(0)));
export const esc = (s: string, quoted = false) => {
  const plain = code(s, (n) => `#${n};`);
  const out = quoted ? plain.replaceAll('"', "#34;") : plain;
  if (!out.trim()) return "#32;";
  const turned = out.replace(DIRECTION, "$1#32;");
  const opened = turned.includes("[[") ? turned.replace(DOUBLE_BRACKET, "#91;") : turned;
  return opened.includes("C4") ? opened.replace(C4, "C#52;") : opened;
};
