/*
  Warnings:

  - You are about to drop the column `nombre` on the `administrador` table. All the data in the column will be lost.
  - You are about to drop the column `apellido` on the `barbero` table. All the data in the column will be lost.
  - You are about to drop the column `nombre` on the `barbero` table. All the data in the column will be lost.
  - Added the required column `apellido` to the `Usuario` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nombre` to the `Usuario` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `administrador` DROP COLUMN `nombre`;

-- AlterTable
ALTER TABLE `barbero` DROP COLUMN `apellido`,
    DROP COLUMN `nombre`;

-- AlterTable
ALTER TABLE `usuario` ADD COLUMN `apellido` VARCHAR(191) NOT NULL,
    ADD COLUMN `nombre` VARCHAR(191) NOT NULL;
