import type Anthropic from '@anthropic-ai/sdk';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { REQUEST_CONFIG } from '../request/config.ts';

export type UserContentBlock = Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam;

const mediaTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const sanitizeSurrogates = (text: string): string => text.replace(/[\uD800-\uDFFF]/g, '\uFFFD');

function parseMediaType(mimeType: string): Anthropic.Beta.BetaBase64ImageSource['media_type'] {
  try {
    const mediaType = mediaTypeSchema.parse(mimeType);
    return mediaType;
  } catch (error) {
    console.error('Unsupported image type:', error);
    throw new Error(`Anthropic does not accept ${mimeType} images. Use JPEG, PNG, GIF, or WebP.`, { cause: error });
  }
}

export function toUserBlock(item: TextContent | ImageContent): UserContentBlock {
  if (item.type === 'text') return { type: 'text', text: sanitizeSurrogates(item.text) };
  return { type: 'image', source: { type: 'base64', media_type: parseMediaType(item.mimeType), data: item.data } };
}

export function toToolResultContent(content: readonly (TextContent | ImageContent)[]): string | UserContentBlock[] {
  if (!content.some((item) => item.type === 'image')) {
    return sanitizeSurrogates(content.map((item) => (item.type === 'text' ? item.text : '')).join('\n'));
  }
  const blocks = content.map(toUserBlock);
  if (blocks.some((block) => block.type === 'text')) return blocks;
  return [{ type: 'text', text: REQUEST_CONFIG.imageOnlyPlaceholder }, ...blocks];
}
