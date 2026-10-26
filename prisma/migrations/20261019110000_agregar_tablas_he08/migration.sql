-- HE-08: horarios, bloqueos y cierres generales.
--
-- MOTIVO DE ESTA MIGRACIÓN (cierra el gap D-13 detectado en la auditoría):
-- los modelos `BarberWeeklySlot`, `BarberScheduleBlock` y `GeneralClosure`
-- existen en `prisma/schema.prisma` desde HE-08, pero NUNCA se creó una
-- migración que creara sus tablas. Una base de datos construida únicamente con
-- `prisma migrate deploy` quedaba sin esas tres tablas, y cualquier
-- migración posterior que las ALTERARA fallaba con "Table doesn't exist".
--
-- En la base de datos de desarrollo del proyecto las tablas sí existen
-- (creadas fuera del historial de migraciones), por lo que esta migración
-- DEBE ser idempotente: `CREATE TABLE IF NOT EXISTS` no falla si la tabla ya
-- está, y las claves foráneas solo se añaden si no existen.
--
-- Los nombres físicos respetan el `@@map` del esquema: `barber_weekly_slots`,
-- `barber_schedule_blocks` y `general_closures`.
--
-- Esta migración es ADITIVA: no modifica ni borra datos de las tablas
-- existentes.

-- CreateTable
CREATE TABLE IF NOT EXISTS `barber_weekly_slots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `barberoId` INTEGER NOT NULL,
    `dayOfWeek` ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY') NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `barber_weekly_slots_barberoId_dayOfWeek_startTime_key`(`barberoId`, `dayOfWeek`, `startTime`),
    INDEX `barber_weekly_slots_barberoId_fkey`(`barberoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `barber_schedule_blocks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `barberoId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `reason` ENUM('PERSONAL', 'MEDICAL', 'VACATION', 'OTHER') NULL,
    `notes` TEXT NULL,
    `status` ENUM('ACTIVE', 'REACTIVATED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `reactivatedAt` DATETIME(3) NULL,
    `reactivatedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `barber_schedule_blocks_barberoId_date_status_idx`(`barberoId`, `date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `general_closures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `startTime` VARCHAR(5) NULL,
    `endTime` VARCHAR(5) NULL,
    `allDay` BOOLEAN NOT NULL DEFAULT false,
    `reason` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `general_closures_date_active_idx`(`date`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
-- La clave foránea se añade solo si la tabla se acaba de crear: sobre una base
-- donde la tabla ya existía, la restricción ya está presente y volver a
-- nombrarla fallaría con "Duplicate foreign key constraint name".
SET @he08_slot_fk = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'barber_weekly_slots'
       AND CONSTRAINT_NAME = 'barber_weekly_slots_barberoId_fkey'
);
SET @he08_slot_sql = IF(@he08_slot_fk = 0,
    'ALTER TABLE `barber_weekly_slots` ADD CONSTRAINT `barber_weekly_slots_barberoId_fkey` FOREIGN KEY (`barberoId`) REFERENCES `Barbero`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
    'DO 0');
PREPARE he08_slot_stmt FROM @he08_slot_sql;
EXECUTE he08_slot_stmt;
DEALLOCATE PREPARE he08_slot_stmt;

SET @he08_block_fk = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'barber_schedule_blocks'
       AND CONSTRAINT_NAME = 'barber_schedule_blocks_barberoId_fkey'
);
SET @he08_block_sql = IF(@he08_block_fk = 0,
    'ALTER TABLE `barber_schedule_blocks` ADD CONSTRAINT `barber_schedule_blocks_barberoId_fkey` FOREIGN KEY (`barberoId`) REFERENCES `Barbero`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
    'DO 0');
PREPARE he08_block_stmt FROM @he08_block_sql;
EXECUTE he08_block_stmt;
DEALLOCATE PREPARE he08_block_stmt;
