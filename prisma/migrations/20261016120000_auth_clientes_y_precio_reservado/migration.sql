-- HE-04: autenticación de clientes (Modalidad B) y precio histórico de la reserva.
--
-- NO EJECUTADA AUTOMÁTICAMENTE. Requiere autorización y una base real.
--
-- Precondiciones:
--   1) La migración `20261015130000_agregar_identidad_cliente_y_enlaces_reserva`
--      ya está aplicada.
--   2) Todas las columnas que se agregan son NULL, por lo que la migración es
--      segura tanto si `Cliente`/`reservations` tienen datos como si están vacías.
--
-- Decisiones reflejadas (ver docs/he-04/decisiones-pendientes.md):
--   D-01: la identidad del cliente autenticado se ancla en `Cliente.googleId`
--         (el `sub` del ID Token de Google, único). `email` es un dato de
--         contacto/consulta, NO una clave de identidad; no se vincula por
--         coincidencia de correo. El vínculo heredado `usuarioId` se conserva.
--   D-07: `reservations.precioReservado` conserva el precio del servicio
--         calculado en el servidor al crear la reserva. Queda NULL en las
--         reservas anteriores a esta migración (no se inventan snapshots).

-- 1) Cliente: identidad estable de Google + correo de contacto opcional.
ALTER TABLE `Cliente` ADD COLUMN `googleId` VARCHAR(191) NULL;
ALTER TABLE `Cliente` ADD COLUMN `email` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Cliente_googleId_key` ON `Cliente`(`googleId`);

-- 2) Reservation: precio aplicado al crear la reserva (histórico, nullable).
ALTER TABLE `reservations` ADD COLUMN `precioReservado` DECIMAL(10, 2) NULL;
