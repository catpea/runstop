import http from 'http';
import { inspect } from 'util';

let server = null;
let port = null;
let clients = [];
let dumps = [];
let continueResolve = null;
let stopped = false;

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

      --fg: #877bdf;
      --bg: #4637ac;

      --bg-primary: var(--bg);
      --bg-secondary: var(--fg);

      --fg-primary: var(--fg);
      --fg-secondary: var(--bg);

      --button-bg: var(--bg);
      --button-fg: var(--fg);

      --code-fg: var(--fg);
      --code-bg: var(--bg);

    }
    @media (prefers-color-scheme: dark) {
      :root {

      --base03:    #002b36;
      --base02:    #073642;
      --base01:    #586e75;
      --base00:    #657b83;
      --base0:     #839496;
      --base1:     #93a1a1;

      --bg-primary: var(--base03);
      --bg-secondary: var(--base02);

      --fg-primary: var(--base0);
      --fg-secondary: var(--base1);

      --button-bg: var(--base03);
      --button-fg: var(--base0);

      --code-fg: var(--base0);
      --code-bg: var(--base03);

      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: monospace;
      background: var(--bg-primary);
      padding: 20px;
      line-height: 1.6;
    }

    header {
      color: var(--fg-secondary);
      background: var(--bg-secondary);
      margin-bottom: 20px;
      padding: 20px;
      border-radius: 4px;
    }

    main {
      color: var(--fg-secondary);
      background: var(--bg-secondary);
      padding: 20px;
      border-radius: 4px;
    }

    h1 {
      font-size: 1.5em;
      margin-bottom: 10px;
    }

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
      margin: 10px 0;
      padding: 10px;
      border-radius: 4px;
    }

    h2 { font-size: 1.2em; margin-bottom: 10px; }

    pre {
      color: var(--code-fg);
      background: var(--code-bg);
      padding: 15px;
      margin: 10px 0;
      overflow-x: auto;
      border-radius: 4px;
    }
    code {
      font-family: monospace;
    }

    .info {
      color: var(--fg-secondary);
      font-size: 0.9em;
    }
    .timestamp {
      color: var(--fg-secondary);
      font-size: 0.9em;
    }

  </style>
</head>
<body>
  <header>
    <h1>RUNSTOP</h1>
    <button id="runBtn" onclick="continueExecution()">RUN</button>
    <button id="stopBtn" onclick="stopServer()">STOP</button>
    <span id="status" class="info"></span>
  </header>
  <main id="dumps"></main>

  <script>
    const runBtn = document.getElementById('runBtn');
    const stopBtn = document.getElementById('stopBtn');
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

    function stopServer() {
      runBtn.disabled = true;
      stopBtn.disabled = true;
      status.textContent = 'Stopping server...';
      fetch('/stop', { method: 'POST' })
        .then(() => {
          status.textContent = 'Server stopped - execution continues without breaks';
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

    eventSource.addEventListener('stopped', () => {
      runBtn.disabled = true;
      stopBtn.disabled = true;
      status.textContent = 'Server stopped - execution continues without breaks';
      eventSource.close();
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
    else if (req.url === '/stop' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');

      stopped = true;

      // Resolve any pending continue
      if (continueResolve) {
        continueResolve();
        continueResolve = null;
      }

      // Notify all clients
      broadcast('stopped', {});

      // Close all client connections
      clients.forEach(client => {
        try {
          client.end();
        } catch (e) {}
      });
      clients = [];

      // Close server
      setTimeout(() => {
        server.close(() => {
          console.log('\n→ runstop: server stopped - execution continues\n');
        });
        server = null;
        port = null;
        dumps = [];
      }, 100);
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
  // If stopped, just return immediately without pausing
  if (stopped) {
    return;
  }

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
