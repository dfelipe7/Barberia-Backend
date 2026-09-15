-- AlterTable
ALTER TABLE `administrador` ADD COLUMN IF NOT EXISTS `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO';

-- AlterTable
ALTER TABLE `barbero` ADD COLUMN IF NOT EXISTS `fotoUrl` VARCHAR(500) NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS `Servicio` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nombre` VARCHAR(100) NOT NULL,
    `descripcion` TEXT NULL,
    `precio` DECIMAL(10, 2) NOT NULL,
    `duracionMinutos` INTEGER NOT NULL,
    `fotoUrl` VARCHAR(500) NULL,
    `estado` ENUM('ACTIVO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Servicio_nombre_key`(`nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `BarberoServicio` (
    `barberoId` INTEGER NOT NULL,
    `servicioId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`barberoId`, `servicioId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BarberoServicio` ADD CONSTRAINT `BarberoServicio_barberoId_fkey` FOREIGN KEY (`barberoId`) REFERENCES `Barbero`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BarberoServicio` ADD CONSTRAINT `BarberoServicio_servicioId_fkey` FOREIGN KEY (`servicioId`) REFERENCES `Servicio`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
