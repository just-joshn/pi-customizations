import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { detectSupportedImageMimeTypeFromFile, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export const GENERATE_IMAGE = 'GenerateImage';

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

// Cursor's GenerateImage rules: explicit requests only, no data charts, a concrete description, and no Markdown echo.
const DESCRIPTION = [
  'Generate an image file from a text description.',
  '',
  'Use this tool only when the user explicitly asks for an image; do not generate images just to be helpful. Do not use it for data-heavy visuals such as charts, plots, or tables; make those with code or the visualize tool.',
  '',
  'Describe the image concretely first: the subjects, layout, style, colors, any text, and constraints, in at least 6 words. A description of 3 words or fewer is rejected. Set aspect_ratio when the user asks for one, and pass reference images in reference_image_paths.',
  'The result shows the generated image and names the saved file, so do not repeat the image as Markdown in your reply.',
].join('\n');

const Params = Type.Object({
  description: Type.String({ description: 'A detailed description of the image, at least 6 words. Descriptions of 3 words or fewer are rejected.' }),
  filename: Type.Optional(Type.String({ description: "Optional file name for the image, such as 'diagram.png', without a directory. Defaults to a timestamped name." })),
  reference_image_paths: Type.Optional(Type.Array(Type.String(), { description: 'Optional paths of reference images to use as additional inputs.' })),
  aspect_ratio: Type.Optional(Type.Enum(ASPECT_RATIOS, { type: 'string', description: 'Optional aspect ratio: "1:1", "4:3", "3:4", "16:9", or "9:16".' })),
});

type ImageBlock = { type: 'image'; data: string; mimeType: string };

async function referenceImage(path: string, cwd: string): Promise<ImageBlock> {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  const mimeType = await detectSupportedImageMimeTypeFromFile(absolute);
  if (mimeType === null) throw new Error(`reference_image_paths: ${absolute} is not a PNG, JPEG, GIF, or WebP image.`);
  return { type: 'image', data: readFileSync(absolute).toString('base64'), mimeType };
}

/** The saved file name: the requested name without any directory, with the extension the image data has. */
export function imageFileName(requested: string | undefined, mimeType: string, index: number, now: Date): string {
  const extension = EXTENSIONS[mimeType] ?? '.png';
  const base = requested === undefined || basename(requested).trim() === '' ? `image-${now.toISOString().replace(/[:.]/g, '-')}` : basename(requested, extname(requested));
  return `${base}${index === 0 ? '' : `-${index + 1}`}${extension}`;
}

/** The first image model Pi can call with the configured credentials. */
async function imageModel(ctx: ExtensionContext) {
  const [model] = await ctx.modelRegistry.getAvailableOfType('image');
  return model;
}

/** Cursor's GenerateImage on Pi's image models, offered when one is available. Images save to the session's artifacts folder. */
export interface GenerateImageOptions {
  artifactsDir: (ctx: ExtensionContext) => string;
  /** False where the session may not write files: a readonly subagent, or plan mode. */
  mayOffer: () => boolean;
}

export function registerGenerateImage(pi: ExtensionAPI, options: GenerateImageOptions): void {
  pi.registerTool({
    name: GENERATE_IMAGE,
    label: 'Generate image',
    description: DESCRIPTION,
    promptSnippet: 'Generate an image file from a text description',
    parameters: Params,
    defaultActive: false,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.description.trim().split(/\s+/).length <= 3) throw new Error('Describe the image in at least 6 words. Descriptions of 3 words or fewer are rejected.');
      const model = await imageModel(ctx);
      if (model === undefined) throw new Error('No image model is available. Configure one, such as an OpenRouter image model, to generate images.');
      const references = await Promise.all((params.reference_image_paths ?? []).map((path) => referenceImage(path, ctx.cwd)));
      const text = params.aspect_ratio === undefined ? params.description.trim() : `${params.description.trim()}\n\nAspect ratio: ${params.aspect_ratio}.`;
      const result = await ctx.modelRegistry.generateImages(model, { input: [{ type: 'text', text }, ...references] }, signal === undefined ? undefined : { signal });
      if (result.stopReason !== 'stop') throw new Error(`Image generation failed: ${result.errorMessage ?? result.stopReason}`);
      const images = result.output.filter((block): block is ImageBlock => block.type === 'image');
      if (images.length === 0) throw new Error('The image model returned no image.');
      const dir = options.artifactsDir(ctx);
      mkdirSync(dir, { recursive: true });
      const now = new Date();
      const paths = images.map((image, index) => {
        const path = join(dir, imageFileName(params.filename, image.mimeType, index, now));
        writeFileSync(path, Buffer.from(image.data, 'base64'));
        return path;
      });
      return {
        content: [{ type: 'text' as const, text: `Generated ${paths.length === 1 ? 'an image' : `${paths.length} images`} with ${model.provider}/${model.id}, saved to ${paths.join(', ')}.` }, ...images],
        details: { paths, model: `${model.provider}/${model.id}` },
      };
    },
  });

  // The tool is on only while an image model is available, as Cursor offers GenerateImage only where it can run.
  pi.on('session_start', async (_event, ctx) => {
    if (!options.mayOffer() || (await imageModel(ctx)) === undefined) return;
    const active = pi.getActiveTools();
    if (!active.includes(GENERATE_IMAGE)) pi.setActiveTools([...active, GENERATE_IMAGE]);
  });
}
