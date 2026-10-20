/**
 * Tipos del matcher `toHaveBeenCalledWithAislado`, usado por las pruebas de
 * repositorio para validar consultas que incluyen el filtro de negocio.
 *
 * El matcher compara la consulta esperada ignorando el `negocioId` que el
 * aislamiento multitenant añade, y verifica además que el `negocioId`
 * presente sea el del negocio activo.
 */
declare global {
  namespace jest {
    interface Matchers<R> {
      /**
       * Verifica que el mock se llamara con los argumentos esperados,
       * admitiendo el `negocioId` añadido por el aislamiento multitenant y
       * exigiendo que ese `negocioId` sea el del negocio activo.
       */
      toHaveBeenCalledWithAislado(esperado: unknown): R;
    }
  }
}

export {};
