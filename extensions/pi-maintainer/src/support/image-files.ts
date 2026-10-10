import { basename as nativeBasename } from 'node:path';

/** `aider/utils.py` `IMAGE_EXTENSIONS`. */
const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.pdf'];

/** What `mimetypes.guess_type` returns for each image extension. */
const MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
  ['.tiff', 'image/tiff'],
  ['.webp', 'image/webp'],
  ['.pdf', 'application/pdf'],
]);

/** `aider/utils.py` `is_image_file`: a case-sensitive suffix test, so `SHOT.PNG` is not an image. */
export const isImageFile = (fileName: string): boolean => IMAGE_EXTENSIONS.some((extension) => fileName.endsWith(extension));

/**
 * `mimetypes.guess_type(path)[0]` for a path that `isImageFile` accepts.
 * Uses the host's `path.basename` so POSIX keeps literal backslashes and Windows splits on them.
 * Pass another basename (such as `path.win32.basename`) only in tests that emulate a foreign host.
 */
export function imageMimeType(filePath: string, basename: (value: string) => string = nativeBasename): string | null {
  const name = basename(filePath);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || !/[^.]+/.test(name.slice(0, dot))) return null;
  return MIME_TYPES.get(name.slice(dot).toLowerCase()) ?? null;
}
