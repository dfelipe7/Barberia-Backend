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

# Directorio de archivos subidos.
#
# En Docker debe ser un VOLUMEN PERSISTENTE (`UPLOADS_DIR`): el sistema de
# ficheros del contenedor es efímero. El volumen se monta EN ese punto.
RUN mkdir -p /app/uploads

EXPOSE 3000

# Arranque SEGURO: la aplicación NO modifica el esquema de la base de datos.
#
# Las migraciones se aplican de forma EXPLICITA (`npm run db:migrate`), nunca
# como parte del arranque. El comando anterior
# (`migrate deploy || db push --accept-data-loss || true`) ocultaba los fallos
# de migracion y podia DESCARTA DATOS de forma silenciosa: un fallo de
# conexion con MySQL acababa en un `db push` destructivo.
CMD ["npm", "run", "start:prod"]
