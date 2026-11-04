import express from 'express';
import { listInvoices, payInvoice } from './routes/invoices.ts';

const app = express();
app.use(express.json());

app.get('/api/invoices', listInvoices);
app.post('/api/invoices/:id/pay', payInvoice);

const port = 3002;
app.listen(port, '127.0.0.1', () => {
  // No URL here on purpose: `lightpath dev` opens the first local URL it sees, which should be Vite's.
  console.log(`invoices api listening on port ${port}`);
});
