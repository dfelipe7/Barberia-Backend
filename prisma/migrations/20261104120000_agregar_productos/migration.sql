-- ===========================================================================
-- HE-03-HU-01: PRODUCTOS DEL CATÁLOGO DE UN NEGOCIO
-- ===========================================================================
--
-- Migración ADITIVA: crea la tabla `productos` y su relación con `negocios`.
-- No modifica ni borra datos existentes y no requiere backfill.
--
-- DECISIÓN DE NEGOCIO APROBADA POR EL HUMANO:
--   `nombre` es único POR NEGOCIO (`negocioId`, `nombre`). Dos barberías
--   pueden repetir el nombre; una misma barbería no. El 409 por duplicado es
--   la señal de reintento; no se añade idempotencia por clave.
--
-- ROLLBACK:
--   ALTER TABLE `productos` DROP FOREIGN KEY `productos_negocioId_fkey`;
--   DROP TABLE `productos`;
-- ===========================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS `productos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(100) NOT NULL,
    `descripcion` TEXT NULL,
    `precio` DECIMAL(10, 2) NOT NULL,
    `imagenUrl` VARCHAR(500) NULL,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    `negocioId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `productos_negocioId_nombre_key`(`negocioId`, `nombre`),
    INDEX `productos_negocioId_idx`(`negocioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
SET @productos_negocio_fk = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'productos'
       AND CONSTRAINT_NAME = 'productos_negocioId_fkey'
);
SET @productos_negocio_fk_sql = IF(@productos_negocio_fk = 0,
    'ALTER TABLE `productos` ADD CONSTRAINT `productos_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'DO 0');
PREPARE productos_negocio_fk_stmt FROM @productos_negocio_fk_sql;
EXECUTE productos_negocio_fk_stmt;
DEALLOCATE PREPARE productos_negocio_fk_stmt;
