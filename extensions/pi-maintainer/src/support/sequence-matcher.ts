/**
 * CPython 3.13 `difflib.SequenceMatcher`, ported method by method so the two read side by side.
 * Aider's fuzzy edit matching, file-name suggestions, and diffs depend on its exact matching
 * blocks and ratios, so the algorithm is reproduced, not approximated.
 */

/** Element types whose JavaScript `===` and `Map` key equality agree with Python's `==` and hashing. */
export type Hashable = string | number;

/** CPython's `isjunk`: true for an element the matcher must not synchronize on. */
export type JunkPredicate<T> = (element: T) => boolean;

/** CPython's `Match(a, b, size)`: `a[a:a+size]` equals `b[b:b+size]`. */
export interface Match {
  readonly a: number;
  readonly b: number;
  readonly size: number;
}

export type OpcodeTag = 'replace' | 'delete' | 'insert' | 'equal';

/** CPython's opcode tuple: `tag` turns `a[i1:i2]` into `b[j1:j2]`. */
export type Opcode = readonly [tag: OpcodeTag, i1: number, i2: number, j1: number, j2: number];

/** One group of `getGroupedOpcodes`, which is never empty. */
export type OpcodeGroup = readonly [...Opcode[], Opcode];

export interface SequenceMatcherOptions<T extends Hashable> {
  readonly isjunk?: JunkPredicate<T> | null;
  /** A string is compared code point by code point, the way Python indexes `str`. */
  readonly a?: Iterable<T>;
  readonly b?: Iterable<T>;
  readonly autojunk?: boolean;
}

const NOTHING: readonly number[] = [];

/** What CPython groups when there are no opcodes at all, so empty inputs yield no groups. */
const NO_OPCODES: readonly Opcode[] = [['equal', 0, 1, 0, 1]];

const calculateRatio = (matches: number, length: number): number => (length ? (2 * matches) / length : 1);

const isGroup = (codes: readonly Opcode[]): codes is OpcodeGroup => codes.length > 0;

/** The last `n` elements of an unchanged run, the context shown before a change. */
function contextBefore(code: Opcode, n: number): Opcode {
  const [tag, i1, i2, j1, j2] = code;
  return tag === 'equal' ? [tag, Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2] : code;
}

/** The first `n` elements of an unchanged run, the context shown after a change. */
function contextAfter(code: Opcode, n: number): Opcode {
  const [tag, i1, i2, j1, j2] = code;
  return tag === 'equal' ? [tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)] : code;
}

function changeTag(i: number, ai: number, j: number, bj: number): OpcodeTag | null {
  if (i < ai && j < bj) return 'replace';
  if (i < ai) return 'delete';
  if (j < bj) return 'insert';
  return null;
}

const compareMatches = (left: Match, right: Match): number => left.a - right.a || left.b - right.b || left.size - right.size;

/** Merges blocks that touch in both sequences, so adjacent blocks never describe adjacent equal runs. */
function collapseAdjacent(blocks: readonly Match[]): Match[] {
  const nonAdjacent: Match[] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const { a: i2, b: j2, size: k2 } of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
  return nonAdjacent;
}

function countElements<T>(elements: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  return counts;
}

export class SequenceMatcher<T extends Hashable> {
  readonly #isjunk: JunkPredicate<T> | null;
  readonly #autojunk: boolean;
  #a: readonly T[] = [];
  #b: readonly T[] = [];
  // `T | undefined` keys let findLongestMatch look up indexed reads, which TypeScript types as possibly undefined.
  #b2j: ReadonlyMap<T | undefined, readonly number[]> = new Map();
  #bjunk: ReadonlySet<T | undefined> = new Set();
  #fullbcount: ReadonlyMap<T, number> | null = null;
  #matchingBlocks: readonly Match[] | null = null;
  #opcodes: readonly Opcode[] | null = null;

  constructor({ isjunk = null, a = [], b = [], autojunk = true }: SequenceMatcherOptions<T> = {}) {
    this.#isjunk = isjunk;
    this.#autojunk = autojunk;
    this.setSeqs(a, b);
  }

  setSeqs(a: Iterable<T>, b: Iterable<T>): void {
    this.setSeq1(a);
    this.setSeq2(b);
  }

  setSeq1(a: Iterable<T>): void {
    this.#a = Array.from(a);
    this.#matchingBlocks = null;
    this.#opcodes = null;
  }

  setSeq2(b: Iterable<T>): void {
    this.#b = Array.from(b);
    this.#matchingBlocks = null;
    this.#opcodes = null;
    this.#fullbcount = null;
    this.#chainB();
  }

