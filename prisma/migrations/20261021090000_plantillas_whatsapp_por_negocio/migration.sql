-- ===========================================================================
-- HU-11: LAS PLANTILLAS DE WHATSAPP PASAN A SER POR NEGOCIO
-- ===========================================================================
--
-- Motivo (justificación de alcance):
--   Las plantillas de confirmación y recordatorio son CONFIGURACIÓN DE PLATA-
--   FORMA de cada barbería: el texto que un administrador personaliza para su
--   negocio no puede alterar los mensajes de los demás. Con el modelo global
--   anterior, personalizar la plantilla de una barbería cambiaba la de todas.
--
-- Lo que hace esta migración (ADITIVA, sin tocar datos):
--   1. Añade `negocioId` ANULABLE a `whatsapp_plantillas`.
--      - `NULL`  -> plantilla GLOBAL de plataforma (valor por defecto).
--      - `NOT NULL` -> plantilla de ese negocio.
--   2. Añade la columna GENERADA `claveGlobal` (`tipo` si la plantilla es
--      global, `NULL` si es de un negocio) con índice ÚNICO: en MySQL/MariaDB
--      los `NULL` de un índice único no colisionan, de modo que garantiza como
--      máximo UNA plantilla global por tipo sin impedir las de cada negocio.
--   3. Sustituye el índice ÚNICO global `tipo` por el compuesto
--      `(negocioId, tipo)`.
--   4. Añade la clave foránea `negocioId -> negocios(id)` con `ON DELETE
--      CASCADE` (las plantillas de una barbería desaparecen con ella).
--
-- LAS FILAS EXISTENTES NO CAMBIAN:
--   Las plantillas actuales pasan a `negocioId = NULL`, es decir, se
--   CONVIERTEN en las plantillas GLOBALES de la plataforma. Su texto, su tipo
--   y su/significado no cambian: siguen siendo el texto inicial que usa un
--   negocio que aún no ha personalizado sus mensajes. NO se eliminan, NO se
--   reasignan a un negocio y NO se duplican.
--
-- REGLA DE RESOLUCIÓN (aplicada por el código):
--   plantilla del NEGOCIO  >  plantilla GLOBAL  >  texto por defecto del código.
--
-- REQUISITOS PREVIOS:
--   1. La migración de endurecimiento de la Fase 8 debe estar aplicada (esta
--      migración usa la tabla `negocios`).
--   2. NO requiere backfill: las filas globales son un estado válido.
--   3. Si una barbería tenía textos personalizados en la plantilla global
--      (modelo anterior), debe volver a guardarlos desde su panel para que
--      queden en SU plantilla. La migración no puede saber a qué barbería
--      pertenecía cada texto: NO se asigna nada por suposición.
-- ===========================================================================

-- 1. Columna de pertenencia al negocio (anulable: `NULL` = global).
ALTER TABLE `whatsapp_plantillas` ADD COLUMN `negocioId` INTEGER NULL;

-- 2. Columna GENERADA: identifica la plantilla global de cada tipo.
--    Prisma no expresa columnas generadas (igual que `slotActivo` en las
--    reservas): la expresión solo existe aquí.
ALTER TABLE `whatsapp_plantillas` ADD COLUMN `claveGlobal` VARCHAR(50) GENERATED ALWAYS AS (IF(`negocioId` IS NULL, `tipo`, NULL)) VIRTUAL;

-- 3. Unicidades: se retira la global por `tipo` y se añade la por negocio.
--    El nombre del índice se escribe en minúsculas porque el motor las almacena
--    así con `lower_case_table_names=1` y las compara sin distinguir
--    mayúsculas (mismo criterio que la migración de la Fase 8).
DROP INDEX `whatsapp_plantillas_tipo_key` ON `whatsapp_plantillas`;

CREATE UNIQUE INDEX `whatsapp_plantillas_negocioId_tipo_key` ON `whatsapp_plantillas`(`negocioId`, `tipo`);
CREATE UNIQUE INDEX `whatsapp_plantillas_claveGlobal_key` ON `whatsapp_plantillas`(`claveGlobal`);
CREATE INDEX `whatsapp_plantillas_negocioId_idx` ON `whatsapp_plantillas`(`negocioId`);

-- 4. Clave foránea al negocio.
ALTER TABLE `whatsapp_plantillas` ADD CONSTRAINT `whatsapp_plantillas_negocioId_fkey` FOREIGN KEY (`negocioId`) REFERENCES `negocios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
