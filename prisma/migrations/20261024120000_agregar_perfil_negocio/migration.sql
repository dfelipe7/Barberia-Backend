-- ===========================================================================
-- FASE 14: PERFIL DE MARCA Y UBICACIÓN POR NEGOCIO
-- ===========================================================================
--
-- Objetivo: que cada barbería tenga su propio contenido público (identidad
-- visual y ubicación) almacenado en la base de datos, de modo que la
-- personalización se pueda cambiar SIN tocar código ni volver a desplegar la
-- aplicación.
--
-- Qué hace (ADITIVA, en un solo paso):
--   1. Crea la tabla `perfiles_negocio`, con relación 1:1 OBLIGATORIA con
--      `negocios` (`negocioId` único): como máximo un perfil por barbería.
--   2. Añade la clave foránea `perfiles_negocio_negocioId_fkey` con
--      `ON DELETE CASCADE`: el perfil es contenido derivado del negocio y no
--      tiene sentido sin él.
--
-- Garantías:
--   1. NO modifica ni borra datos, índices ni claves existentes.
--   2. Un negocio puede existir SIN perfil: todas las columnas de marca y de
--      ubicación son NULABLES y la tabla solo nace cuando alguien la configura.
--   3. NO duplica el nombre ni el slug del negocio: se leen de `negocios`.
--   4. Las imágenes son REFERENCIAS (rutas o URLs). En la base de datos NO se
--      almacenan bytes, base64 ni archivos completos: la carga física de
--      archivos es una fase posterior.
--   5. La URL del mapa NO se guarda: se deriva de `latitud`/`longitud`, que
--      son la única fuente de verdad, para que no pueda desincronizarse.
--
-- NOTA SOBRE LOS ÍNDICES QUE EL DIFF DE PRISMA SUGIERE:
--   `migrate diff` también propone eliminar `BarberoServicio_servicioId_fkey`
--   y `barber_weekly_slots_barberoId_fkey`. NO se eliminan: son índices de
--   SOPORTE de las claves foráneas simples que la Fase 8 sustituyó por
--   compuestas, los crea el propio motor y no forman parte del esquema
--   declarado. Borrarlos sería un cambio ajeno a esta fase.
--
-- COMPATIBILIDAD: MySQL 8.0.46 con `lower_case_table_names = 0`.
--   El nombre real de la tabla es `perfiles_negocio` (minúsculas, como las
--   demás tablas mapeadas con `@@map`) y las columnas conservan el camelCase
--   del esquema.
-- ===========================================================================

-- CreateTable
CREATE TABLE `perfiles_negocio` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `negocioId` INTEGER NOT NULL,
    `frasePrincipal` VARCHAR(200) NULL,
    `faviconUrl` VARCHAR(500) NULL,
    `bannerUrl` VARCHAR(500) NULL,
    `logoBlancoUrl` VARCHAR(500) NULL,
    `logoNegroUrl` VARCHAR(500) NULL,
    `direccion` VARCHAR(200) NULL,
    `ciudad` VARCHAR(120) NULL,
    `departamento` VARCHAR(120) NULL,
    `referencia` VARCHAR(200) NULL,
    `latitud` DECIMAL(10, 7) NULL,
    `longitud` DECIMAL(10, 7) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `perfiles_negocio_negocioId_key`(`negocioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `perfiles_negocio` ADD CONSTRAINT `perfiles_negocio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
