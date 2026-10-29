// NestJS API. Decorators need a compiler, so it's built by tsc first, like `nest build`:
//   tsc -p tsconfig.nest.json && node dist/nest/main.js
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

try {
  // Nest's logger is off to keep test output short, so startup errors are printed here instead.
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(3001, '127.0.0.1');
  console.log('nest api listening on port 3001');
} catch (err) {
  console.error('nest api failed to start:', err);
  process.exit(1);
}
