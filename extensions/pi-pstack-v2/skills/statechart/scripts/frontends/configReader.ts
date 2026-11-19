import { NAME, SECTIONS } from "./configSections.ts";
import type { Token } from "./configLex.ts";

const VALUE_LITERAL = /^(\d+|".*")$/;

export const configErrors = (file: string) => ({
  refuse: (line: number, words: string) =>
    new Error(`TLC refuses the config ${file} at line ${line}. ${words}`),
  cannot: (line: number, words: string) =>
    new Error(`The command cannot read the config ${file} at line ${line}. ${words}`),
});

/** A scanner over the config tokens that defers the first soft error. */
function makeScanner(file: string, tokens: Token[], end: number) {
  const eof: Token = { image: "", line: end };
  let at = 0;
  let deferred: Error | undefined;
  return {
    ...configErrors(file),
    eof,
    next: () => tokens[at++] ?? eof,
    defer: (error: Error) => (deferred ??= error),
    position: () => at,
    deferred: () => deferred,
  };
}

type Scanner = ReturnType<typeof makeScanner>;

const valueMessage = (t: Token) =>
  `TLC would read ${t.image} as a value. A value is a name, a number, a string, or a set in braces.`;

const makeChecks = ({ refuse, cannot, defer, next, eof }: Scanner) => {
  const defined = (t: Token, undefinedNoun: string | undefined) => {
    if (NAME.test(t.image)) return;
    defer(
      refuse(
        t.line,
        `The ${undefinedNoun} ${t.image} specified in the configuration file is not defined in the specification.`,
      ),
    );
  };
  const name = (t: Token, what: string) => {
    if (SECTIONS.has(t.image))
      defer(cannot(t.line, `TLC would read the keyword ${t.image} as ${what}.`));
    else if (!NAME.test(t.image))
      defer(cannot(t.line, `TLC would read ${t.image} as ${what}, and it is not a name.`));
  };
  const value = (t: Token): void => {
    if (t === eof) throw refuse(t.line, "It was expecting a value, but did not find it.");
    if (t.image === "{") {
      t = next();
      if (t.image === "}") return;
      value(t);
      while ((t = next()).image === ",") value(next());
      if (t.image !== "}") throw refuse(t.line, "It was expecting }, but did not find it.");
    } else if (SECTIONS.has(t.image))
      defer(cannot(t.line, `TLC would read the keyword ${t.image} as a value.`));
    else if (!NAME.test(t.image) && !VALUE_LITERAL.test(t.image))
      defer(cannot(t.line, valueMessage(t)));
  };
  return { defined, name, value };
};

type Checks = ReturnType<typeof makeChecks>;

const makeConstant = (c: Scanner, { name, value }: Checks) => {
  const { refuse, next, eof } = c;
  /** Reads `[ module ]` after the opening bracket; `open` names the text before it for errors. */
  const moduleBracket = (open: string) => {
    let t = next();
    if (t === eof) throw refuse(t.line, `Expected an identifier after ${open}.`);
    name(t, "a module name");
    t = next();
    if (t.image !== "]") throw refuse(t.line, "It was expecting ], but did not find it.");
    return next();
  };
  const replacement = () => {
    let t = next();
    if (t.image === "[") {
      t = moduleBracket("<-[");
      if (t === eof) throw refuse(t.line, "Expected an identifier after <-[mod].");
    } else if (t === eof) throw refuse(t.line, "Expected an identifier after <-.");
    name(t, "the name after <-");
  };
  const operatorArguments = (loc: number) => {
    value(next());
    let t = next();
    for (; t.image === ","; t = next()) value(next());
    if (t.image !== ")")
      throw refuse(
        loc,
        "TLC gives no reason here. An operator's arguments are one or more values in ( ), with commas between them.",
      );
    return next();
  };
  return (first: Token, loc: number) => {
    name(first, "a constant name");
    let t = next();
    for (; t.image === "!"; t = next()) name((t = next()), "a constant name");
    if (t.image === "<-") return replacement();
    if (t.image === "(") t = operatorArguments(loc);
    if (t.image !== "=") throw refuse(t.line, "It was expecting = or <-, but did not find it.");
    t = next();
    if (t.image === "[") t = moduleBracket("=[");
    value(t);
  };
};

export function makeReader(file: string, tokens: Token[], end: number) {
  const scanner = makeScanner(file, tokens, end);
  const checks = makeChecks(scanner);
  return { ...scanner, defined: checks.defined, constant: makeConstant(scanner, checks) };
}

export type Reader = ReturnType<typeof makeReader>;
