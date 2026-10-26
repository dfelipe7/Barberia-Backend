const { execFileSync } = require('node:child_process');

/**
 * Elimina los contenedores compartidos que crea
 * `test/helpers/mariadb-test-container.ts` durante la corrida multitenant.
 *
 * Los tests pueden ejecutarse sin Docker (`MARIADB_TEST_SKIP=1`), así que los
 * errores se ignoran: si el contenedor no existe o Docker no está disponible,
 * no hay nada que limpiar.
 */
module.exports = async () => {
  for (const motor of ['mariadb', 'mysql']) {
    for (const lctn of [0, 1]) {
      try {
        execFileSync(
          'docker',
          ['rm', '-f', `barberia-mt-shared-${motor}-lctn${lctn}`],
          { stdio: 'ignore' },
        );
      } catch {
        // Sin Docker o sin contenedor: nada que hacer.
      }
    }
  }
};
