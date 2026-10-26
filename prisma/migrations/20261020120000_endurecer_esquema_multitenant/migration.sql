-- ===========================================================================
-- FASE 8: ENDURECIMIENTO DEL ESQUEMA MULTITENANT
-- ===========================================================================
--
-- Objetivo: que la BASE DE DATOS impida las relaciones entre negocios
-- distintos, en lugar de que solo la aplicación las impida.
--
-- Qué hace, en este orden:
--   0) COMPROBACIÓN DE PRECONDICIONES. Si los datos no están listos, la
--      migración ABORTA ANTES de tocar nada (no hay cambios parciales).
--   1) `Usuario.rol` pasa a `SUPERADMIN | PERSONAL`. El rol global ya no
--      distingue administrador de barbero: los roles EFECTIVOS se derivan de
--      los perfiles (`Administrador` / `Barbero`) del negocio.
--   2) Las unicidades GLOBALES se sustituyen por unicidades POR NEGOCIO:
--      `Servicio(negocioId, nombre)`, `Cliente(negocioId, googleId)`,
--      `Cliente(negocioId, usuarioId)`, `Barbero(negocioId, usuarioId)` y
--      `Administrador(negocioId, usuarioId)`.
--   3) `negocioId` pasa a OBLIGATORIO en los nueve modelos tenant-scoped.
--   4) Las relaciones entre modelos tenant-scoped pasan a CLAVES FORÁNEAS
--      COMPUESTAS `(negocioId, id)`: la base de datos no puede vincular un
--      barbero, un servicio o un cliente de OTRO negocio.
--
-- Reglas que se conservan:
--   - `Usuario.email`, `Usuario.googleId` y `negocios.slug` siguen siendo
--     ÚNICOS GLOBALES.
--   - `Usuario` sigue siendo una identidad GLOBAL: las relaciones hacia
--     `Usuario` NO se vuelven compuestas (el usuario no pertenece a un
--     negocio; su PERFIL sí).
--   - El índice único de ocupación de reservas
--     `reservations_barberoId_date_startTime_slotActivo_key` y la columna
--     generada `slotActivo` NO se tocan: `CANCELLED` sigue liberando la
--     franja y `NO_SHOW` sigue ocupándola.
--   - `ON DELETE`: las referencias a `negocios` pasan de `SET NULL` a
--     `RESTRICT` (una columna NOT NULL no puede quedar en NULL). Retirar una
--     barbería se hace con `estado = INACTIVO`, que conserva el histórico.
--
-- REQUISITOS PREVIOS (ver MULTITENANT.md §11, "Liberación A"):
--   1. Las migraciones aditivas aplicadas y el negocio KYRIOS STUDIO
--      inicializado (`kyrios-studio`).
--   2. El BACKFILL ejecutado: ninguna fila tenant-scoped con `negocioId` NULL.
--   3. Reconciliación sin filas huérfanas.
-- Si alguna precondición falla, esta migración se detiene y NO modifica nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0) COMPROBACIÓN DE PRECONDICIONES
-- ---------------------------------------------------------------------------
-- Se usan tablas auxiliares con restricciones CHECK: si la condición no se
-- cumple, la inserción viola el CHECK y la migración ABORTA. La migración se
-- ejecuta sentencia a sentencia (Prisma no admite `DELIMITER`), así que la
-- guarda debe ser una única sentencia.

-- 0.1 Ningún modelo tenant-scoped puede tener filas sin negocio.
DROP TABLE IF EXISTS `_fase8_guardia_sin_negocio`;
CREATE TABLE `_fase8_guardia_sin_negocio` (
  `administrador` INT NOT NULL,
  `barbero` INT NOT NULL,
  `cliente` INT NOT NULL,
  `servicio` INT NOT NULL,
  `barbero_servicio` INT NOT NULL,
  `barber_weekly_slots` INT NOT NULL,
  `barber_schedule_blocks` INT NOT NULL,
  `general_closures` INT NOT NULL,
  `reservations` INT NOT NULL,
  CONSTRAINT `_fase8_sin_negocio_administrador` CHECK (`administrador` = 0),
  CONSTRAINT `_fase8_sin_negocio_barbero` CHECK (`barbero` = 0),
  CONSTRAINT `_fase8_sin_negocio_cliente` CHECK (`cliente` = 0),
  CONSTRAINT `_fase8_sin_negocio_servicio` CHECK (`servicio` = 0),
  CONSTRAINT `_fase8_sin_negocio_barbero_servicio` CHECK (`barbero_servicio` = 0),
  CONSTRAINT `_fase8_sin_negocio_barber_weekly_slots` CHECK (`barber_weekly_slots` = 0),
  CONSTRAINT `_fase8_sin_negocio_barber_schedule_blocks` CHECK (`barber_schedule_blocks` = 0),
  CONSTRAINT `_fase8_sin_negocio_general_closures` CHECK (`general_closures` = 0),
  CONSTRAINT `_fase8_sin_negocio_reservations` CHECK (`reservations` = 0)
);
INSERT INTO `_fase8_guardia_sin_negocio` (
  `administrador`, `barbero`, `cliente`, `servicio`, `barbero_servicio`,
  `barber_weekly_slots`, `barber_schedule_blocks`, `general_closures`, `reservations`
)
SELECT
  (SELECT COUNT(*) FROM `Administrador` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `Barbero` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `Cliente` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `Servicio` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `BarberoServicio` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `barber_weekly_slots` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `barber_schedule_blocks` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `general_closures` WHERE `negocioId` IS NULL),
  (SELECT COUNT(*) FROM `reservations` WHERE `negocioId` IS NULL);
