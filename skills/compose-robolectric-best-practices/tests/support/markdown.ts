import { marked, type Token } from 'marked';

export interface CodeBlock {
  lang: string;
  // The whole fence info string, such as `kotlin compile-only`.
  info: string;
  code: string;
  line: number;
}

export interface ParsedMarkdown {
  frontmatter: string | undefined;
  links: string[];
  blocks: CodeBlock[];
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const FENCE = /^[ \t>]*(`{3,}|~{3,})/;

// Lines inside HTML comments (outside code fences). A fence written inside `<!-- -->` is not a fence, so it
// must not be counted when locating the next real one.
function htmlCommentLines(lines: readonly string[]): Set<number> {
  const inside = new Set<number>();
  let fence: string | undefined;
  let comment = false;
  lines.forEach((text, index) => {
    if (comment) {
      inside.add(index);
      comment = !text.includes('-->');
      return;
    }
    const marker = text.match(FENCE)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return;
    }
    if (marker !== undefined) {
      fence = marker;
      return;
    }
    if (/^[ \t]{0,3}<!--/.test(text)) {
      inside.add(index);
      comment = !text.slice(text.indexOf('<!--') + 4).includes('-->');
    }
  });
  return inside;
}

export function parseMarkdown(source: string): ParsedMarkdown {
  const fm = source.match(FRONTMATTER);
  const body = fm ? source.slice(fm[0].length) : source;
  const lineOffset = fm ? fm[0].split('\n').length - 1 : 0;
  const lines = body.split('\n');
  const links: string[] = [];
  const blocks: CodeBlock[] = [];
  const commented = htmlCommentLines(lines);
  let nextLine = 0;

  const fenceLine = (raw: string): number => {
    const at = lines.findIndex((text, index) => index >= nextLine && !commented.has(index) && FENCE.test(text));
    nextLine = at + raw.replace(/\n+$/, '').split('\n').length;
    return lineOffset + at + 1;
  };

  const visit = (tokens: readonly Token[]): void => {
    for (const token of tokens) {
      if (token.type === 'code') {
        const line = token.codeBlockStyle === 'indented' ? 0 : fenceLine(token.raw);
        blocks.push({ lang: (token.lang ?? '').split(/\s/)[0] ?? '', info: token.lang ?? '', code: token.text, line });
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
