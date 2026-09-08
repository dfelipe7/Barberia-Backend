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

# Usamos db push para crear las tablas si no existen, y luego arrancamos
CMD ["sh", "-c", "npx prisma db push && npm run start:prod"]
