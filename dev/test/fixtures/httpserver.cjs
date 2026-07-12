// Test fixture: a minimal long-lived process used by ordering.test.mjs.
//   node httpserver.cjs <port>        → listens on <port> (becomes healthy)
//   node httpserver.cjs <port> idle   → stays alive but never opens the port
const port = Number(process.argv[2]);
const idle = process.argv[3] === 'idle';
if (!idle) {
  require('http')
    .createServer((_q, r) => r.end('ok'))
    .listen(port, () => console.log(`up on ${port}`));
}
setInterval(() => {}, 1e9);
