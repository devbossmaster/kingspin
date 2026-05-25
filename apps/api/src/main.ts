import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:3000'],
    credentials: true,
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;

  await app.listen(port);

  console.log(`KingSpin API running on http://localhost:${port}`);
}

bootstrap();
