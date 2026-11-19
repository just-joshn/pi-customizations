import path from "node:path";
import { plainText } from "./backends/plain-text.ts";
import type { Break } from "./frontends/verdict.ts";
import { LEVEL, type Mark, type Part, type Rule, type Stop } from "./ir.ts";
import { type FileResult, messagesOf, runChild } from "./run-io.ts";

const TLC_TOOL =
  "http:tla2tools[url=https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar,checksum=sha256:936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88]@1.7.4";
const JAVA_TOOL = "java@temurin-25";
export const PINNED_FLAGS = ["-workers", "1", "-fp", "0", "-lncheck", "final"];
const SANY_ERRORS = /^\*\*\* ?(?:Errors|Abort messages|Parse Error)/m;
const TAIL_CHARS = 1 << 28;
const TAIL_LINES = 30;
const ERROR_LINES = 40;
const BROKEN_EXITS = new Set([11, 12, 13]);

export async function findTlc(cwd: string) {
  const { TLA2TOOLS, JAVA } = process.env;
  if (TLA2TOOLS) return { jar: TLA2TOOLS, java: JAVA || "java" };
  const mise = (...args: string[]) =>
    runChild("mise", args, { cwd, env: { ...process.env, MISE_CEILING_PATHS: cwd } });
  const where = () =>
    Promise.all([mise("where", TLC_TOOL), mise("which", "java", "--tool", JAVA_TOOL)]);
  const first = await where();
  const found = first.some((r) => r.status !== 0) ? await install(mise, where) : first;
  return {
    jar: path.join(found[0].stdout.trim(), "tla2tools.jar"),
    java: JAVA || found[1].stdout.trim(),
  };
}

async function install(
  mise: (...args: string[]) => ReturnType<typeof runChild>,
  where: () => ReturnType<typeof Promise.all<ReturnType<typeof runChild>[]>>,
) {
  const r = await mise("install", JAVA_TOOL, TLC_TOOL);
  if (r.status !== 0)
    throw new Error(
      `Cannot find TLC: mise install failed: ${r.error?.message ?? r.stderr.trim()}\nOr set TLA2TOOLS to the path of tla2tools.jar, and JAVA to a java binary (Java 11 or later).`,
    );
  return where();
}

export const exitClass = (status: number | null) =>
  status === 0 ? 0 : status !== null && BROKEN_EXITS.has(status) ? 1 : 2;

export const tail = (r: FileResult) => {
  if (r.error) return r.error.message;
  let text = "";
  for (const chunk of plainText(messagesOf(r.output))) {
    text += chunk;
    if (text.length > 2 * TAIL_CHARS) text = text.slice(-TAIL_CHARS);
  }
  return text.trim().split("\n").slice(-TAIL_LINES).join("\n");
};

const firstLines = (text: string) => {
  const lines = text.trim().split("\n");
  const more = lines.length - ERROR_LINES;
  return (more > 0 ? [...lines.slice(0, ERROR_LINES), `... ${more} more lines`] : lines).join("\n");
};

const isError = (m: Part) =>
  typeof m !== "string" && (m.level === LEVEL.ERROR || m.level === LEVEL.TLCBUG);

function* errorsOf(messages: Iterable<Part>) {
  let seen = false;
  for (const m of messages) {
    if (typeof m === "string") continue;
    if (isError(m) || (seen && m.level === LEVEL.STATE)) {
      seen = true;
      yield m;
    }
  }
}

export const stopOf = (r: FileResult): Stop => {
  const errors = [...errorsOf(r.error ? [] : messagesOf(r.output))];
  if (!errors.length) return { status: r.status, message: tail(r) };
  return { status: r.status, message: firstLines([...plainText(errors)].join("")) };
};

export const sanyErrors = (r: FileResult) => {
  if (r.error) return undefined;
  const text = [...plainText(messagesOf(r.output))].join("");
  const at = text.search(SANY_ERRORS);
  return at === -1 ? undefined : firstLines(text.slice(at));
};

export const names = (rules: Rule[], kind: Rule["kind"]) =>
  rules.filter((rule) => rule.kind === kind).map((rule) => rule.name);

export const brokenRule = (rules: Rule[], broke: Break) => {
  if (broke.kind === "temporal") return undefined;
  const direct = rules.find(
    (rule) => rule.kind === broke.kind && (broke.kind === "deadlock" || rule.name === broke.name),
  );
  if (direct || broke.kind !== "invariant") return direct;
  return rules.find((rule) => rule.kind === "property" && rule.name === broke.name);
};

export function* only(marks: Iterable<Mark>, rules: Set<string>) {
  for (const { values, broken } of marks) {
    const kept = broken.filter((name) => rules.has(name));
    if (kept.length) yield { values, broken: kept };
  }
}
