-- AlterEnum: agrega el estado NO_SHOW al ciclo de vida de la reserva.
-- NO_SHOW representa al cliente que no asistió a su cita: se marca desde el
-- personal (BARBERO/ADMINISTRADOR/SUPERADMIN) tras la tolerancia configurada.
-- Conserva la política de ocupación de HE-08: como no es CANCELLED, la columna
-- generada `slotActivo` sigue valiendo 1 (ocupa la franja), por lo que no se
-- modifica su expresión ni el índice único. El valor se agrega al final del enum
-- para no remapear los valores existentes. No hay `down` reversible en MariaDB
-- (quitar un valor del ENUM exigiría recrear la columna).
ALTER TABLE `reservations`
    MODIFY COLUMN `status`
    ENUM('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')
    NOT NULL DEFAULT 'PENDING';
