-- AlterTable
--
-- COMPATIBILIDAD MySQL 8.0 / MariaDB:
-- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` es sintaxis EXCLUSIVA de MariaDB:
-- MySQL 8.0 la rechaza con el error 1064 ("You have an error in your SQL
-- syntax"). Para que el historial sea aplicable en MySQL 8.0 se usa el mismo
-- patron idempotente que ya emplea la migracion `20261019110000` (consulta a
-- `information_schema` + `PREPARE`/`EXECUTE`): la columna solo se agrega si
-- todavia no existe.
SET @administrador_estado = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'Administrador'
       AND COLUMN_NAME = 'estado'
);
SET @administrador_estado_sql = IF(@administrador_estado = 0,
    'ALTER TABLE `Administrador` ADD COLUMN `estado` ENUM(''ACTIVO'', ''INACTIVO'') NOT NULL DEFAULT ''ACTIVO''',
    'DO 0');
PREPARE administrador_estado_stmt FROM @administrador_estado_sql;
EXECUTE administrador_estado_stmt;
DEALLOCATE PREPARE administrador_estado_stmt;

-- AlterTable
SET @barbero_fotourl = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'Barbero'
       AND COLUMN_NAME = 'fotoUrl'
);
SET @barbero_fotourl_sql = IF(@barbero_fotourl = 0,
    'ALTER TABLE `Barbero` ADD COLUMN `fotoUrl` VARCHAR(500) NULL',
    'DO 0');
PREPARE barbero_fotourl_stmt FROM @barbero_fotourl_sql;
EXECUTE barbero_fotourl_stmt;
DEALLOCATE PREPARE barbero_fotourl_stmt;

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
