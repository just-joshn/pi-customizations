import type { Config } from "../ir.ts";
import { tokenizeConfig, type Token } from "./configLex.ts";
import { configErrors, makeReader, type Reader } from "./configReader.ts";
import { isListField, type ListField, SECTIONS, type Section } from "./configSections.ts";

export { NAME } from "./configSections.ts";

type Step = { last: Token; config: Config };
type ScalarField = Exclude<NonNullable<Section["field"]>, ListField | "checkDeadlock">;

const EMPTY_CONFIG: Config = {
  sections: [],
  invariants: [],
  properties: [],
  constraints: [],
  actionConstraints: [],
};

const atSectionEnd = (r: Reader, t: Token) => t === r.eof || SECTIONS.has(t.image);

function* untilKeyword(r: Reader, each: (t: Token) => void): Generator<Token, Token> {
  let t = r.next();
  for (; !atSectionEnd(r, t); t = r.next()) {
    each(t);
    yield t;
  }
  return t;
}

/** Reads tokens up to the next keyword; returns them and the token that stopped the read. */
const readUntilKeyword = (r: Reader, each: (t: Token) => void) => {
  let last!: Token;
  const read = Array.from(
    (function* () {
      last = yield* untilKeyword(r, each);
    })(),
  );
  return { read, last };
};

const readList = (r: Reader, config: Config, field: ListField, noun?: string): Step => {
  const { read, last } = readUntilKeyword(r, (t) => r.defined(t, noun));
  const images = read.map((t) => t.image);
  return { last, config: { ...config, [field]: [...config[field], ...images] } };
};

const scalarValue = (r: Reader, keyword: Token, field: string, t: Token) => {
  if (t === r.eof)
    throw r.refuse(keyword.line, `The keyword ${keyword.image} was not followed by an identifier.`);
  if (field === "checkDeadlock" && t.image !== "TRUE" && t.image !== "FALSE")
    throw r.refuse(t.line, "It was expecting TRUE or FALSE, but did not find it.");
};

const readScalar = (r: Reader, config: Config, keyword: Token, section: Section): Step => {
  const { key, undefinedNoun } = section;
  const field = section.field as ScalarField | "checkDeadlock";
  const t = r.next();
  scalarValue(r, keyword, field, t);
  if (config[field] !== undefined)
    throw r.refuse(keyword.line, `The keyword ${keyword.image} appeared twice.`);
  if (field === "checkDeadlock")
    return { last: r.next(), config: { ...config, checkDeadlock: t.image === "TRUE" } };
  if (SECTIONS.has(t.image))
    r.defer(r.cannot(t.line, `TLC would read the keyword ${t.image} as the name after ${key}.`));
  else if (undefinedNoun) r.defined(t, undefinedNoun);
  return { last: r.next(), config: { ...config, [field]: t.image } };
};

const readSection = (r: Reader, config: Config, keyword: Token, section: Section): Step => {
  const { field, undefinedNoun } = section;
  if (field === undefined) {
    const { last } = readUntilKeyword(r, (t) => r.constant(t, keyword.line));
    return { last, config };
  }
  if (isListField(field)) return readList(r, config, field, undefinedNoun);
  return readScalar(r, config, keyword, section);
};

export function readConfig({ file, text }: { file: string; text: string }): Config {
  const { tokens, end } = tokenizeConfig(text, configErrors(file).cannot);
  const r = makeReader(file, tokens, end);
  let config = EMPTY_CONFIG;
  for (let t = r.next(); t !== r.eof;) {
    const keyword = t;
    const section = SECTIONS.get(keyword.image);
    if (!section) throw r.refuse(t.line, "It was expecting a keyword, but did not find it.");
    const begin = r.position();
    const step = readSection(r, config, keyword, section);
    const stop = step.last === r.eof ? tokens.length : r.position() - 1;
    const images = tokens.slice(begin, stop).map((token) => token.image);
    const entry = { key: section.key, line: keyword.line, tokens: images };
    config = { ...step.config, sections: [...config.sections, entry] };
    t = step.last;
  }
  const deferred = r.deferred();
  if (deferred) throw deferred;
  return config;
}
