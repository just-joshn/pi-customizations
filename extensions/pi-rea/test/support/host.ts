import { onTestFinished, vi } from 'vitest';

export const stubHost = (platform: NodeJS.Platform, arch: string = process.arch): void => {
  const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue(arch as NodeJS.Architecture);
  onTestFinished(() => {
    platformSpy.mockRestore();
    archSpy.mockRestore();
  });
};
