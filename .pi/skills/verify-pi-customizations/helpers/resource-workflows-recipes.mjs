import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { seedGreetingCli, seedLibrary } from './resource-workflows-fixtures.mjs';

export async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function seedRecipe(kind, cwd, port, socket) {
  if (kind === 'cli') return seedGreetingCli(cwd);
  if (kind === 'library') return seedLibrary(cwd);
  if (kind === 'server' || kind === 'playwright') {
    const page = "<!doctype html><title>Greeting</title><button onclick=\"document.querySelector('output').textContent='Hello Ada'\">Greet Ada</button><output></output>";
    writeFileSync(
      join(cwd, 'server.mjs'),
      `import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
writeFileSync('server.pid', String(process.pid));
const server = createServer((request, response) => {
  appendFileSync('requests.jsonl', JSON.stringify({ url: request.url }) + '\\n');
  response.end(request.url === '/greet?name=Ada' ? 'Hello Ada\\n' : ${JSON.stringify(page)});
});
server.listen(${port}, '127.0.0.1', () => console.log('READY ${port}'));
setTimeout(() => server.close(), 60000).unref();
`,
    );
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'greeting-web', type: 'module', scripts: { start: 'node server.mjs' } }));
    writeFileSync(
      join(cwd, 'README.md'),
      `# Greeting ${kind}\nRun node server.mjs. It binds to 127.0.0.1:${port}. ${kind === 'server' ? 'Call /greet?name=Ada.' : 'Click Greet Ada in the browser and inspect its screenshot.'} Stop the process you started. It has no app dependencies. No downloads or external network are permitted.\n`,
    );
    return;
  }
  if (kind === 'tui') {
    writeFileSync(
      join(cwd, 'terminal.py'),
      `import sys, termios, tty, pathlib
old = termios.tcgetattr(sys.stdin)
try:
    tty.setraw(sys.stdin.fileno())
    print('Ready. Press s for settings, q to quit.', flush=True)
    while True:
        key = sys.stdin.read(1)
        if key == 's':
            pathlib.Path('interaction.txt').write_text('Settings enabled')
            print('\\r\\nSettings enabled', flush=True)
        if key == 'q':
            break
finally:
    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old)
`,
    );
    writeFileSync(
      join(cwd, 'README.md'),
      `# Greeting terminal\nRun python3 terminal.py in a terminal. Press s to enable settings. Press q to quit. For automation use only your owned tmux socket ${socket}. Capture the pane after pressing s. Do not use the default tmux socket or another session.\n`,
    );
    return;
  }
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'greeting-desktop', main: 'main.cjs', scripts: { start: 'electron .' }, dependencies: { electron: '*' } }));
  writeFileSync(join(cwd, 'main.cjs'), "const { app, BrowserWindow } = require('electron');\napp.whenReady().then(() => { const w = new BrowserWindow(); w.loadFile('index.html'); });\napp.on('window-all-closed', () => app.quit());\n");
  writeFileSync(join(cwd, 'index.html'), "<!doctype html><title>Greeting desktop</title><button onclick=\"document.querySelector('output').textContent='Hello Ada'\">Greet Ada</button><output></output>");
  writeFileSync(
    join(cwd, 'README.md'),
    '# Greeting desktop\nAn Electron app. Click Greet Ada and inspect a screenshot. Dependencies are not bundled here. Only use already-installed offline tools. No downloads or external network are permitted. Report missing prerequisites rather than simulating a window.\n',
  );
}
