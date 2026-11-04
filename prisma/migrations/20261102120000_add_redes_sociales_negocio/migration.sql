-- =========================================================================
-- FASE 18: REDES SOCIALES POR NEGOCIO
-- =========================================================================
-- Compatible MySQL 8.0.46 with lower_case_table_names=0
-- =========================================================================

-- CreateTable
CREATE TABLE `redes_sociales_negocio` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `negocioId` INTEGER NOT NULL,
    `tipo` ENUM('TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'OTRO') NOT NULL,
    `nombre` VARCHAR(80) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `redes_sociales_negocio_negocioId_tipo_nombre_key`(`negocioId`, `tipo`, `nombre`),
    UNIQUE INDEX `redes_sociales_negocio_negocioId_id_key`(`negocioId`, `id`),
    INDEX `redes_sociales_negocio_negocioId_activo_orden_idx`(`negocioId`, `activo`, `orden`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `redes_sociales_negocio` ADD CONSTRAINT `redes_sociales_negocio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

