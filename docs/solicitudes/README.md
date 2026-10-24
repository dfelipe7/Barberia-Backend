# Solicitudes de desarrollo (REQ) — trazabilidad

Registro formal de **cada solicitud de desarrollo procesada mediante OpenCode** en este
repositorio. Cada solicitud se materializa en un documento `REQ-XXX.md` dentro de esta
carpeta, y queda enlazada desde el código y la documentación que produce.

> Nota de versionado: `.gitignore` excluye `/docs/*` por historial, pero re-incluye
> `docs/solicitudes/**` y `docs/api/**` (ver líneas 84-91 de `.gitignore`). Ambas carpetas
> **sí están versionadas**; el resto de `docs/` sigue ignorado como estaba.

---

## 1. Procedimiento

### 1.1 Cuándo crear un REQ

Se crea un REQ por cada solicitud de desarrollo que se procesa con OpenCode, **antes** de
modificar código. Si una misma solicitud se amplía (nuevo alcance sobre el mismo objetivo),
se **actualiza el REQ existente** (se añade una sección "Ampliaciones") en vez de crear uno
nuevo, para no fragmentar la trazabilidad.

No son REQ: consultas informativas, preguntas de lectura del código, ni correcciones
tipográficas sin impacto funcional (esas se registran en el REQ vigente si alteran algo).

### 1.2 Identificador y nombre de archivo

- Formato: `REQ-<NNN>`, numeración correlativa desde `REQ-001`, sin reutilizar.
- Archivo: `docs/solicitudes/REQ-<NNN>.md`.
- Título del documento: `REQ-<NNN> — <título corto en español>`.

### 1.3 Secciones obligatorias (1 a 15)

Todo REQ contiene las 15 secciones, en este orden, con estos títulos:

| # | Sección | Qué debe responder |
|---|---------|---------------------|
| 1 | Identificador y título | `REQ-<NNN>` y título |
| 2 | Fecha y solicitante | Fecha real de la solicitud y quién la formula (persona / rol) |
| 3 | Objetivo | Qué problema de negocio se resuelve, en una frase verificable |
| 4 | Alcance | Qué se incluye y qué queda **fuera** de alcance |
| 5 | Contexto y estado previo | Qué existía antes, con rutas y archivos reales |
| 6 | Requisitos funcionales | Lista numerada de requisitos observables |
| 7 | Requisitos no funcionales | Seguridad, rendimiento, accesibilidad, compatibilidad… |
| 8 | Criterios de aceptación | Lista de checks verificables, cada uno con su resultado real |
| 9 | Archivos creados | Ruta de cada archivo nuevo |
| 10 | Archivos modificados | Ruta de cada archivo alterado y qué cambió |
| 11 | Archivos eliminados | Ruta de cada archivo borrado (o "ninguno") |
| 12 | Dependencias | Dependencias npm/infra añadidas, o "ninguna" |
| 13 | Pruebas | Pruebas creadas/modificadas y **resultado real ejecutado** |
| 14 | Riesgos y límites | Riesgos asumidos, límites conocidos, Plan B |
| 15 | Resultado y estado | Estado final (`COMPLETADA`, `COMPLETADA CON LIMITACIONES`, `PARCIAL`, `ABANDONADA`) + resumen |

### 1.4 Reglas de veracidad (obligatorias)

1. **No se inventa evidencia.** Si una prueba no se ejecutó, se escribe "no ejecutada".
   Si un resultado no se midió, se escribe "no medido".
2. **No se marca como verificado lo que solo se leyó.** "Verificado" exige un comando
   ejecutado con salida observada en esta fase.
3. **No se documentan secretos.** `.env`, tokens, correos reales ni credenciales no
   aparecen en ningún REQ. Se referencia la variable por nombre.
4. **Las rutas, campos y códigos de error son los reales del código**, verificados con
   lectura del fichero correspondiente, no inferidos.
5. **El estado final es honesto**: si parte del alcance quedó pendiente, el REQ termina en
   `PARCIAL` o `COMPLETADA CON LIMITACIONES` y se detalla en la sección 15.
