-- HE-04: token hash para gestión segura de reservas de invitados (HU-08/HU-09).
--
-- NO EJECUTADA AUTOMÁTICAMENTE. Requiere autorización y una base real.
--
-- Precondiciones:
--   1) La migración `20261016120000_auth_clientes_y_precio_reservado` ya está registrada.
--   2) La columna `gestionTokenHash` es nullable, por lo que la migración es segura
--      tanto para tablas con datos existentes como vacías.
--
-- Decisiones reflejadas:
--   - Permitir que un invitado gestione (modifique o cancele) su propia reserva sin
--     crear cuenta ni iniciar sesión.
--   - El servidor genera un token aleatorio criptográficamente seguro al crear la reserva
--     de invitado y almacena únicamente su hash SHA-256 en `gestionTokenHash`.
--   - Para reservas de clientes autenticados, esta columna permanece NULL.

ALTER TABLE `reservations` ADD COLUMN `gestionTokenHash` VARCHAR(255) NULL;
