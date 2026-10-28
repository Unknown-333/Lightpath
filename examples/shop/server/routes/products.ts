import type { Request, Response } from 'express';
import { allProducts } from '../db.ts';

export function listProducts(_req: Request, res: Response): void {
  res.json(allProducts());
}
