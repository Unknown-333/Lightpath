import http from 'node:http';
import { handleOrder } from './handler.mjs';

const server = http.createServer((_req, res) => {
  const result = handleOrder({ items: [{ price: 5 }, { price: 7 }] });
  res.writeHead(result.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result));
  // Close after one request. If the agent kept the event loop alive, this process would hang.
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`ready ${server.address().port}\n`);
});
