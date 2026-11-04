import http from 'node:http';

// D-121: throws in a timer while a tagged request is in flight, so the process dies uncaught.
export function explode() {
  throw new TypeError('crash: total is not a number');
}

const server = http.createServer(() => {
  setTimeout(explode, 10);
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`ready ${server.address().port}\n`);
});
