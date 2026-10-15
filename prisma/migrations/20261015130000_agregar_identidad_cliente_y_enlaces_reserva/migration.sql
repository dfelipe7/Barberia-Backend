-- HE-04-HU-04: identidad de cliente (invitado / autenticado) y enlaces de la
-- reserva con Servicio y Cliente.
--
-- NO EJECUTADA AUTOMÁTICAMENTE. Requiere autorización y una base real.
--
-- Precondiciones:
--   1) La migración `20261015090044_agregar_reservations` ya está aplicada.
--   2) La tabla `reservations` está VACÍA. Esta migración agrega dos columnas
--      NOT NULL (`servicioId`, `clienteId`) sin valor por defecto; sobre una
--      tabla con filas fallaría. Hasta hoy no existe ningún flujo de creación
--      de reservas, por lo que la tabla no debería tener datos.
--
-- Decisiones reflejadas (ver docs/he-04/decisiones-pendientes.md):
--   D-01/D-02: `Cliente` se reutiliza para invitado (usuarioId NULL) y para
--              cliente autenticado (usuarioId único hacia Usuario). `apellido` y
--              `telefono` pasan a NULL para admitir clientes con el mínimo
--              "nombre + contacto" y clientes autenticados sin teléfono.
--   D-03:      `Reservation` enlaza `servicioId` y `clienteId` obligatorios.
--              `precioReservado`/descuento NO se agregan (D-07/D-08 pendientes).

-- 1) Cliente: vínculo opcional y único con Usuario + contacto opcional.
ALTER TABLE `Cliente` MODIFY `apellido` VARCHAR(191) NULL;
ALTER TABLE `Cliente` MODIFY `telefono` VARCHAR(191) NULL;
ALTER TABLE `Cliente` ADD COLUMN `usuarioId` INTEGER NULL;

CREATE UNIQUE INDEX `Cliente_usuarioId_key` ON `Cliente`(`usuarioId`);

ALTER TABLE `Cliente`
  ADD CONSTRAINT `Cliente_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Reservation: enlaces obligatorios a Servicio y Cliente.
ALTER TABLE `reservations` ADD COLUMN `servicioId` INTEGER NOT NULL;
ALTER TABLE `reservations` ADD COLUMN `clienteId` INTEGER NOT NULL;

CREATE INDEX `reservations_servicioId_idx` ON `reservations`(`servicioId`);
CREATE INDEX `reservations_clienteId_idx` ON `reservations`(`clienteId`);

ALTER TABLE `reservations`
  ADD CONSTRAINT `reservations_servicioId_fkey`
  FOREIGN KEY (`servicioId`) REFERENCES `Servicio`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `reservations`
  ADD CONSTRAINT `reservations_clienteId_fkey`
  FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
