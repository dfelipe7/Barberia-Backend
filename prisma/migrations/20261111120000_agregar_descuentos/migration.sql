-- ===========================================================================
-- HE-10-HU-02: DESCUENTOS POR PRODUCTO O SERVICIO
-- ===========================================================================
--
-- Migracion ADITIVA: crea la tabla `descuentos`. No modifica ni borra datos
-- existentes y no requiere backfill.
--
-- REGLAS:
--   - Un unico descuento por elemento y negocio. La unicidad la imponen los
--     indices `(negocioId, productoId)` y `(negocioId, servicioId)`.
--   - `productoId` y `servicioId` son mutuamente excluyentes. La aplicacion
--     lo garantiza al mapear `tipo` a una sola columna.
--   - `diasSemana` es JSON: arreglo de valores WeekDay validado y normalizado
--     por la aplicacion.
--
-- ROLLBACK:
--   ALTER TABLE `descuentos` DROP FOREIGN KEY `descuentos_negocioId_fkey`;
--   ALTER TABLE `descuentos` DROP FOREIGN KEY `descuentos_productoId_fkey`;
--   ALTER TABLE `descuentos` DROP FOREIGN KEY `descuentos_servicioId_fkey`;
--   DROP TABLE `descuentos`;
-- ===========================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS `descuentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `negocioId` INTEGER NOT NULL,
    `tipo` ENUM('PRODUCTO', 'SERVICIO') NOT NULL,
    `productoId` INTEGER NULL,
    `servicioId` INTEGER NULL,
    `porcentaje` DECIMAL(4, 2) NOT NULL,
    `diasSemana` JSON NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT false,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `descuentos_negocioId_productoId_key`(`negocioId`, `productoId`),
    UNIQUE INDEX `descuentos_negocioId_servicioId_key`(`negocioId`, `servicioId`),
    INDEX `descuentos_negocioId_tipo_idx`(`negocioId`, `tipo`),
    INDEX `descuentos_productoId_idx`(`productoId`),
    INDEX `descuentos_servicioId_idx`(`servicioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
SET @descuentos_negocio_fk = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'descuentos'
       AND CONSTRAINT_NAME = 'descuentos_negocioId_fkey'
);
SET @descuentos_negocio_fk_sql = IF(@descuentos_negocio_fk = 0,
    'ALTER TABLE `descuentos` ADD CONSTRAINT `descuentos_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'DO 0');
PREPARE descuentos_negocio_fk_stmt FROM @descuentos_negocio_fk_sql;
EXECUTE descuentos_negocio_fk_stmt;
DEALLOCATE PREPARE descuentos_negocio_fk_stmt;

-- AddForeignKey
SET @descuentos_producto_fk = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'descuentos'
       AND CONSTRAINT_NAME = 'descuentos_productoId_fkey'
);
SET @descuentos_producto_fk_sql = IF(@descuentos_producto_fk = 0,
    'ALTER TABLE `descuentos` ADD CONSTRAINT `descuentos_productoId_fkey` FOREIGN KEY (`productoId`) REFERENCES `productos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'DO 0');
PREPARE descuentos_producto_fk_stmt FROM @descuentos_producto_fk_sql;
EXECUTE descuentos_producto_fk_stmt;
DEALLOCATE PREPARE descuentos_producto_fk_stmt;

-- AddForeignKey
SET @descuentos_servicio_fk = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'descuentos'
       AND CONSTRAINT_NAME = 'descuentos_servicioId_fkey'
);
SET @descuentos_servicio_fk_sql = IF(@descuentos_servicio_fk = 0,
    'ALTER TABLE `descuentos` ADD CONSTRAINT `descuentos_servicioId_fkey` FOREIGN KEY (`servicioId`) REFERENCES `Servicio`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'DO 0');
PREPARE descuentos_servicio_fk_stmt FROM @descuentos_servicio_fk_sql;
EXECUTE descuentos_servicio_fk_stmt;
DEALLOCATE PREPARE descuentos_servicio_fk_stmt;

