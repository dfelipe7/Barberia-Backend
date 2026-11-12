const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const path = require('path');
const fs = require('fs');

async function exportOpenApi() {
  try {
    const { AppModule } = require('../dist/src/app.module');
    const app = await NestFactory.create(AppModule, { logger: false });
    
    const config = new DocumentBuilder()
      .setTitle('Barbería VIP API')
      .setDescription('Especificación formal OpenAPI v3.0 del backend Barbería VIP SaaS Multi-Tenant')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    const outputPath = path.resolve(__dirname, '../docs/api/openapi.json');
    fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf8');
    console.log(`[SUCCESS] OpenAPI JSON successfully written to ${outputPath}`);
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('[ERROR] Failed to export OpenAPI JSON:', err);
    process.exit(1);
  }
}

exportOpenApi();

