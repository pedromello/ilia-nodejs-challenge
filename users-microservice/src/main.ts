import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { VersioningType } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableVersioning(
    {
      type: VersioningType.URI,
      defaultVersion: '1',
    }
  )
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on Port: ${port}`);
}
bootstrap();