DROP TABLE `_fase8_guardia_sin_negocio`;

-- 0.2 Ningún `negocioId` puede apuntar a un negocio inexistente.
DROP TABLE IF EXISTS `_fase8_guardia_huerfanas`;
CREATE TABLE `_fase8_guardia_huerfanas` (
  `referencias_huerfanas` INT NOT NULL,
  CONSTRAINT `_fase8_huerfanas` CHECK (`referencias_huerfanas` = 0)
);
INSERT INTO `_fase8_guardia_huerfanas` (`referencias_huerfanas`)
SELECT
  (SELECT COUNT(*) FROM `Administrador` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `Barbero` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `Cliente` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `Servicio` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `BarberoServicio` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `barber_weekly_slots` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `barber_schedule_blocks` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `general_closures` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL)
  + (SELECT COUNT(*) FROM `reservations` t LEFT JOIN `negocios` n ON n.`id` = t.`negocioId` WHERE t.`negocioId` IS NOT NULL AND n.`id` IS NULL);
DROP TABLE `_fase8_guardia_huerfanas`;

-- 0.3 Coherencia: un vínculo o una reserva no puede mezclar negocios.
--     Es la precondición que permite crear las claves foráneas compuestas.
DROP TABLE IF EXISTS `_fase8_guardia_coherencia`;
CREATE TABLE `_fase8_guardia_coherencia` (
  `incoherencias` INT NOT NULL,
  CONSTRAINT `_fase8_coherencia` CHECK (`incoherencias` = 0)
);
INSERT INTO `_fase8_guardia_coherencia` (`incoherencias`)
SELECT
  (SELECT COUNT(*) FROM `BarberoServicio` v
      JOIN `Barbero` b ON b.`id` = v.`barberoId`
      JOIN `Servicio` s ON s.`id` = v.`servicioId`
   WHERE b.`negocioId` <> v.`negocioId` OR s.`negocioId` <> v.`negocioId`)
  + (SELECT COUNT(*) FROM `reservations` r
      JOIN `Barbero` b ON b.`id` = r.`barberoId`
      JOIN `Servicio` s ON s.`id` = r.`servicioId`
      JOIN `Cliente` c ON c.`id` = r.`clienteId`
   WHERE b.`negocioId` <> r.`negocioId`
      OR s.`negocioId` <> r.`negocioId`
      OR c.`negocioId` <> r.`negocioId`)
  + (SELECT COUNT(*) FROM `barber_weekly_slots` f
      JOIN `Barbero` b ON b.`id` = f.`barberoId`
   WHERE b.`negocioId` <> f.`negocioId`)
  + (SELECT COUNT(*) FROM `barber_schedule_blocks` f
      JOIN `Barbero` b ON b.`id` = f.`barberoId`
   WHERE b.`negocioId` <> f.`negocioId`);
DROP TABLE `_fase8_guardia_coherencia`;

-- 0.4 No puede haber duplicados en las nuevas unicidades por negocio.
DROP TABLE IF EXISTS `_fase8_guardia_duplicados`;
CREATE TABLE `_fase8_guardia_duplicados` (
  `duplicados` INT NOT NULL,
  CONSTRAINT `_fase8_duplicados` CHECK (`duplicados` = 0)
);
INSERT INTO `_fase8_guardia_duplicados` (`duplicados`)
SELECT
  (SELECT COUNT(*) FROM (SELECT `negocioId`, `nombre` FROM `Servicio` GROUP BY `negocioId`, `nombre` HAVING COUNT(*) > 1) d)
  + (SELECT COUNT(*) FROM (SELECT `negocioId`, `googleId` FROM `Cliente` WHERE `googleId` IS NOT NULL GROUP BY `negocioId`, `googleId` HAVING COUNT(*) > 1) d)
  + (SELECT COUNT(*) FROM (SELECT `negocioId`, `usuarioId` FROM `Cliente` WHERE `usuarioId` IS NOT NULL GROUP BY `negocioId`, `usuarioId` HAVING COUNT(*) > 1) d)
  + (SELECT COUNT(*) FROM (SELECT `negocioId`, `usuarioId` FROM `Barbero` GROUP BY `negocioId`, `usuarioId` HAVING COUNT(*) > 1) d)
  + (SELECT COUNT(*) FROM (SELECT `negocioId`, `usuarioId` FROM `Administrador` GROUP BY `negocioId`, `usuarioId` HAVING COUNT(*) > 1) d);
