import * as path from 'node:path';

/** Whether value is root itself or lies under it. */
export const isInsideHostPath = (root: string, value: string): boolean => {
  const relativePath = path.relative(root, value);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
};
