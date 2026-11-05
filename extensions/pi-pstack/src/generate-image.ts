import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { detectSupportedImageMimeTypeFromFile, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export const GENERATE_IMAGE = 'GenerateImage';

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;
const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

// Cursor's GenerateImage description, as a live Cursor CLI session declared it.
const DESCRIPTION = [
  'Generate an image file from a text description.',
  '',
  'STRICT INVOCATION RULES (must follow):',
  '- Only use this tool when the user explicitly asks for an image. Do not generate images "just to be helpful".',
  '- Do not use this tool for data heavy visualizations such as charts, plots, tables.',
  '',
  'General guidelines:',
  '- Provide a concrete description first: subject(s), layout, style, colors, text (if any), and constraints. Use at least 6 words; descriptions of 3 words or fewer are rejected.',
  '- If the user requests an aspect ratio, set `aspect_ratio` to one of "1:1", "4:3", "3:4", "16:9", or "9:16".',
  '- If the user provides reference images, include them in `reference_image_paths`.',
  '- Do not repeat generated images as Markdown in your response; the client displays tool-generated images automatically.',
  '',
  'Examples that should call this tool:',
  '- user: "Generate an app icon for a note-taking app, minimal flat vector style." (explicitly requests an image asset)',
  '- user: "Make a UI mockup of a settings screen with a dark mode toggle." (explicitly requests a UI mockup)',
  '- user: "Generate an asset of a game character with a sword." (explicitly requests a visual asset)',
  '',
  'Examples that should not call this tool:',
  '- user: "Create a plan to refactor this module." (planning request; respond in text or mermaid diagram)',
  '- user: "Generate a chart of sales and revenue using data.csv." (data visualization; generate via code)',
].join('\n');

const Params = Type.Object({
  description: Type.String({ description: 'A detailed description of the image, at least 6 words. Descriptions of 3 words or fewer are rejected.' }),
  filename: Type.Optional(
    Type.String({
      description:
        "Optional filename for the generated image (e.g., 'diagram.png'). Do not include a directory path - the tool automatically handles where to save and how to display the image. If not provided, a timestamped filename will be generated.",
    }),
  ),
  reference_image_paths: Type.Optional(Type.Array(Type.String(), { description: 'Optional array of file paths to reference images as additional inputs.' })),
  aspect_ratio: Type.Optional(Type.Enum(ASPECT_RATIOS, { type: 'string', description: 'Optional aspect ratio for the generated image. Supported values are "1:1", "4:3", "3:4", "16:9", and "9:16".' })),
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