DROP TABLE `_fase8_guardia_duplicados`;

-- ---------------------------------------------------------------------------
-- 1) ROL GLOBAL: `SUPERADMIN | PERSONAL`
-- ---------------------------------------------------------------------------
-- Primero se MIGRAN los valores: si se alterase el tipo de la columna antes,
-- los valores 'ADMINISTRADOR' y 'BARBERO' dejarían de existir y el UPDATE
-- fallaría.
UPDATE `Usuario` SET `rol` = 'PERSONAL' WHERE `rol` IN ('ADMINISTRADOR', 'BARBERO');
ALTER TABLE `Usuario` MODIFY COLUMN `rol` ENUM('SUPERADMIN', 'PERSONAL') NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) UNICIDADES POR NEGOCIO
-- ---------------------------------------------------------------------------
-- 2.1 Índices únicos COMPUESTOS: son el destino de las claves foráneas
--     compuestas que impedirán mezclar negocios.
CREATE UNIQUE INDEX `Barbero_negocioId_id_key` ON `Barbero`(`negocioId`, `id`);
CREATE UNIQUE INDEX `Servicio_negocioId_id_key` ON `Servicio`(`negocioId`, `id`);
CREATE UNIQUE INDEX `Cliente_negocioId_id_key` ON `Cliente`(`negocioId`, `id`);

-- 2.2 Se retiran las unicidades GLOBALES de los perfiles y del catálogo.
--     `Usuario.email`, `Usuario.googleId` y `negocios.slug` NO se tocan: la
--     identidad de la persona y el slug del negocio son globales.
--
--     Los índices únicos de `usuarioId` SOSTIENEN una clave foránea: no se
--     pueden suprimir sin quitar antes la FK (el motor lo rechaza). Por eso la
--     FK se suprime, el índice se elimina y la FK se vuelve a declarar (el
--     motor crea entonces un índice NO único, suficiente para la FK).
ALTER TABLE `Cliente` DROP FOREIGN KEY `Cliente_usuarioId_fkey`;
ALTER TABLE `Barbero` DROP FOREIGN KEY `Barbero_usuarioId_fkey`;
ALTER TABLE `Administrador` DROP FOREIGN KEY `Administrador_usuarioId_fkey`;

--     Los nombres de índice se escriben en minúsculas: MySQL/MariaDB los
--     almacena en minúsculas cuando el servidor tiene
--     `lower_case_table_names=1` (Windows) y los compara sin distinguir
--     mayúsculas, de modo que el mismo `DROP INDEX` funciona en ambos modos.
DROP INDEX `servicio_nombre_key` ON `Servicio`;
DROP INDEX `cliente_googleId_key` ON `Cliente`;
DROP INDEX `cliente_usuarioId_key` ON `Cliente`;
DROP INDEX `barbero_usuarioId_key` ON `Barbero`;
DROP INDEX `administrador_usuarioId_key` ON `Administrador`;

