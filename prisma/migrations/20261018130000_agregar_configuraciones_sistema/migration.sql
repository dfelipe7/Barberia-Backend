-- CreateTable: parámetros funcionales de configuración del sistema.
-- Almacena valores de distinto tipo como texto (`valor`) junto a un `tipo` que
-- indica cómo validarlo/parsearlo al leerlo (sin `eval`). Los secretos y
-- credenciales NO se migran aquí: permanecen en variables de entorno.
-- La inicialización de los valores por defecto es idempotente y se realiza en
-- `prisma/seed.ts`; si una clave no existe, los servicios usan su valor por
-- defecto de forma segura.
CREATE TABLE `configuraciones_sistema` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clave` VARCHAR(100) NOT NULL,
    `valor` TEXT NOT NULL,
    `tipo` ENUM('TEXTO', 'NUMERO', 'BOOLEANO', 'JSON') NOT NULL DEFAULT 'TEXTO',
    `descripcion` VARCHAR(255) NULL,
    `editable` BOOLEAN NOT NULL DEFAULT true,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `configuraciones_sistema_clave_key`(`clave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
