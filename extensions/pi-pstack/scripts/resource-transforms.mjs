const word = /^[A-Z][a-z]/;
const lowerInitial = (part) => (word.test(part) ? part[0].toLowerCase() + part.slice(1) : part);

export function sentenceCaseHeadings(text) {
  return text.replace(/^(#{1,6} )(\S+)(.*)$/gm, (_match, hashes, first, rest) => {
    const lowered = rest
      .split(' ')
      .map((token) => token.split('-').map(lowerInitial).join('-'))
      .join(' ');
    const [head, ...tail] = first.split('-');
    return `${hashes}${[head, ...tail.map(lowerInitial)].join('-')}${lowered}`;
  });
}

export function tabIndentFences(text) {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line.replace(/^( {2})+/, (spaces) => '\t'.repeat(spaces.length / 2)) : line;
    })
    .join('\n');
}

export function pinLatest(text, lock) {
  const pins = Object.fromEntries([...lock.matchAll(/^ {4}"(bun-types|typescript)": \["[^@"]+@([^"]+)"/gm)].map((match) => [match[1], match[2]]));
  if (!pins['bun-types'] || !pins.typescript) throw new Error('bun.lock records no version for bun-types or typescript.');
  return text.replace(/"(bun-types|typescript)": "latest"/g, (_match, name) => `"${name}": "${pins[name]}"`);
}
