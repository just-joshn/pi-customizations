const mutations = [
  ['overwrite', 'fs.writeFileSync(target, "changed")'],
  ['append', 'fs.appendFileSync(target, "changed")'],
  ['truncate', 'fs.truncateSync(target, 0)'],
  ['unlink', 'fs.unlinkSync(target)'],
  ['rename', 'fs.renameSync(target, destination)'],
] satisfies [string, string][];

export const externalTempCases = ['com.google.Chrome', 'org.chromium.Chromium'].flatMap((browser) => mutations.map(([operation, statement]) => ({ browser, operation, statement })));
