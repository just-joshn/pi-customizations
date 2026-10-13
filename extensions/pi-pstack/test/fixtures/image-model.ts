// Test-only Pi extension: an image model that returns a fixed 1x1 PNG, so codemode's models.generateImages() can run offline.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export default function imageModel(pi: ExtensionAPI): void {
  pi.registerProvider('testimg', {
    apiKey: 'unused',
    models: [{ type: 'image', id: 'painter', name: 'Painter', api: 'test-images', baseUrl: 'http://127.0.0.1:9', input: ['text'], output: ['image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    images: {
      'test-images': {
        generateImages: async (model) => ({ api: model.api, provider: model.provider, model: model.id, output: [{ type: 'image', data: PIXEL, mimeType: 'image/png' }], stopReason: 'stop', timestamp: Date.now() }),
      },
    },
  });
}
