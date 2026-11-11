import json, pathlib
evidence = pathlib.Path(__file__).resolve().parent.parent / 'evidence'
pi = json.loads((evidence / 'cursor-catalog-ids.json').read_text())
cli = [line.split(' - ')[0].strip() for line in (evidence / 'cursor-agent-list-models.txt').read_text().splitlines() if ' - ' in line]
print('pi', len(pi), 'cli', len(cli), 'only cli', sorted(set(cli) - set(pi)), 'only pi', sorted(set(pi) - set(cli)))
