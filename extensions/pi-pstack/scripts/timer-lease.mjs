import { createServer } from 'node:net';

export function holdTimerLease(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => resolve(server));
  });
}

export async function allocateTimerLease() {
  const server = await holdTimerLease(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Timer lease has no network address.');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
