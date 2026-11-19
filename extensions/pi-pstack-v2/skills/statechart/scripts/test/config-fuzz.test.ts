import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { configText } from "../backends/cfg.ts";
import { readConfig } from "../frontends/config.ts";
import { type Checks, readChecks } from "../frontends/spec.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const skip = !process.env.TLA2TOOLS && "set TLA2TOOLS to the path of tla2tools.jar to run TLC";
const SEED = 1;
const CONFIGS = 4000;
const KEYWORDS =
  "CONSTANT CONSTANTS CONSTRAINT CONSTRAINTS ACTION_CONSTRAINT ACTION_CONSTRAINTS INVARIANT INVARIANTS PROPERTY PROPERTIES INIT NEXT SPECIFICATION VIEW SYMMETRY TYPE TYPE_CONSTRAINT CHECK_DEADLOCK".split(
    " ",
  );
const ONE_NAME = ["INIT", "NEXT", "SPECIFICATION", "VIEW", "SYMMETRY", "TYPE", "TYPE_CONSTRAINT"];
const NAMES = [
  "Init",
  "Next",
  "Spec",
  "Inv",
  "TypeOK",
  "Live",
  "V",
  "x1",
  "_a",
  "INIT2",
  "Next_INIT",
];
const VALUES = [
  "0",
  "7",
  "TRUE",
  "m1",
  '"a b"',
  '"INVARIANT (* x"',
  '"\\\\* y *)"',
  '"\\""',
  "{}",
  "{1, 2}",
  '{"p", "q"}',
  "{m1, m2}",
];
const SPACES = [" ", " ", "\t", "  "];
const BREAKS = ["\n", "\n", "\r\n", "\r", "\n\n"];
const GAPS = [...SPACES, ...BREAKS, ""];
const ODD_SPACES = ["", "\u00a0", "\u2028", "\u2029", "\u0085"];
const COMMENTS = [
  "\\* CHECK_DEADLOCK FALSE\n",
  "\\* CHECK_DEADLOCK FALSE\r",
  "\\* CHECK_DEADLOCK FALSE\r\n",
  "(* CHECK_DEADLOCK FALSE *)",
  "(* (* INVARIANT Hidden *) CHECK_DEADLOCK FALSE *)",
  "(**)",
  '(* " *)',
];
const INSERTS = [
  "(* CHECK_DEADLOCK FALSE",
  "*)",
  '"open',
  ",",
  "=",
  "<-",
  "{",
  "1",
  "foo",
  "invariant",
  "ALIAS",
  "POSTCONDITION",
  "\\",
  '"a\\qb"',
];
const NAME = /^\w*[A-Za-z]\w*$/;
const MODEL = [
  "CONSTANT",
  "CONSTRAINT",
  "ACTION_CONSTRAINT",
  "INIT",
  "NEXT",
  "SPECIFICATION",
  "VIEW",
  "SYMMETRY",
  "TYPE",
  "TYPE_CONSTRAINT",
];

type Reading = { [key: string]: unknown };

const isRecord = (v: unknown): v is Reading =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const tableOf = (reading: Reading) => {
  if (!isRecord(reading.table)) throw new Error(`TLC printed no table: ${JSON.stringify(reading)}`);
  return reading.table;
};

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Token = { gap: string; text: string };
type Rng = { int: (n: number) => number; pick: <T>(list: T[]) => T };

const makeRng = (random: () => number): Rng => {
  const int = (n: number) => Math.floor(random() * n);
  return { int, pick: (list) => list[int(list.length)] };
};

const repeat = <T>(n: number, step: (acc: T) => T, init: T): T =>
  Array.from({ length: n }).reduce<T>((acc) => step(acc), init);

const insertAt = (tokens: Token[], at: number, added: Token[]) => [
  ...tokens.slice(0, at),
  ...added,
  ...tokens.slice(at),
];

