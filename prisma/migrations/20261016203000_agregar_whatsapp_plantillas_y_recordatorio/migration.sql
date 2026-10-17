-- AlterTable: Flag para evitar enviar recordatorios duplicados por cron
ALTER TABLE `reservations` ADD COLUMN `recordatorioEnviado` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: Plantillas editables de WhatsApp (Confirmación y Recordatorio)
CREATE TABLE `whatsapp_plantillas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(50) NOT NULL,
    `mensaje` TEXT NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `whatsapp_plantillas_tipo_key`(`tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
