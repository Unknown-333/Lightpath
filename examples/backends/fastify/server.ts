// Fastify API, run directly with Node's type stripping: node fastify/server.ts
import Fastify from 'fastify';
import { checkout, type OrderLine } from '../shared/checkout.ts';

interface OrderBody {
  lines?: OrderLine[];
  coupon?: string;
}

const app = Fastify();

app.post<{ Body: OrderBody }>('/api/orders', async (request, reply) => {
  const result = checkout(request.body.lines, request.body.coupon);
  if (!result.ok) {
    return reply.code(result.status).send({ error: result.error });
  }
  return reply.code(201).send(result.quote);
});

await app.listen({ port: 3001, host: '127.0.0.1' });
console.log('fastify api listening on port 3001');
