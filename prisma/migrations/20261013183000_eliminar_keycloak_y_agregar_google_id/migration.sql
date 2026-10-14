-- DropIndex
DROP INDEX `Usuario_keycloakId_key` ON `Usuario`;

-- AlterTable
ALTER TABLE `Usuario` DROP COLUMN `keycloakId`,
    ADD COLUMN `googleId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Usuario_googleId_key` ON `Usuario`(`googleId`);
