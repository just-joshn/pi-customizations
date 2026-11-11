import { marked, type Token } from 'marked';

export interface CodeBlock {
  lang: string;
  code: string;
  line: number;
}

export interface ParsedMarkdown {
  frontmatter: string | undefined;
  links: string[];
  blocks: CodeBlock[];
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

export function parseMarkdown(source: string): ParsedMarkdown {
  const fm = source.match(FRONTMATTER);
  const body = fm ? source.slice(fm[0].length) : source;
  const lineOffset = fm ? fm[0].split('\n').length - 1 : 0;
  const links: string[] = [];
  const blocks: CodeBlock[] = [];
  let cursor = 0;

  const visit = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'code') {
        const at = body.indexOf(token.raw, cursor);
        cursor = at + token.raw.length;
        const line = lineOffset + body.slice(0, at).split('\n').length;
        blocks.push({ lang: (token.lang ?? '').split(/\s/)[0] ?? '', code: token.text, line });
        continue;
      }
      if (token.type === 'link') links.push(token.href);
      if ('tokens' in token && token.tokens) visit(token.tokens);
      if (token.type === 'list') visit(token.items);
      if (token.type === 'table') {
        for (const cell of [...token.header, ...token.rows.flat()]) visit(cell.tokens);
      }
    }
  };
  visit(marked.lexer(body));

  return { frontmatter: fm?.[1], links, blocks };
}
