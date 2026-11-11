-- ===========================================================================
-- INDICES DE LISTADO DE PRODUCTOS
-- ===========================================================================
--
-- Los listados administrativos filtran por negocio y ordenan por `creadoEn`
-- (o `estado`, `nombre`) con paginacion por cursor sobre `id`. El indice
-- simple `productos_negocioId_idx` es redundante: `@@unique([negocioId,
-- nombre])` ya cubre `negocioId` como prefijo. Se reemplaza por dos indices
-- compuestos que cubren filtro + orden + desempate por `id`.
--
-- ADITIVA: no toca datos. Cada paso comprueba `information_schema.STATISTICS`
-- para ser idempotente.
-- ===========================================================================

SET @indice_negocio = (
    SELECT COUNT(*)
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'productos'
       AND INDEX_NAME = 'productos_negocioId_idx'
);

SET @sql = IF(@indice_negocio > 0,
    'DROP INDEX `productos_negocioId_idx` ON `productos`',
    'DO 0');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @indice_creado = (
    SELECT COUNT(*)
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'productos'
       AND INDEX_NAME = 'productos_negocioId_creadoEn_id_idx'
);

SET @sql = IF(@indice_creado = 0,
    'CREATE INDEX `productos_negocioId_creadoEn_id_idx` ON `productos`(`negocioId`, `creadoEn`, `id`)',
    'DO 0');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @indice_estado = (
    SELECT COUNT(*)
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'productos'
       AND INDEX_NAME = 'productos_negocioId_estado_nombre_id_idx'
);

SET @sql = IF(@indice_estado = 0,
    'CREATE INDEX `productos_negocioId_estado_nombre_id_idx` ON `productos`(`negocioId`, `estado`, `nombre`, `id`)',
    'DO 0');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