const constantEntry = ({ pick }: Rng, spaced: (text: string) => Token): Token[] => {
  const form = pick(["=", "<-", "<-[M]"]);
  return [
    spaced(pick(["N", "K", "S"])),
    spaced(form.slice(0, 2)),
    ...(form === "<-[M]" ? [spaced("[M]")] : []),
    spaced(form === "=" ? pick(VALUES) : pick(NAMES)),
  ];
};

const section = (rng: Rng, key: string): Token[] => {
  const { int, pick } = rng;
  const head = { gap: pick(BREAKS), text: key };
  const spaced = (text: string) => ({ gap: pick(SPACES), text });
  if (key === "CHECK_DEADLOCK") return [head, spaced(pick(["TRUE", "FALSE"]))];
  if (ONE_NAME.includes(key)) return [head, spaced(pick(NAMES))];
  if (!key.startsWith("CONSTANT"))
    return [head, ...Array.from({ length: 1 + int(3) }, () => spaced(pick(NAMES)))];
  const count = 1 + int(2);
  return [head, ...Array.from({ length: count }, () => constantEntry(rng, spaced)).flat()];
};

const replaceAt = (tokens: Token[], index: number, next: Token) =>
  tokens.map((t, i) => (i === index ? next : t));

function typo({ int, pick }: Rng, t: Token): Token {
  const k = int(t.text.length);
  const text =
    t.text.slice(0, k) +
    pick(["", "E", "_", "0", ",", t.text[k] + t.text[k]]) +
    t.text.slice(k + 1);
  return { ...t, text };
}

function mutate(rng: Rng, tokens: Token[]): Token[] {
  const { int, pick } = rng;
  const kind = pick(["typo", "case", "space", "insert", "drop", "section"]);
  const index = int(tokens.length);
  const t = tokens[index];
  const at = int(tokens.length + 1);
  if (kind === "typo") return replaceAt(tokens, index, typo(rng, t));
  if (kind === "case") {
    const text = pick([t.text.toLowerCase(), t.text[0] + t.text.slice(1).toLowerCase()]);
    return replaceAt(tokens, index, { ...t, text });
  }
  if (kind === "space") return replaceAt(tokens, index, { ...t, gap: pick(ODD_SPACES) });
  if (kind === "insert") {
    const added = { gap: pick(GAPS), text: pick(pick([INSERTS, KEYWORDS])) };
    return insertAt(tokens, at, [added]);
  }
  if (kind === "drop" && tokens.length > 1)
    return tokens.filter((_, i) => i !== at % tokens.length);
  if (kind === "section") return insertAt(tokens, at, section(rng, pick(KEYWORDS)));
  return tokens;
}

function baseTokens(rng: Rng): Token[] {
  const { int, pick } = rng;
  const first = pick([["SPECIFICATION"], ["INIT", "NEXT"]]).flatMap((key) => section(rng, key));
  const withSections = repeat(
    int(4),
    (tokens) => {
      const at = pick([0, tokens.length]);
      return insertAt(tokens, at, section(rng, pick(KEYWORDS)));
    },
    first,
  );
  return repeat(
    int(3),
    (tokens) => {
      const at = int(tokens.length + 1);
      return insertAt(tokens, at, [{ gap: pick(GAPS), text: pick(COMMENTS) }]);
    },
    withSections,
  );
}

function generate(random: () => number) {
  const rng = makeRng(random);
  const base = baseTokens(rng);
  const mutations = rng.int(4);
  const tokens = repeat(mutations, (acc) => mutate(rng, acc), base);
  return { text: `${tokens.map((t) => t.gap + t.text).join("")}\n`, mutated: mutations > 0 };
}

