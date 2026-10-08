export function surfaceContract(tsv, surfaceId) {
  const [header, ...lines] = tsv.trimEnd().split('\n');
  const columns = header.split('\t');
  for (const required of ['surface_id', 'expected', 'source']) {
    if (columns.filter((column) => column === required).length !== 1) {
      throw new Error(`Surface table requires one ${required} column`);
    }
  }
  const rows = lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, line.split('\t')[index]])));
  const matches = rows.filter((row) => row.surface_id === surfaceId);
  if (matches.length !== 1) throw new Error(`Surface table requires one row for ${surfaceId}`);
  const { expected, source } = matches[0];
  if (!expected || !source) throw new Error(`Surface ${surfaceId} requires expected behavior and source`);
  return { surfaceId, expected, source };
}
