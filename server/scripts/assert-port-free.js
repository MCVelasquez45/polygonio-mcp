// Runs automatically before `npm run dev` (see the `predev` script).
// Fails fast with a clear message when the API port is already taken, so
// ts-node-dev doesn't spawn a second instance that dies with EADDRINUSE.
require('dotenv').config();
const net = require('net');

const port = process.env.PORT ? Number(process.env.PORT) : 4000;

const tester = net
  .createServer()
  .once('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[DEV] Port ${port} is already in use — another backend instance is likely running.`);
      console.error(`[DEV] Find it with: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
      console.error('[DEV] Stop it, then re-run npm run dev.');
      process.exit(1);
    }
    throw err;
  })
  .once('listening', () => tester.close())
  .listen(port);
