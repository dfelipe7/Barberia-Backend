/**
 * Ejecuta una tarea asíncrona sobre cada elemento, UNO DETRÁS DE OTRO y en el
 * mismo orden de la lista, devolviendo los resultados en ese orden.
 *
 * Se usa cuando la ejecución secuencial es un requisito y no un accidente:
 * - escrituras dentro de una transacción interactiva de Prisma que dependen
 *   del estado que dejó la anterior;
 * - envíos a servicios externos con límite de tasa (WhatsApp);
 * - procesamiento por negocio en el que el fallo/contexto de uno no debe
 *   solaparse con otro.
 *
 * Encadenar con `reduce` evita el patrón `await` dentro de un bucle
 * (regla `no-await-in-loop`) sin cambiar la semántica: cada tarea empieza
 * cuando la anterior terminó.
 */
export function enSerie<T, R>(
  elementos: readonly T[],
  tarea: (elemento: T, indice: number) => Promise<R>,
): Promise<R[]> {
  return elementos.reduce<Promise<R[]>>(
    (anterior, elemento, indice) =>
      anterior.then(async (acumulado) => {
        acumulado.push(await tarea(elemento, indice));
        return acumulado;
      }),
    Promise.resolve([]),
  );
}
