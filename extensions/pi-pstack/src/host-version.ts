const parts = (version: string): number[] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? match.slice(1).map(Number) : undefined;
};

function isOlder(installed: number[] | undefined, tested: number[] | undefined): boolean {
  if (!installed || !tested) return true;
  const differing = installed.findIndex((part, index) => part !== tested[index]);
  return differing >= 0 && (installed[differing] ?? 0) < (tested[differing] ?? 0);
}

export function hostVersionNotice(installed: string, tested: string): string | undefined {
  return isOlder(parts(installed), parts(tested)) ? `pi-pstack was verified on Pi ${tested} or newer. This Pi is ${installed}, so behavior is unverified.` : undefined;
}
