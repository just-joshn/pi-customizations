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
// An opening fence, possibly indented inside a list item or prefixed by blockquote markers.
const FENCE = /^[ \t>]*(`{3,}|~{3,})/;

export function parseMarkdown(source: string): ParsedMarkdown {
  const fm = source.match(FRONTMATTER);
  const body = fm ? source.slice(fm[0].length) : source;
  const lineOffset = fm ? fm[0].split('\n').length - 1 : 0;
  const lines = body.split('\n');
  const links: string[] = [];
  const blocks: CodeBlock[] = [];
  let nextLine = 0;

  /** Fenced blocks appear in document order, so each one is the next opening fence after the previous block. */
  const fenceLine = (raw: string): number => {
    const at = lines.findIndex((text, index) => index >= nextLine && FENCE.test(text));
    nextLine = at + raw.replace(/\n+$/, '').split('\n').length;
    return lineOffset + at + 1;
  };

  const visit = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'code') {
        const line = token.codeBlockStyle === 'indented' ? 0 : fenceLine(token.raw);
        blocks.push({ lang: (token.lang ?? '').split(/\s/)[0] ?? '', code: token.text, line });
        continue;
      }
      if (token.type === 'link' || token.type === 'image') links.push(token.href);
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
