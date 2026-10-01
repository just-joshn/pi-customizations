import filesystem from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { mock } from 'node:test';

export default function (pi) {
  pi.on('session_start', (_event, ctx) => {
    const directory = ctx.sessionManager.getSessionDir();
    const foreign = join(directory, 'other.jsonl');
    const receipt = join(directory, 'read-probe.json');
    const open = fs.open;
    const createReadStream = filesystem.createReadStream;
    mock.method(filesystem, 'createReadStream', (...args) => {
      const stream = createReadStream(...args);
      if (args[0] === foreign) {
        let maxReadEnd = 0;
        stream.on('data', (chunk) => {
          maxReadEnd += Buffer.byteLength(chunk);
        });
        stream.on('end', () => filesystem.writeFileSync(receipt, JSON.stringify({ maxReadEnd, bodyStreamCreated: true })));
      }
      return stream;
    });
    mock.method(fs, 'open', async (...args) => {
      const handle = await open(...args);
      if (args[0] !== foreign) return handle;
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      const stream = handle.createReadStream.bind(handle);
      let maxReadEnd = 0;
      let bodyStreamCreated = false;
      mock.method(handle, 'read', async (...values) => {
        const result = await read(...values);
        maxReadEnd = Math.max(maxReadEnd, Number(values[3]) + result.bytesRead);
        return result;
      });
      mock.method(handle, 'createReadStream', (...values) => {
        bodyStreamCreated = true;
        return stream(...values);
      });
      mock.method(handle, 'close', async () => {
        await fs.writeFile(receipt, JSON.stringify({ maxReadEnd, bodyStreamCreated }));
        return close();
      });
      return handle;
    });
    syncBuiltinESMExports();
  });
  pi.on('session_shutdown', () => {
    mock.restoreAll();
    syncBuiltinESMExports();
  });
}