6. **El modelo ejecutor se anota literal** en la cabecera de trazabilidad del código
   (ver sección 2).

### 1.5 Trazabilidad en el código (FASE B)

Todo archivo **nuevo o modificado** por un REQ lleva en su cabecera un bloque de
trazabilidad. El bloque se aplica **una sola vez por archivo**: si el archivo se toca en
varios REQ, la cabecera lista todos los REQ que lo han tocado.

```ts
/**
 * Trazabilidad:
 * - REQ: REQ-006
 * - Modelo ejecutor: <nombre real del modelo o "no disponible en el entorno">
 * - Propósito: <qué resuelve este archivo en una línea>
 * - Responsabilidad: <qué es dueño de este archivo y qué NO hace>
 */
```

En Markdown el bloque equivalente es:

```markdown
<!--
Trazabilidad:
- REQ: REQ-008, REQ-009, REQ-010
- Modelo ejecutor: <modelo>
- Propósito: <una línea>
- Responsabilidad: <una línea>
-->
```

### 1.6 Ciclo de vida

```
PENDIENTE → EN CURSO → COMPLETADA | COMPLETADA CON LIMITACIONES | PARCIAL | ABANDONADA
```

`EN CURSO` se marca al abrir el REQ; el estado final se escribe al cerrarlo, con la
validación ejecutada y su salida real.

---

## 2. Modelo ejecutor

El modelo ejecutor real se anota en la cabecera de trazabilidad de cada archivo tocado.
Si el entorno no expone el nombre del modelo, se escribe literalmente
`no disponible en el entorno` (nunca se inventa).

---

## 3. Índice de solicitudes

La fecha registrada es la fecha real del commit que materializa el REQ (`git log --date=short`).

| REQ | Título | Fecha | Commit | Estado |
|-----|--------|-------|--------|--------|
| [REQ-001](REQ-001.md) | Entorno de desarrollo local multitenant aislado | 2026-10-21 | `8030070` | COMPLETADA CON LIMITACIONES |
| [REQ-002](REQ-002.md) | Paridad del historial de migraciones con `schema.prisma` | 2026-10-21 | `1ea3598` | COMPLETADA |
| [REQ-003](REQ-003.md) | Provisionamiento de las dos barberías y semilla local | 2026-10-21 | `5a038ab` | COMPLETADA |
| [REQ-004](REQ-004.md) | Perfil de negocio y recurso de marca por barbería | 2026-10-21 | `e24a887` | COMPLETADA |
| [REQ-005](REQ-005.md) | Almacenamiento seguro de recursos de marca | 2026-10-21 | `1a169e6` | COMPLETADA |
| [REQ-006](REQ-006.md) | Idempotencia de reservas y tokens de gestión cifrados | 2026-10-21 | `99315fb`, `0819b8c` | COMPLETADA |
| [REQ-007](REQ-007.md) | Validación de migraciones y datos en la BD de desarrollo | 2026-10-21 | `ebbe832` | COMPLETADA |
| [REQ-008](REQ-008.md) | Trazabilidad, documentación formal de API y auditoría de endpoints | 2026-10-21 | sin commit | COMPLETADA |
| [REQ-009](REQ-009.md) | Corrección de H-01, H-02, H-09 y H-10 (seguridad, health check, E2E) | 2026-10-21 | sin commit | COMPLETADA |
| [REQ-010](REQ-010.md) | Revisión precommit de la Fase H: fugas y regresiones detectadas | 2026-10-22 | sin commit | COMPLETADA |

---

## 4. Documentación relacionada

- `docs/api/REFERENCIA_API.md` — referencia formal de la API real.
- `docs/api/MATRIZ_AUDITORIA_ENDPOINTS.md` — auditoría de suficiencia de endpoints.
- `docs/api/HALLAZGOS_CONSISTENCIA.md` — auditoría de consistencia reglas/código/pruebas.
- `CONTRATOS_API_MULTITENANT.md` (raíz) — contrato de cambios de la Fase 10 y siguientes.
