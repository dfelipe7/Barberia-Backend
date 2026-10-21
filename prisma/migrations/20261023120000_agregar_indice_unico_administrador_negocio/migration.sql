-- ===========================================================================
-- FASE 12: PARIDAD ENTRE `prisma/schema.prisma` Y EL HISTORIAL DE MIGRACIONES
-- ===========================================================================
--
-- CAUSA EXACTA DE LA DIVERGENCIA:
--   `prisma/schema.prisma` declara, en el modelo `Administrador`:
--       @@unique([negocioId, id])
--   La migración de la Fase 8 (`20261020120000_endurecer_esquema_multitenant`)
--   creó los índices únicos compuestos `(negocioId, id)` SOLO en los TRES
--   modelos que son DESTINO de una clave foránea compuesta:
--       Barbero_negocioId_id_key   -> destino de `reservations`,
--                                      `BarberoServicio`,
--                                      `barber_weekly_slots` y
--                                      `barber_schedule_blocks`
--       Servicio_negocioId_id_key  -> destino de `reservations` y
--                                      `BarberoServicio`
--       Cliente_negocioId_id_key   -> destino de `reservations`
--   El CUARTO modelo con la misma declaración en el esquema, `Administrador`,
--   quedó fuera: su índice NUNCA se creó. Consecuencia: el historial aplicado
--   no reproducía el esquema declarado y `prisma migrate diff` reportaba
--       [+] Added unique index on columns (negocioId, id)
--   sobre la tabla `Administrador`.
--
-- ALCANCE (ADITIVA, no toca datos):
--   1. Añade el índice ÚNICO compuesto `Administrador_negocioId_id_key` sobre
--      `(negocioId, id)`: exactamente lo que declara el esquema.
--   2. NO modifica ni borra la clave primaria (`PRIMARY` sobre `id`), ni
--      ninguna otra restricción, ni ninguna fila.
--   3. NO toca `Usuario.rol` ni promueve a nadie.
--
-- POR QUÉ EL ÍNDICE:
--   - Es la representación en la base de datos del `@@unique([negocioId, id])`
--     declarado en el modelo, y el destino natural de una clave foránea
--     compuesta que apunte a un perfil de administrador (mismo patrón ya
--     establecido en `Barbero`, `Servicio` y `Cliente`).
--   - `id` es clave primaria, de modo que `(negocioId, id)` NUNCA puede
--     duplicarse: añadirlo no puede fallar por datos preexistentes y es
--     seguro también sobre una base con datos heredados.
--
-- IDEMPOTENCIA:
--   Se comprueba en `information_schema.STATISTICS` si el índice con ese
--   nombre ya existe. En MySQL el nombre de un índice es único por tabla, así
--   que la comprobación basta para NO duplicar la restricción ni fallar con
--   "Duplicate key name". Antes de aplicar esta migración se verificó sobre
--   la base aislada que el índice NO existía y que, tras aplicarla, su
--   definición es exactamente UNIQUE `(negocioId, id)`.
--   Es el mismo patrón idempotente que ya usan las migraciones
--   `20260912145500` y `20261019110000`.
--
-- COMPATIBILIDAD: MySQL 8.0.46 con `lower_case_table_names = 0`.
--   El nombre real de la tabla es `Administrador` (mayúscula exacta, verificada
--   en `information_schema`) y el del índice sigue la convención de Prisma
--   `<Modelo>_<columna>_<columna>_key`, comprobada en las tablas hermanas.
-- ===========================================================================

SET @administrador_indice_negocio_id = (
    SELECT COUNT(*)
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'Administrador'
       AND INDEX_NAME = 'Administrador_negocioId_id_key'
);

SET @administrador_indice_sql = IF(@administrador_indice_negocio_id = 0,
    'CREATE UNIQUE INDEX `Administrador_negocioId_id_key` ON `Administrador`(`negocioId`, `id`)',
    'DO 0');

PREPARE administrador_indice_stmt FROM @administrador_indice_sql;
EXECUTE administrador_indice_stmt;
DEALLOCATE PREPARE administrador_indice_stmt;
