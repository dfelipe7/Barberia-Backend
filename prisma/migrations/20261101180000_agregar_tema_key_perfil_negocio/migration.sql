-- ===========================================================================
-- FASE 17: TEMA VISUAL / PALETA DE MARCA POR NEGOCIO
-- ===========================================================================
--
-- Objetivo: que cada barbería pueda seleccionar un preset de tema visual
-- (ej. 'clasico-azul', 'cyber-lime', 'oro-vip', 'sunset-amber', etc.)
-- almacenado de forma persistente en la base de datos, garantizando
-- coherencia de marca y desacoplamiento con el frontend.
--
-- Garantías:
--   1. La columna es aditiva y tiene DEFAULT 'clasico-azul': los negocios
--      existentes adoptan el tema estándar oficial de forma transparente.
--   2. No altera relaciones ni índices existentes.
--
-- COMPATIBILIDAD: MySQL 8.0.46 con `lower_case_table_names = 0`.
--   La tabla real es `perfiles_negocio` (minúsculas, con `@@map`).
-- ===========================================================================

-- AlterTable: agregar clave de tema visual a perfil del negocio.
ALTER TABLE `perfiles_negocio` ADD COLUMN `temaKey` VARCHAR(50) NULL DEFAULT 'clasico-azul';
