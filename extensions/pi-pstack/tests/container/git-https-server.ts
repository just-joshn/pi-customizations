// A real git smart-HTTP server over TLS for the container tests: reads are open, pushes need the token, as on a forge.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { join } from 'node:path';

export interface GitServer {
  port: number;
  cert: string;
  /** Authorization headers of every receive-pack request: what the pushes sent. */
  pushes: string[];
  close: () => Promise<void>;
}

/** Serves every bare repository below `root`; `host` is the name or IPv4 address the certificate is valid for. */
export function startGitServer(root: string, dir: string, token: string, host: string): Promise<GitServer> {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${host}`, '-addext', `subjectAltName=${/^[\d.]+$/.test(host) ? 'IP' : 'DNS'}:${host}`], { stdio: 'ignore' });
  const pushes: string[] = [];
  const server: Server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://localhost');
    const push = url.pathname.endsWith('/git-receive-pack') || url.searchParams.get('service') === 'git-receive-pack';
    if (push) {
      const sent = request.headers.authorization ?? '';
      pushes.push(sent);
      if (sent !== `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`) {
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end();
        return;
      }
    }
    const backend = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: request.method ?? 'GET',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
        REMOTE_USER: push ? 'x-access-token' : '',
        REMOTE_ADDR: '127.0.0.1',
      },
    });
    request.pipe(backend.stdin);
    let head = Buffer.alloc(0);
    let sentHead = false;
    backend.stdout.on('data', (chunk: Buffer) => {
      if (sentHead) {
        response.write(chunk);
        return;
      }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      sentHead = true;
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head.subarray(0, end).toString('utf8').split('\r\n')) {
        const [name = '', ...value] = line.split(': ');
        if (name.toLowerCase() === 'status') status = Number.parseInt(value.join(': '), 10);
        else headers[name] = value.join(': ');
      }
      response.writeHead(status, headers);
      response.write(head.subarray(end + 4));
    });
    backend.stdout.on('end', () => response.end());
    backend.on('error', () => response.destroy());
  });
  return new Promise((resolveStart) => {
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolveStart({ port, cert, pushes, close: () => new Promise((resolveClose) => server.close(() => resolveClose())) });
    });
  });
}
