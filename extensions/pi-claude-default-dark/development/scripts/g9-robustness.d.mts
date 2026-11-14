export function runPi(
  name: string,
  options?: {
    themeText?: string;
    selected?: string;
    commands?: string[];
    installed?: boolean;
    colorTerm?: string | null;
  },
): Promise<{
  ready: boolean;
  error?: string;
  ansi: string;
  snapshots: string;
  refusedEgress: string[];
  nonLoopbackConnections: string[];
  term: string;
  COLORTERM: string;
  selected: string;
  installed: boolean;
}>;
