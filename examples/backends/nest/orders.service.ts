import { Injectable } from '@nestjs/common';
import { type CheckoutResult, checkout, type OrderLine } from '../shared/checkout.ts';

@Injectable()
export class OrdersService {
  place(lines: OrderLine[] | undefined, coupon?: string): CheckoutResult {
    return checkout(lines, coupon);
  }
}
