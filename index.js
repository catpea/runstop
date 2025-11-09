import http from 'http';
import { inspect } from 'util';

let server = null;
let port = null;
let clients = [];
let dumps = [];
let continueResolve = null;

function findPort(start = 3000) {
  return new Promise((resolve, reject) => {
    const testServer = http.createServer();
    testServer.listen(start, () => {
      const { port } = testServer.address();
      testServer.close(() => resolve(port));
    });
    testServer.on('error', () => resolve(findPort(start + 1)));
  });
}

function generateHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>runstop</title>
  <style>
    :root {
      --bg: #fff;
      --fg: #000;
      --pre-bg: #f5f5f5;
      --button-bg: #0066cc;
      --button-fg: #fff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --fg: #e0e0e0;
        --pre-bg: #2a2a2a;
        --button-bg: #0088ff;
        --button-fg: #fff;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: monospace;
      background: var(--bg);
      color: var(--fg);
      padding: 20px;
      line-height: 1.6;
    }
    header {
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--fg);
    }
    h1 { font-size: 1.5em; margin-bottom: 10px; }
    button {
      background: var(--button-bg);
      color: var(--button-fg);
      border: none;
      padding: 10px 20px;
      font-family: monospace;
      font-size: 1em;
      cursor: pointer;
      border-radius: 4px;
    }
    button:hover { opacity: 0.8; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    section {
      margin: 20px 0;
      padding: 10px;
      border: 1px solid var(--fg);
    }
    h2 { font-size: 1.2em; margin-bottom: 10px; }
    pre {
      background: var(--pre-bg);
      padding: 15px;
      overflow-x: auto;
      border-radius: 4px;
    }
    code { font-family: monospace; }
    .timestamp { color: #888; font-size: 0.9em; }
  </style>
</head>
<body>
  <header>
    <h1>runstop</h1>
    <button id="runBtn" onclick="continueExecution()">Run</button>
    <span id="status" class="timestamp"></span>
  </header>
  <main id="dumps"></main>

  <script>
    const runBtn = document.getElementById('runBtn');
    const status = document.getElementById('status');
    const dumpsContainer = document.getElementById('dumps');
    let dumpCount = 0;

    function continueExecution() {
      runBtn.disabled = true;
      status.textContent = 'Running...';
      fetch('/continue', { method: 'POST' })
        .then(() => {
          status.textContent = 'Running...';
        });
    }

    const eventSource = new EventSource('/events');

    eventSource.addEventListener('dump', (e) => {
      const data = JSON.parse(e.data);
      dumpCount++;

      const section = document.createElement('section');
      section.innerHTML = \`
        <h2>Dump #\${data.index}</h2>
        <p class="timestamp">\${data.timestamp}</p>
        <pre><code>\${escapeHtml(data.content)}</code></pre>
      \`;

      dumpsContainer.appendChild(section);

      runBtn.disabled = false;
      status.textContent = 'Stopped - examine data and click Run to continue';

      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    eventSource.addEventListener('ready', () => {
      if (dumpCount > 0) {
        runBtn.disabled = false;
        status.textContent = 'Stopped - examine data and click Run to continue';
      } else {
        runBtn.disabled = true;
        status.textContent = 'Connected - waiting for first dump...';
      }
    });

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
}

async function startServer() {
  if (server) return;

  port = await findPort();

  server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(generateHTML());
    }
    else if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      clients.push(res);

      // Send all existing dumps to new client
      dumps.forEach(dump => {
        res.write(`event: dump\ndata: ${JSON.stringify(dump)}\n\n`);
      });

      res.write('event: ready\ndata: {}\n\n');

      req.on('close', () => {
        clients = clients.filter(client => client !== res);
      });
    }
    else if (req.url === '/continue' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');

      if (continueResolve) {
        continueResolve();
        continueResolve = null;
      }
    }
    else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port);
  console.log(`\n→ runstop: http://localhost:${port}\n`);
}

function inspectObjects(objects) {
  const lines = [];
  for (const [key, value] of Object.entries(objects)) {
    lines.push(`${key}:`);
    lines.push(inspect(value, { depth: 4, colors: false, maxArrayLength: 100 }));
    lines.push('');
  }
  return lines.join('\n');
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      // client disconnected
    }
  });
}

export default async function runstop(objects = {}) {
  await startServer();

  const content = inspectObjects(objects);
  const timestamp = new Date().toISOString();
  const dump = { index: dumps.length + 1, timestamp, content };

  dumps.push(dump);
  broadcast('dump', dump);

  // STOP here - wait for Run button click
  return new Promise((resolve) => {
    continueResolve = resolve;
  });
}
