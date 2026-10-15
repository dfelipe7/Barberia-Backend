-- CreateTable
-- HE-04 (persistencia aprobada): reservas mínimas para que HE-08 detecte la
-- ocupación de franjas. `slotActivo` es una columna GENERATED (declarada en
-- schema.prisma como `Int? @db.TinyInt` para que Prisma no genere drift, pero la
-- expresión de generación solo existe aquí) que vale 1 cuando la reserva ocupa
-- la franja y NULL cuando está CANCELLED. El índice UNIQUE
-- (barberoId, date, startTime, slotActivo) impide el doble booking, pero al ser
-- NULL distinto de NULL permite varias reservas canceladas por franja y, por
-- tanto, la re-reserva. Validado en MySQL 8.0.46 / MariaDB.
CREATE TABLE `reservations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `barberoId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `dayOfWeek` ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY') NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `slotActivo` TINYINT GENERATED ALWAYS AS (CASE WHEN `status` <> 'CANCELLED' THEN 1 ELSE NULL END) VIRTUAL,

    INDEX `reservations_barberoId_date_status_idx`(`barberoId`, `date`, `status`),
    INDEX `reservations_barberoId_dayOfWeek_status_idx`(`barberoId`, `dayOfWeek`, `status`),
    UNIQUE INDEX `reservations_barberoId_date_startTime_slotActivo_key`(`barberoId`, `date`, `startTime`, `slotActivo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_barberoId_fkey` FOREIGN KEY (`barberoId`) REFERENCES `Barbero`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
