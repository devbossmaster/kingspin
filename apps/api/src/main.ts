import { parseApiEnv } from "@kingspin/env";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const env = parseApiEnv(process.env);
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: env.WEB_URL,
    credentials: true,
  });

  await app.listen(env.PORT);

  console.log(`KingSpin API running on http://localhost:${env.PORT}`);
}

bootstrap();
