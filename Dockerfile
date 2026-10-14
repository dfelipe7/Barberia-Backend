FROM node:20-alpine

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci

# Copiar el resto del código y generar prisma
COPY . .
RUN npx prisma generate

# Compilar la aplicación
RUN npm run build

EXPOSE 3000

# Sincronizamos la base de datos y arrancamos en producción
CMD ["sh", "-c", "npx prisma migrate deploy || npx prisma db push --accept-data-loss || true; npm run start:prod"]
