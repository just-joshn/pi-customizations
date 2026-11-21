import type Anthropic from '@anthropic-ai/sdk';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { parseOrThrow } from '../validation.ts';

export type UserContentBlock = Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam;

export const EPHEMERAL_CACHE = { type: 'ephemeral' } as const;

const IMAGE_ONLY_PLACEHOLDER = '(see attached image)';

const mediaTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const sanitizeSurrogates = (text: string): string => text.replace(UNPAIRED_SURROGATE, '\uFFFD');

export function toUserBlock(item: TextContent | ImageContent): UserContentBlock {
  if (item.type === 'text') return { type: 'text', text: sanitizeSurrogates(item.text) };
  const mediaType = parseOrThrow(mediaTypeSchema, item.mimeType, `Anthropic does not accept ${item.mimeType} images. Use JPEG, PNG, GIF, or WebP.`);
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: item.data } };
}

export function toToolResultContent(content: readonly (TextContent | ImageContent)[]): string | UserContentBlock[] {
  if (!content.some((item) => item.type === 'image')) {
    return sanitizeSurrogates(content.map((item) => (item.type === 'text' ? item.text : '')).join('\n'));
  }
  const blocks = content.map(toUserBlock);
  if (blocks.some((block) => block.type === 'text')) return blocks;
  return [{ type: 'text', text: IMAGE_ONLY_PLACEHOLDER }, ...blocks];
}
