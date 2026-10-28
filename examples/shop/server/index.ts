import express from 'express';
import { createOrder } from './routes/orders.ts';
import { listProducts } from './routes/products.ts';

const app = express();
app.use(express.json());

app.get('/api/products', listProducts);
app.post('/api/orders', createOrder);

const port = 3001;
app.listen(port, '127.0.0.1', () => {
  // No URL here on purpose: `lightpath dev` opens the first local URL it sees, which should be Vite's.
  console.log(`shop api listening on port ${port}`);
});