ALTER TABLE `Cliente` ADD CONSTRAINT `Cliente_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Barbero` ADD CONSTRAINT `Barbero_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Administrador` ADD CONSTRAINT `Administrador_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2.3 Unicidades por negocio: dos barberías pueden compartir nombre de
--     servicio o identidad de Google; una misma barbería, no.
CREATE UNIQUE INDEX `Servicio_negocioId_nombre_key` ON `Servicio`(`negocioId`, `nombre`);
CREATE UNIQUE INDEX `Cliente_negocioId_googleId_key` ON `Cliente`(`negocioId`, `googleId`);
CREATE UNIQUE INDEX `Cliente_negocioId_usuarioId_key` ON `Cliente`(`negocioId`, `usuarioId`);
CREATE UNIQUE INDEX `Barbero_negocioId_usuarioId_key` ON `Barbero`(`negocioId`, `usuarioId`);
CREATE UNIQUE INDEX `Administrador_negocioId_usuarioId_key` ON `Administrador`(`negocioId`, `usuarioId`);

-- ---------------------------------------------------------------------------
-- 3) `negocioId` OBLIGATORIO
-- ---------------------------------------------------------------------------
-- La clave foránea con `ON DELETE SET NULL` impide pasar la columna a NOT
-- NULL: primero se suprime y después se vuelve a declarar con `RESTRICT`.
ALTER TABLE `Administrador` DROP FOREIGN KEY `Administrador_negocioId_fkey`;
ALTER TABLE `Administrador` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `Administrador` ADD CONSTRAINT `Administrador_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Barbero` DROP FOREIGN KEY `Barbero_negocioId_fkey`;
ALTER TABLE `Barbero` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `Barbero` ADD CONSTRAINT `Barbero_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Cliente` DROP FOREIGN KEY `Cliente_negocioId_fkey`;
ALTER TABLE `Cliente` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `Cliente` ADD CONSTRAINT `Cliente_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Servicio` DROP FOREIGN KEY `Servicio_negocioId_fkey`;
ALTER TABLE `Servicio` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `Servicio` ADD CONSTRAINT `Servicio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BarberoServicio` DROP FOREIGN KEY `BarberoServicio_negocioId_fkey`;
ALTER TABLE `BarberoServicio` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `BarberoServicio` ADD CONSTRAINT `BarberoServicio_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `barber_weekly_slots` DROP FOREIGN KEY `barber_weekly_slots_negocioId_fkey`;
ALTER TABLE `barber_weekly_slots` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `barber_weekly_slots` ADD CONSTRAINT `barber_weekly_slots_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `barber_schedule_blocks` DROP FOREIGN KEY `barber_schedule_blocks_negocioId_fkey`;
ALTER TABLE `barber_schedule_blocks` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `barber_schedule_blocks` ADD CONSTRAINT `barber_schedule_blocks_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `general_closures` DROP FOREIGN KEY `general_closures_negocioId_fkey`;
ALTER TABLE `general_closures` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `general_closures` ADD CONSTRAINT `general_closures_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reservations` DROP FOREIGN KEY `reservations_negocioId_fkey`;
ALTER TABLE `reservations` MODIFY COLUMN `negocioId` INTEGER NOT NULL;
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) CLAVES FORÁNEAS COMPUESTAS
-- ---------------------------------------------------------------------------
-- Cada relación entre modelos tenant-scoped pasa a referenciar
-- `(negocioId, id)`: el motor comprueba que el registro referenciado
-- pertenece al MISMO negocio. La clave simple se sustituye (no se duplica).

-- 4.1 Reserva -> barbero, servicio y cliente.
ALTER TABLE `reservations` DROP FOREIGN KEY `reservations_barberoId_fkey`;
ALTER TABLE `reservations` DROP FOREIGN KEY `reservations_servicioId_fkey`;
ALTER TABLE `reservations` DROP FOREIGN KEY `reservations_clienteId_fkey`;
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_negocioId_barberoId_fkey` FOREIGN KEY (`negocioId`, `barberoId`) REFERENCES `Barbero`(`negocioId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_negocioId_servicioId_fkey` FOREIGN KEY (`negocioId`, `servicioId`) REFERENCES `Servicio`(`negocioId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_negocioId_clienteId_fkey` FOREIGN KEY (`negocioId`, `clienteId`) REFERENCES `Cliente`(`negocioId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4.2 Vínculo barbero-servicio: ambos deben ser del mismo negocio.
ALTER TABLE `BarberoServicio` DROP FOREIGN KEY `BarberoServicio_barberoId_fkey`;
ALTER TABLE `BarberoServicio` DROP FOREIGN KEY `BarberoServicio_servicioId_fkey`;
ALTER TABLE `BarberoServicio` ADD CONSTRAINT `BarberoServicio_negocioId_barberoId_fkey` FOREIGN KEY (`negocioId`, `barberoId`) REFERENCES `Barbero`(`negocioId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BarberoServicio` ADD CONSTRAINT `BarberoServicio_negocioId_servicioId_fkey` FOREIGN KEY (`negocioId`, `servicioId`) REFERENCES `Servicio`(`negocioId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 4.3 Horario semanal y bloqueos -> barbero del mismo negocio.
ALTER TABLE `barber_weekly_slots` DROP FOREIGN KEY `barber_weekly_slots_barberoId_fkey`;
ALTER TABLE `barber_weekly_slots` ADD CONSTRAINT `barber_weekly_slots_negocioId_barberoId_fkey` FOREIGN KEY (`negocioId`, `barberoId`) REFERENCES `Barbero`(`negocioId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `barber_schedule_blocks` DROP FOREIGN KEY `barber_schedule_blocks_barberoId_fkey`;
ALTER TABLE `barber_schedule_blocks` ADD CONSTRAINT `barber_schedule_blocks_negocioId_barberoId_fkey` FOREIGN KEY (`negocioId`, `barberoId`) REFERENCES `Barbero`(`negocioId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
