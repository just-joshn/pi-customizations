const mutations = [
  ['overwrite', 'fs.writeFileSync(file, "changed")'],
  ['append', 'fs.appendFileSync(file, "changed")'],
  ['truncate', 'fs.truncateSync(file, 0)'],
  ['unlink', 'fs.unlinkSync(file)'],
  ['rename', 'fs.renameSync(file, destination)'],
] satisfies [string, string][];

export const externalTempCases = ['com.google.Chrome', 'org.chromium.Chromium'].flatMap((browser) => mutations.map(([operation, statement]) => ({ browser, operation, statement })));