function readInTlc(files: string[], jar: string) {
  const r = spawnSync(
    process.env.JAVA || "java",
    ["-cp", jar, path.join(here, "ConfigOracle.java")],
    { input: `${files.join("\n")}\n`, encoding: "utf8", maxBuffer: 1 << 30 },
  );
  assert.equal(r.status, 0, r.error?.message ?? r.stderr);
  const lines = r.stdout.split("\n");
  const readings = new Map<string, Reading>();
  for (let i = 0; i < files.length; i++) {
    const reading: unknown = JSON.parse(lines[i]);
    if (!isRecord(reading)) throw new Error(`TLC printed ${lines[i]}`);
    readings.set(files[i], reading);
  }
  return readings;
}

function passesTlcStartChecks(reading: Reading) {
  if (reading.error) return false;
  const table = tableOf(reading);
  for (const key of ["INVARIANT", "PROPERTY", "CONSTRAINT", "ACTION_CONSTRAINT"]) {
    const names: unknown = table[key];
    if (!Array.isArray(names)) throw new Error(`TLC printed no list for ${key}.`);
    for (const name of names) if (!NAME.test(String(name))) return false;
  }
  for (const key of ["INIT", "NEXT", "SPECIFICATION", "VIEW", "SYMMETRY"])
    if (table[key] && !NAME.test(String(table[key]))) return false;
  return table.SPECIFICATION ? !table.INIT && !table.NEXT : Boolean(table.INIT);
}

function model(reading: Reading | undefined) {
  if (!reading || reading.error) return reading;
  const { overrides, modConstants, modOverrides } = reading;
  const table = tableOf(reading);
  const out: Reading = { overrides, modConstants, modOverrides };
  for (const key of MODEL) out[key] = table[key];
  return out;
}

type Case = {
  i: number;
  text: string;
  mutated: boolean;
  skill: Checks | Error;
  file: string;
  written: string;
};

function readSkill(file: string, text: string, written: string): Checks | Error {
  try {
    const skill = readChecks({ configFile: file, config: readConfig({ file, text }) });
    fs.writeFileSync(written, configText(skill.written, []));
    return skill;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error;
  }
}

function buildCase(dir: string, random: () => number, i: number): Case {
  const { text, mutated } = generate(random);
  const file = path.join(dir, `${i}.cfg`);
  fs.writeFileSync(file, text);
  const written = path.join(dir, `${i}-written.cfg`);
  return { i, text, mutated, skill: readSkill(file, text, written), file, written };
}

function checkCase(c: Case, tlc: Map<string, Reading>) {
  const { i, text, mutated, skill, file, written } = c;
  const want = tlc.get(file);
  assert.ok(want, `TLC printed nothing for config ${i}`);
  const where = `config ${i} of seed ${SEED}: ${JSON.stringify(text)}\nTLC reads ${JSON.stringify(want)}`;
  if (skill instanceof Error) {
    if (skill.message.startsWith("TLC refuses"))
      assert.ok(!passesTlcStartChecks(want), `The skill says TLC refuses ${where}`);
    else
      assert.ok(
        mutated && skill.message.startsWith("The command cannot read"),
        `${skill.message}\n${where}`,
      );
    return;
  }
  assert.ok(passesTlcStartChecks(want), `The skill reads ${where}`);
  assert.deepEqual(
    {
      invariants: skill.invariants,
      properties: skill.properties,
      deadlock: skill.deadlock,
      model: model(tlc.get(written)),
    },
    {
      invariants: tableOf(want).INVARIANT,
      properties: tableOf(want).PROPERTY,
      deadlock: want.deadlock,
      model: model(want),
    },
    where,
  );
}

test(
  `${CONFIGS} configs from seed ${SEED} read in the skill as in TLC, or stop before TLC runs`,
  { skip },
  (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-config-fuzz-"));
    t.after(() => fs.rmSync(dir, { recursive: true }));
    const random = mulberry32(SEED);
    const cases = Array.from({ length: CONFIGS }, (_, i) => buildCase(dir, random, i));
    const files = cases.flatMap((c) => (c.skill instanceof Error ? [c.file] : [c.file, c.written]));
    const tlc = readInTlc(files, String(process.env.TLA2TOOLS));
    for (const c of cases) checkCase(c, tlc);
  },
);
