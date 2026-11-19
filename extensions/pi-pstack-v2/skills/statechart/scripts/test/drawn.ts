const shown = (text: string) => text.replace(/#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const nameOf = (names: ReadonlyMap<string, string>, id: string | undefined) =>
  names.get(id ?? "");

const parentOpens = (line: string) => line.match(/^ *state ".*" as (\w+) \{$/)?.[1];

const stackAfter = (stack: readonly string[], line: string) => {
  const opened = parentOpens(line);
  const next = opened === undefined ? stack : [...stack, opened];
  return /^ *\}$/.test(line) ? next.slice(0, -1) : next;
};

const arrowOf = (
  names: ReadonlyMap<string, string>,
  line: string,
  stack: readonly string[],
): string | undefined => {
  const m = line.match(/^ *(s\d+|\[\*\]) --> (s\d+)(?:: (.*))?$/);
  const parent = nameOf(names, stack.at(-1));
  if (!m || (m[1] === "[*]" && parent === undefined)) return undefined;
  const from = m[1] === "[*]" ? `${parent} start` : names.get(m[1]);
  return `${from} --> ${names.get(m[2])}${m[3] === undefined ? "" : `: ${shown(m[3])}`}`;
};

export const drawn = (chart: string) => {
  const names = new Map<string, string>();
  for (const m of chart.matchAll(/^ *(?:state "(.*)" as (s\d+) \{|(s\d+): (.*))$/gm))
    names.set(m[2] ?? m[3], shown(m[1] ?? m[4]));
  const walked = chart.split("\n").reduce(
    (acc, line) => {
      const stack = stackAfter(acc.stack, line);
      const arrow = arrowOf(names, line, stack);
      return { stack, arrows: arrow === undefined ? acc.arrows : [...acc.arrows, arrow] };
    },
    { stack: [] as readonly string[], arrows: [] as readonly string[] },
  );
  return { states: [...names.values()], arrows: [...walked.arrows] };
};
