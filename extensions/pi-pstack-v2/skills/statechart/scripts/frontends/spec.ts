import type { Config, ConfigSection, Spec } from "../ir.ts";
import { NAME } from "./config.ts";

const CHECK_KEYS = ["INVARIANT", "PROPERTY", "CHECK_DEADLOCK"];

export type Checks = Pick<Spec, "invariants" | "properties" | "deadlock" | "written">;

export function readChecks({ configFile, config }: { configFile: string; config: Config }): Checks {
  const refuse = (words: string) => new Error(`TLC refuses the config ${configFile}. ${words}`);
  if (config.spec && (config.init || config.next))
    throw refuse("The configuration file cannot specify both INIT/NEXT and SPECIFICATION fields.");
  if (!config.spec && !config.init)
    throw refuse("The configuration file did not specify the initial state predicate.");
  const written: ConfigSection[] = config.sections.filter((s) => !CHECK_KEYS.includes(s.key));
  return {
    invariants: config.invariants,
    properties: config.properties,
    deadlock: config.checkDeadlock !== false,
    written,
  };
}

type XmlNode = { tag: string; text: string; children: XmlNode[] };

const ENTITIES: { [name: string]: string } = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };

const decode = (text: string) =>
  text.replace(/&(#x?)?(\w+);/g, (_, number: string | undefined, name: string) =>
    number
      ? String.fromCodePoint(Number.parseInt(name, number === "#x" ? HEX_RADIX : DECIMAL_RADIX))
      : ENTITIES[name],
  );

const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;
const XML_TOKEN = /<(\/?)([^\s/>?!]+)[^>]*?(\/?)>|<[?!][^>]*>|([^<]+)/g;

/** Reads the content of one element, starting after its open tag; returns the node and the next token index. */
function readXmlNode(tokens: RegExpMatchArray[], from: number, tag: string): [XmlNode, number] {
  let text = "";
  let children: XmlNode[] = [];
  let at = from;
  while (at < tokens.length) {
    const [, close, name, empty, chars] = tokens[at++];
    if (chars !== undefined) text += decode(chars);
    else if (close) break;
    else if (name && empty) children = [...children, { tag: name, text: "", children: [] }];
    else if (name) {
      const [node, next] = readXmlNode(tokens, at, name);
      children = [...children, node];
      at = next;
    }
  }
  return [{ tag, text, children }, at];
}

const parseXml = (xml: string): XmlNode =>
  readXmlNode(Array.from(xml.matchAll(XML_TOKEN)), 0, "")[0];

const child = (node: XmlNode | undefined, tag: string) => node?.children.find((c) => c.tag === tag);
const textOf = (node: XmlNode | undefined, tag: string) => child(node, tag)?.text ?? "";

export type Sany = {
  variables: string[];
  definitions: Map<string, XmlNode>;
};

const VARIABLE_KIND = "3";

type Declaration = { uid: string; name: string; node: XmlNode };

const declarationsOf = (module: XmlNode | undefined, symbols: Map<string, XmlNode>) =>
  (module?.children ?? []).flatMap((ref): Declaration[] => {
    if (ref.tag !== "OpDeclNodeRef" && ref.tag !== "UserDefinedOpKindRef") return [];
    const uid = textOf(ref, "UID");
    const node = symbols.get(uid);
    return node ? [{ uid, name: textOf(node, "uniquename"), node }] : [];
  });

export function readSany(xml: string): Sany {
  const modules = child(parseXml(xml), "modules");
  const symbols = new Map<string, XmlNode>(
    (child(modules, "context")?.children ?? []).map((entry) => [textOf(entry, "UID"), entry.children[1]]),
  );
  const root = textOf(modules, "RootModule");
  const module = Array.from(symbols.values()).findLast(
    (node) => node.tag === "ModuleNode" && textOf(node, "uniquename") === root,
  );
  const declarations = declarationsOf(module, symbols);
  const definitions = new Map(declarations.map((d) => [d.name, d.node]));
  const variables = declarations
    .filter((d) => d.node.tag === "OpDeclNode" && textOf(d.node, "kind") === VARIABLE_KIND)
    .map((d) => ({ uid: Number(d.uid), name: d.name }))
    .toSorted((a, b) => a.uid - b.uid);
  return { variables: variables.map((v) => v.name), definitions };
}

export function readSpec({
  module,
  sany,
  checks,
}: {
  module: string;
  sany: Sany;
  checks: Checks;
}): Spec {
  return { module, variables: sany.variables, ...checks };
}

const STATE_LEVEL = 1;

const replacementsIn = ({ tokens }: ConfigSection): [string, string][] =>
  tokens.flatMap((token, i) =>
    i > 0 && i + 1 < tokens.length && token === "<-" && NAME.test(tokens[i + 1])
      ? [[tokens[i - 1], tokens[i + 1]] as [string, string]]
      : [],
  );

/** The `NAME <- REPLACEMENT` pairs of the CONSTANT sections, in file order. */
const constantReplacements = (written: ConfigSection[]) =>
  written.filter((s) => s.key === "CONSTANT").flatMap(replacementsIn);

export function initialOnlyProperties({ definitions }: Sany, { written, properties }: Spec) {
  const replaced = new Map(constantReplacements(written));
  return new Set(
    properties.filter((name) => {
      const definition = definitions.get(replaced.get(name) ?? name);
      return definition !== undefined && Number(textOf(definition, "level")) <= STATE_LEVEL;
    }),
  );
}
