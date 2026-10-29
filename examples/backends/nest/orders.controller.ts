import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import type { OrderLine } from '../shared/checkout.ts';
// A value import, not import type: emitDecoratorMetadata records the class for Nest's injector.
import { OrdersService } from './orders.service.ts';

interface OrderBody {
  lines?: OrderLine[];
  coupon?: string;
}

@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: OrderBody) {
    const result = this.orders.place(body.lines, body.coupon);
    if (!result.ok) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result.quote;
  }
}
