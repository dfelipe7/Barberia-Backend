# TECH_DEBT.md — Inventario de deuda técnica

> **Versionado**: sí. Se comparte por el remoto.
> **Lectura**: obligatoria antes de proponer cambios (ver `AGENTS.md` §10).
> **Mantenimiento**: cada entrada la cierra un humano con commit dedicado (`Resolved-By:`).
>
> **Estados**: ABIERTA (nadie la está tocando) · EN_PROGRESO (alguien la está atacando) · ACEPTADA (no se va a resolver; el equipo la asume) · RESUELTA (cerrada, se conserva por trazabilidad).

## Índice

- [DEBT-001 — Errores de ESLint preexistentes (reducidos de ~900 a 31)](#debt-001--errores-de-eslint-preexistentes-reducidos-de-900-a-31)
- [DEBT-002 — Reformateos de lint en commits previos de feature/multitenant-core-fixes](#debt-002--reformateos-de-lint-en-commits-previos-de-featuremultitenant-core-fixes)
- [DEBT-003 — Verificación de email al vincular googleId por primera vez](#debt-003--verificación-de-email-al-vincular-googleid-por-primera-vez)
- [DEBT-004 — Sesiones JWT emitidas con el modelo monotenant](#debt-004--sesiones-jwt-emitidas-con-el-modelo-monotenant)
- [DEBT-005 — .vscode/ sin excluir en el repo](#debt-005--vscode-sin-excluir-en-el-repo)
- [DEBT-006 — Índice compuesto para listado de productos por negocio y fecha](#debt-006--índice-compuesto-para-listado-de-productos-por-negocio-y-fecha)
- [DEBT-007 — Test de uploads con describe anidado rompe la suite completa](#debt-007--test-de-uploads-con-describe-anidado-rompe-la-suite-completa)
- [DEBT-008 — Producto no está cubierto por el aislamiento automático de Prisma](#debt-008--producto-no-está-cubierto-por-el-aislamiento-automático-de-prisma)

---

### DEBT-001 — Errores de ESLint preexistentes (reducidos de ~900 a 31)

- **Severidad**: MEDIA
- **Área**: backend/infra (transversal)
- **Estado**: EN_PROGRESO
- **Detectada**: 2026-11-01
- **Origen**: auditoría de cierre del PR `feature/multitenant-core-fixes`.
- **Descripción**: inicialmente se reportaban ~900 errores acumulados. Tras la configuración de `eslint.config.mjs` (que desactiva reglas de tipado estricto innecesarias en archivos de test `.spec.ts` y `.e2e-spec.ts`), el número se redujo a **82 errores y 6 warnings** en `src/**/*.ts`. Los errores remanentes se concentran en lógica de negocio concreta (`whatsapp.service.ts`: 26, `servicios.service.ts`: 18, `reservas.service.ts`: 14, `servicios.repository.ts`: 5, `multer.config.ts`: 4) y algunos ajustes de formateo Prettier.
- **Impacto**:
  - Dificulta automatizar un lint estricto en CI sin baseline.
- **Mitigación en curso**:
  1. Fase 1 completada: relajación de reglas de tipado estricto en tests via `eslint.config.mjs`.
  2. Snapshot baseline (`.eslint-baseline.json`) o resolución progresiva por módulo sin tocar archivos críticos de golpe.
- **Criterio de cierre**: `npx eslint "src/**/*.ts"` devuelve 0 errores.
- **Target**: progresivo por PRs dedicados por módulo.

---

### DEBT-002 — Reformateos de lint en commits previos de feature/multitenant-core-fixes

- **Severidad**: BAJA
- **Área**: backend/infra
- **Estado**: ACEPTADA
- **Detectada**: 2026-11-01
- **Origen**: revisión del histórico de la rama.
- **Descripción**: los primeros commits de la rama metieron reformateos automáticos (`eslint --fix`) mezclados con cambios semánticos. El diff es más ruidoso de lo necesario.
- **Impacto**: dificulta la revisión línea a línea de esos commits. No afecta al resultado funcional.
- **Mitigación propuesta**: **ninguna**. Revertirlos o reescribir el historial introduciría más ruido que el que quitan.
- **Criterio de cierre**: se cierra por *ACEPTADA* al mergear el PR. Queda como precedente documentado: **prohibido `eslint --fix` global dentro de un PR funcional** (ver `AGENTS.md` §2.5).
- **Resolved-By**: N/A (aceptada, no se resuelve).

---

### DEBT-003 — Verificación de email al vincular googleId por primera vez

- **Severidad**: MEDIA (seguridad)
- **Área**: backend/auth
- **Estado**: ABIERTA
- **Detectada**: 2026-11-01
- **Origen**: revisión del fix A4. Documentada como comentario en `src/auth/google/google-auth.service.ts`.
- **Descripción**: si un administrador crea una cuenta sin `googleId` y el correo cambia de dueño **antes** del primer login con Google, el nuevo titular del correo podría vincular su cuenta al perfil existente (Account Takeover por email reciclado antes del primer link). El A4 cierra el vector *después* del primer link; este caso queda fuera.
- **Impacto**: ventana de riesgo acotada (requiere: cuenta sin `googleId` + reasignación de correo + primer login del nuevo titular). Bajo volumen, alto impacto.
- **Mitigación propuesta**:
  1. Al detectar primer link (`!usuario.googleId && payload.sub`), enviar un **link mágico** al `payload.email` que confirme la vinculación.
  2. Alternativa: exigir que el **primer login** de una cuenta sin `googleId` lo inicie un administrador de la barbería.
  3. Ambas opciones requieren cambio de flujo en `GoogleAuthService.loginConGoogle` + plantilla de email + token de confirmación de corta vida.
- **Criterio de cierre**: test E2E que cubra "cuenta sin googleId + email reciclado + primer login" y que el sistema rechace sin verificación previa.
- **Target**: fase posterior a la liberación multitenant.

---

### DEBT-004 — Sesiones JWT emitidas con el modelo monotenant

- **Severidad**: BAJA
- **Área**: backend/auth
- **Estado**: ACEPTADA
- **Detectada**: 2026-11-01
- **Origen**: análisis de impacto del cambio de modelo (Fases 10–12).
- **Descripción**: los JWT emitidos antes del cambio de modelo (sin `negocioId`, con `ambito` de plataforma) siguen siendo válidos criptográficamente hasta su expiración. `JwtAuthGuard` los rechaza por no tener `negocioId` (`401 "La sesión no está vinculada a un negocio"`), pero el token en sí no se invalida.
- **Impacto**: usuarios con sesión vieja deben volver a loguearse. No es un riesgo de seguridad (el guard los rechaza), es fricción de UX.
- **Mitigación propuesta**: **ninguna**. Forzar invalidación global (blacklist o bump de `JWT_SECRET`) es peor: rompe sesiones válidas de todos. Se mitiga naturalmente con la expiración (`7d` por defecto, `30d` para clientes).
- **Criterio de cierre**: se cierra por *ACEPTADA* al pasar 30 días desde el despliegue del modelo multitenant.
- **Resolved-By**: N/A (aceptada, expira sola).

---

### DEBT-005 — .vscode/ sin excluir en el repo

- **Severidad**: BAJA
- **Área**: infra
- **Estado**: RESUELTA
- **Detectada**: 2026-11-01
- **Origen**: `git status` de cierre del PR `feature/multitenant-core-fixes`.
- **Descripción**: `.vscode/` aparecía como *untracked* en `git status`.
- **Impacto**: ruido en `git status`.
- **Mitigación aplicada**: `.gitignore` incluye `.vscode/*` ignorando archivos locales y preservando la configuración compartida (`settings.json`, `tasks.json`, `launch.json`, `extensions.json`).
- **Criterio de cierre**: `.vscode/` ya no aparece en `git status`.
- **Resolved-By**: configuración en `.gitignore`.

---

### DEBT-006 — Índice compuesto para listado de productos por negocio y fecha

- **Severidad**: BAJA
- **Área**: backend/productos
- **Estado**: ABIERTA
- **Detectada**: 2026-11-06
- **Origen**: sesión `.ai/sessions/2026-11-06/2217-productos-hu02.md`.
- **Descripción**: `GET /productos` filtra por `negocioId` y ordena por `creadoEn DESC, id DESC`. El esquema solo declara `@@index([negocioId])`, que cubre el filtro pero no el orden. Con catálogos pequeños no hay impacto medible.
- **Impacto**: al crecer el catálogo por negocio, MariaDB puede recurrir a filesort o a un escaneo mayor. No bloquea HU-02.
- **Mitigación propuesta**: añadir `@@index([negocioId, creadoEn, id])` mediante migración dedicada, solo después de confirmar el plan con `EXPLAIN` sobre un catálogo representativo.
- **Criterio de cierre**: `EXPLAIN` con catálogo grande muestra uso del índice y ausencia de filesort para el listado; migración aplicada y verificada.
- **Target**: cuando el catálogo por negocio justifique la migración, sin fecha.

---

### DEBT-007 — Test de uploads con describe anidado rompe la suite completa

- **Severidad**: MEDIA (tests)
- **Área**: backend/tests
- **Estado**: RESUELTA
- **Detectada**: 2026-11-06
- **Origen**: merge `b012289` (`Merge remote-tracking branch 'origin/master' into feature/gestion-productos`). La resolución del merge anidó el `describe('resolverRutaPublicaUpload', ...)` dentro del `it('separa las imágenes de producto...')`.
- **Descripción**: `src/common/config/uploads.config.spec.ts:117` declaraba `describe` anidado en `it`, haciendo que Jest abortara con `Cannot nest a describe inside a test`.
- **Impacto**: `npm test` abortaba esa suite.
- **Mitigación aplicada**: se cerró el bloque `it` y se movió el `describe` al nivel superior de la suite.
- **Criterio de cierre**: suite `uploads.config.spec.ts` pasa con 12 tests exitosos y 0 errores de ESLint.
- **Resolved-By**: corrección en `src/common/config/uploads.config.spec.ts`.

---

### DEBT-008 — Producto no está cubierto por el aislamiento automático de Prisma

- **Severidad**: ALTA (seguridad)
- **Área**: backend/productos | seguridad | datos
- **Estado**: ABIERTA
- **Detectada**: 2026-11-07
- **Origen**: validación de HE-03-HU-05.
- **Descripción**: El modelo Prisma `Producto` no aparece en
  `MODELOS_TENANT_SCOPED` ni en `MODELOS_GLOBALES`. La extensión
  `prisma-extension-aislamiento.ts` trata cualquier modelo no tenant-scoped
  como global y ejecuta `query(args)` sin inyectar `negocioId`. Por tanto, la
  extensión NO protege `Producto`; la única barrera efectiva es el
  `filtroLectura` explícito de `ProductoRepository`.
- **Impacto**: Una consulta futura que olvide `filtroLectura` podría leer o
  escribir productos de otro negocio. En HU-05 las consultas actuales sí
  filtran, pero la defensa en profundidad no cubre este modelo.
- **Mitigación propuesta**:
  1. Añadir `Producto` a `MODELOS_TENANT_SCOPED` con pruebas de la extensión.
  2. Verificar que la extensión no rompa `create/update` existentes.
  3. Alternativa: documentar `Producto` como excepción aprobada y reforzar
     la revisión de repositorios.
- **Criterio de cierre**: `Producto` incluido en `MODELOS_TENANT_SCOPED` y
  pruebas que demuestren que una consulta sin filtro explícito no devuelve
  filas de otro negocio; o excepción aprobada y documentada.
- **Target**: revisión de aislamiento multitenant; sin fecha.

---

## Cómo añadir una entrada nueva

1. Tomar el siguiente ID disponible (`DEBT-009`, …).
2. Copiar la plantilla de `AGENTS.md` §10.3.
3. Rellenar todos los campos salvo los opcionales.
4. Añadir la entrada al índice.
5. Commit dedicado: `docs(tech-debt): añade DEBT-00X — <título>`.
6. Si la deuda la introdujo un agente, incluir el trailer `AI-Assisted-By:` correspondiente y referenciar la sesión en `.ai/sessions/`.

## Cómo cerrar una entrada

1. Cambiar `Estado` a `RESUELTA`.
2. Rellenar `Resolved-By:` con el hash del commit o el número de PR.
3. No borrar la entrada: se conserva por trazabilidad.
4. El commit del cierre lleva `docs(tech-debt): resuelve DEBT-00X` y, si lo hizo un agente, los trailers de IA.