  /** Indexes `b`, then drops junk elements and, for 200 or more elements, those above 1% + 1 popularity. */
  #chainB(): void {
    const b2j = new Map<T, number[]>();
    for (const [i, elt] of this.#b.entries()) {
      const indices = b2j.get(elt);
      if (indices) indices.push(i);
      else b2j.set(elt, [i]);
    }
    const junk = new Set<T>();
    const isjunk = this.#isjunk;
    if (isjunk) {
      for (const elt of b2j.keys()) if (isjunk(elt)) junk.add(elt);
      for (const elt of junk) b2j.delete(elt);
    }
    const n = this.#b.length;
    if (this.#autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      const popular = [...b2j].filter(([, idxs]) => idxs.length > ntest).map(([elt]) => elt);
      for (const elt of popular) b2j.delete(elt);
    }
    this.#b2j = b2j;
    this.#bjunk = junk;
  }

  /**
   * The longest junk-free matching block in `a[alo:ahi]` and `b[blo:bhi]`, earliest in `a` and then
   * in `b` on ties, extended by equal non-junk and then junk elements on both ends.
   */
  findLongestMatch(alo = 0, ahi = this.#a.length, blo = 0, bhi = this.#b.length): Match {
    const [a, b, b2j, bjunk] = [this.#a, this.#b, this.#b2j, this.#bjunk];
    let [besti, bestj, bestsize] = [alo, blo, 0];
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i += 1) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? NOTHING) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) [besti, bestj, bestsize] = [i - k + 1, j - k + 1, k];
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && !bjunk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      [besti, bestj, bestsize] = [besti - 1, bestj - 1, bestsize + 1];
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && !bjunk.has(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    while (besti > alo && bestj > blo && bjunk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      [besti, bestj, bestsize] = [besti - 1, bestj - 1, bestsize + 1];
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && bjunk.has(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    return { a: besti, b: bestj, size: bestsize };
  }

  /** Matching blocks in ascending order, ending with the `(len(a), len(b), 0)` sentinel. */
  getMatchingBlocks(): readonly Match[] {
    if (this.#matchingBlocks !== null) return this.#matchingBlocks;
    const [la, lb] = [this.#a.length, this.#b.length];
    const queue: [alo: number, ahi: number, blo: number, bhi: number][] = [[0, la, 0, lb]];
    const matchingBlocks: Match[] = [];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      const [alo, ahi, blo, bhi] = next;
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const { a: i, b: j, size: k } = x;
      if (k) {
        matchingBlocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    this.#matchingBlocks = [...collapseAdjacent(matchingBlocks.toSorted(compareMatches)), { a: la, b: lb, size: 0 }];
    return this.#matchingBlocks;
  }

  /** The opcodes that turn `a` into `b`, each starting where the previous one ended. */
  getOpcodes(): readonly Opcode[] {
    if (this.#opcodes !== null) return this.#opcodes;
    let [i, j] = [0, 0];
    const answer: Opcode[] = [];
    for (const { a: ai, b: bj, size } of this.getMatchingBlocks()) {
      const tag = changeTag(i, ai, j, bj);
      if (tag) answer.push([tag, i, ai, j, bj]);
      [i, j] = [ai + size, bj + size];
      if (size) answer.push(['equal', ai, i, bj, j]);
    }
    this.#opcodes = answer;
    return answer;
  }

  /** Change clusters with up to `n` elements of context, the hunks of a unified diff. */
  getGroupedOpcodes(n = 3): OpcodeGroup[] {
    const opcodes = this.getOpcodes();
    const source = opcodes.length > 0 ? opcodes : NO_OPCODES;
    const codes = source.map((code, index) => {
      const leading = index === 0 ? contextBefore(code, n) : code;
      return index === source.length - 1 ? contextAfter(leading, n) : leading;
    });
    // CPython trims the cached opcode list in place, so a later getOpcodes() returns the trimmed edges.
    if (opcodes.length > 0) this.#opcodes = codes;
    const nn = n + n;
    const groups: OpcodeGroup[] = [];
    let group: Opcode[] = [];
    for (const code of codes) {
      const [tag, i1, i2] = code;
      if (tag === 'equal' && i2 - i1 > nn) {
        groups.push([...group, contextAfter(code, n)]);
        group = [contextBefore(code, n)];
      } else {
        group.push(code);
      }
    }
    if (isGroup(group) && !(group.length === 1 && group[0]?.[0] === 'equal')) groups.push(group);
    return groups;
  }

  /** `2 * matches / (len(a) + len(b))`, or 1 when both are empty. */
  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((sum, { size }) => sum + size, 0);
    return calculateRatio(matches, this.#a.length + this.#b.length);
  }

  /** An upper bound on `ratio()` that ignores order, treating `a` and `b` as multisets. */
  quickRatio(): number {
    const fullbcount = this.#fullbcount ?? countElements(this.#b);
    this.#fullbcount = fullbcount;
    const avail = new Map<T, number>();
    let matches = 0;
    for (const elt of this.#a) {
      const numb = avail.get(elt) ?? fullbcount.get(elt) ?? 0;
      avail.set(elt, numb - 1);
      if (numb > 0) matches += 1;
    }
    return calculateRatio(matches, this.#a.length + this.#b.length);
  }

  /** An upper bound on `ratio()` from the lengths alone. */
  realQuickRatio(): number {
    const [la, lb] = [this.#a.length, this.#b.length];
    return calculateRatio(Math.min(la, lb), la + lb);
  }
}
