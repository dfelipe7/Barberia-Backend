-- Multitenant (Fase 1): Ampliación ADITIVA del esquema.
--
-- NO EJECUTADA AUTOMÁTICAMENTE. Requiere autorización y una base real.
--
-- Objetivo de esta fase: incorporar la entidad `Negocio` (tenant) y la
-- entidad `ConfiguracionNegocio` (configuración operativa por negocio), y
-- añadir la columna `negocioId` ANULABLE a todos los modelos que passers a
-- pertenecer a un negocio. El script es puramente aditivo:
--
--   - No borra ni modifica columnas, índices o claves existentes.
--   - No cambia ninguna restricción única existente.
--   - No toca la columna generada `slotActivo` ni su índice único de
--     ocupación (`reservations_barberoId_date_startTime_slotActivo_key`).
--   - No aplica el backfill de datos (eso es la Fase 2, en otro script y
--     con reconciliación previa).
--
-- Precondiciones:
--   1) La migración `20261018130000_agregar_configuraciones_sistema` ya está
--      aplicada (o, más generalmente, el esquema vigente es el de `prisma/
--      migrations` en este repositorio antes de esta migración).
--   2) Las tablas destino existen y están vacías o contienen datos: todas las
--      columnas nuevas son NULLABLE, por lo que el script es seguro tanto si
--      hay filas como si la tabla está vacía.
--
-- Semántica de `negocioId` en esta fase:
--   - NULL significa "aún no asignado". Es el estado transitorio de TODOS los
--     registros preexistentes hasta que se ejecute el backfill de la Fase 2.
--   - `ON DELETE SET NULL` evita borrar datos operativos al eliminar un
--     negocio: se conserva el histórico y queda desasignado.
--   - En el endurecimiento final (Fase 8) la columna pasa a NOT NULL y se
--     añaden las claves foráneas compuestas que impiden mezclar negocios.
--
-- Decisiones reflejadas (ver docs/multitenant):
--   - `Negocio.slug` es el identificador PÚBLICO y estable con el que se
--     resuelve el negocio en cada petición. Es un `VARCHAR(63)` (límite de
--     longitud de etiqueta DNS, coherente con el uso como subdominio).
--   - `Negocio.zonaHoraria` fija `America/Bogota` por defecto, que es la zona
--     con la que hoy opera la lógica de fechas del proyecto.
--   - `configuraciones_negocio` replica el formato de `configuraciones_sistema`
--     (`valor` textual + `tipo`) para que la resolución del valor efectivo
--     pueda reutilizar el mismo validador, y se indexa por
--     `(negocioId, clave)` para que un negocio no pueda tener dos filas con la
--     misma clave.

-- CreateTable
CREATE TABLE `negocios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(63) NOT NULL,
    `nombre` VARCHAR(150) NOT NULL,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    `zonaHoraria` VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `negocios_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `configuraciones_negocio` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `negocioId` INTEGER NOT NULL,
    `clave` VARCHAR(100) NOT NULL,
    `valor` TEXT NOT NULL,
    `tipo` ENUM('TEXTO', 'NUMERO', 'BOOLEANO', 'JSON') NOT NULL DEFAULT 'TEXTO',
    `descripcion` VARCHAR(255) NULL,
    `editable` BOOLEAN NOT NULL DEFAULT true,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `configuraciones_negocio_negocioId_clave_key`(`negocioId`, `clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: columna de pertenencia al negocio (anulable en esta fase).
ALTER TABLE `Administrador` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `Barbero` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `Cliente` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `Servicio` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `BarberoServicio` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `barber_weekly_slots` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `barber_schedule_blocks` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `general_closures` ADD COLUMN `negocioId` INTEGER NULL;
ALTER TABLE `reservations` ADD COLUMN `negocioId` INTEGER NULL;

-- CreateIndex: soporte del filtro por negocio en las consultas.
CREATE INDEX `Administrador_negocioId_idx` ON `Administrador`(`negocioId`);
CREATE INDEX `Barbero_negocioId_idx` ON `Barbero`(`negocioId`);
CREATE INDEX `Cliente_negocioId_idx` ON `Cliente`(`negocioId`);
CREATE INDEX `Servicio_negocioId_idx` ON `Servicio`(`negocioId`);
CREATE INDEX `BarberoServicio_negocioId_idx` ON `BarberoServicio`(`negocioId`);
CREATE INDEX `barber_weekly_slots_negocioId_idx` ON `barber_weekly_slots`(`negocioId`);
CREATE INDEX `barber_schedule_blocks_negocioId_idx` ON `barber_schedule_blocks`(`negocioId`);
CREATE INDEX `general_closures_negocioId_idx` ON `general_closures`(`negocioId`);
CREATE INDEX `reservations_negocioId_idx` ON `reservations`(`negocioId`);

-- AddForeignKey
ALTER TABLE `Administrador` ADD CONSTRAINT `Administrador_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Barbero` ADD CONSTRAINT `Barbero_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Cliente` ADD CONSTRAINT `Cliente_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Servicio` ADD CONSTRAINT `Servicio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `BarberoServicio` ADD CONSTRAINT `BarberoServicio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `barber_weekly_slots` ADD CONSTRAINT `barber_weekly_slots_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `barber_schedule_blocks` ADD CONSTRAINT `barber_schedule_blocks_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `general_closures` ADD CONSTRAINT `general_closures_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `reservations` ADD CONSTRAINT `reservations_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `configuraciones_negocio` ADD CONSTRAINT `configuraciones_negocio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
