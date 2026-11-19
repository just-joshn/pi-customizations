import { CHECK_DEADLOCK } from "../ir.ts";

export type ListField = "invariants" | "properties" | "constraints" | "actionConstraints";
export type Section = {
  key: string;
  plural?: string;
  field?:
    | ListField
    | "checkDeadlock"
    | "init"
    | "next"
    | "spec"
    | "view"
    | "symmetry"
    | "type"
    | "typeConstraint";
  undefinedNoun?: string;
};
export const isListField = (field: Section["field"]): field is ListField =>
  field === "invariants" ||
  field === "properties" ||
  field === "constraints" ||
  field === "actionConstraints";

const SECTION_LIST = [
  { key: "CONSTANT", plural: "CONSTANTS" },
  { key: CHECK_DEADLOCK, field: "checkDeadlock" },
  { key: "INIT", field: "init", undefinedNoun: "initial predicate" },
  { key: "NEXT", field: "next", undefinedNoun: "next state action" },
  { key: "SPECIFICATION", field: "spec", undefinedNoun: "name" },
  { key: "VIEW", field: "view", undefinedNoun: "view function" },
  { key: "SYMMETRY", field: "symmetry", undefinedNoun: "symmetry function" },
  { key: "TYPE", field: "type" },
  { key: "TYPE_CONSTRAINT", field: "typeConstraint" },
  { key: "INVARIANT", plural: "INVARIANTS", field: "invariants", undefinedNoun: "invariant" },
  { key: "PROPERTY", plural: "PROPERTIES", field: "properties", undefinedNoun: "property" },
  { key: "CONSTRAINT", plural: "CONSTRAINTS", field: "constraints", undefinedNoun: "constraint" },
  {
    key: "ACTION_CONSTRAINT",
    plural: "ACTION_CONSTRAINTS",
    field: "actionConstraints",
    undefinedNoun: "action constraint",
  },
] satisfies Section[];

export const SECTIONS = new Map<string, Section>(
  SECTION_LIST.flatMap((section: Section) => [
    [section.key, section] as const,
    ...(section.plural ? [[section.plural, section] as const] : []),
  ]),
);

export const NAME = /^\w*[A-Za-z]\w*$/;
