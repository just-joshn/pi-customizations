import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const corpus = path.join(here, "corpus");
export const read = (file: string) => fs.readFileSync(file, "utf8");

type RunOptions = {
  args?: string[];
  view?: string;
  java?: string;
  command?: string[];
  env?: NodeJS.ProcessEnv;
};

const readConfigs = (log: string) =>
  Object.fromEntries(
    (fs.existsSync(log) ? read(log).split(/^## /m) : [])
      .filter((c) => c)
      .map((c) => [c.slice(0, c.indexOf("\n")), c]),
  ) as { [name: string]: string };

export function run(
  dir: string,
  {
    args = [],
    view = path.join(dir, "view.mjs"),
    java = path.join(here, "java.ts"),
    command = [process.execPath, path.join(here, "../statechart.ts")],
    env = {},
  }: RunOptions = {},
) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "statechart-cli-"));
  const out = path.join(tmp, "out");
  const log = path.join(tmp, "configs.log");
  const name = path.basename(dir);
  const [file, ...entry] = command;
  const r = spawnSync(
    file,
    [
      ...entry,
      path.join(dir, `${name}.tla`),
      ...(fs.existsSync(view) ? ["--view", view] : []),
      "--out",
      out,
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        JAVA: java,
        TLA2TOOLS: "tla2tools.jar",
        STATECHART_REPLAY: dir,
        STATECHART_LOG: log,
        ...env,
      },
    },
  );
  const files = fs.existsSync(out) ? fs.readdirSync(out).toSorted() : [];
  return {
    ...r,
    out,
    files,
    configs: readConfigs(log),
    report: files.includes("report.md") ? read(path.join(out, "report.md")) : "",
  };
}

export function copyCase(name: string, edit: (dir: string) => void = () => undefined) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-case-")), name);
  fs.cpSync(path.join(corpus, name), dir, { recursive: true });
  edit(dir);
  return dir;
}

export const writeView = (body: string) => {
  const view = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-view-")), "view.mjs");
  fs.writeFileSync(view, body);
  return view;
};

export const newPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "statechart-out-")), "out");
