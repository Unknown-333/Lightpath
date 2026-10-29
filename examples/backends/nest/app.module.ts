import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.ts';
import { OrdersService } from './orders.service.ts';

@Module({ controllers: [OrdersController], providers: [OrdersService] })
export class AppModule {}
