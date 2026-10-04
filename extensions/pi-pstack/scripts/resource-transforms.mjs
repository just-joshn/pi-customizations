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
