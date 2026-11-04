# TECH_DEBT.md — Inventario de deuda técnica

> **Versionado**: sí. Se comparte por el remoto.
> **Lectura**: obligatoria antes de proponer cambios (ver `AGENTS.md` §10).
> **Mantenimiento**: cada entrada la cierra un humano con commit dedicado (`Resolved-By:`).
>
> **Estados**: ABIERTA (nadie la está tocando) · EN_PROGRESO (alguien la está atacando) · ACEPTADA (no se va a resolver; el equipo la asume) · RESUELTA (cerrada, se conserva por trazabilidad).

## Índice

- [DEBT-001 — ~900 errores de ESLint preexistentes](#debt-001--900-errores-de-eslint-preexistentes)
- [DEBT-002 — Reformateos de lint en commits previos de feature/multitenant-core-fixes](#debt-002--reformateos-de-lint-en-commits-previos-de-featuremultitenant-core-fixes)
- [DEBT-003 — Verificación de email al vincular googleId por primera vez](#debt-003--verificación-de-email-al-vincular-googleid-por-primera-vez)
- [DEBT-004 — Sesiones JWT emitidas con el modelo monotenant](#debt-004--sesiones-jwt-emitidas-con-el-modelo-monotenant)
- [DEBT-005 — .vscode/ sin excluir en el repo](#debt-005--vscode-sin-excluir-en-el-repo)

---

### DEBT-001 — ~900 errores de ESLint preexistentes

- **Severidad**: MEDIA
- **Área**: backend/infra (transversal)
- **Estado**: ABIERTA
- **Detectada**: 2026-11-01
- **Origen**: auditoría de cierre del PR `feature/multitenant-core-fixes`.
- **Descripción**: el repositorio arrastra ~900 errores de ESLint acumulados. Predominan `@typescript-eslint/no-explicit-any` en mocks y tipos de test, y `@typescript-eslint/unbound-method` (métodos `mock` sin `this: void`). No bloquean `typecheck` ni tests, pero contaminan cualquier `eslint` global y hacen ruido en los PRs.
- **Impacto**:
  - Los errores nuevos se pierden entre los viejos.
  - El gate de "sin errores nuevos" no es automatizable hasta limpiar.
  - `--fix` global produce diffs inmanejables.
- **Mitigación propuesta**:
  1. Congelar el conteo actual con un snapshot (`npx eslint . --format json > .eslint-baseline.json`) y commitearlo.
  2. Cambiar el criterio de PR a "sin errores nuevos" comparando contra el baseline.
  3. Atacar por módulo, empezando por `src/auth/**` y `src/modules/usuarios/**`.
  4. Separar `any` (fácil, masivo) de `unbound-method` (requiere refactor de mocks).
- **Criterio de cierre**: `npx eslint .` devuelve 0 errores, o el baseline se reduce a 0 progresivamente y se elimina el snapshot.
- **Target**: PR separado, sin fecha.

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
- **Estado**: ABIERTA
- **Detectada**: 2026-11-01
- **Origen**: `git status` de cierre del PR `feature/multitenant-core-fixes`.
- **Descripción**: `.vscode/` aparece como *untracked* en `git status` y no está excluido ni en `.gitignore` ni en `.git/info/exclude`. Riesgo de que alguien lo commitee por accidente.
- **Impacto**: ruido en `git status`. Riesgo bajo pero constante.
- **Mitigación propuesta**:
  - **A corto plazo**: añadir `.vscode/` a `.git/info/exclude` (local, no versionado).
  - **A medio plazo**: decidir en el equipo si se versiona una configuración base de `.vscode/` (settings, extensions recomendadas) bajo `.vscode/` **controlado** con un `.gitignore` interno que excluya `*.local.json`, `history/`, etc.
- **Criterio de cierre**: `.vscode/` deja de aparecer en `git status` **y** existe decisión documentada (excluido o versionado parcialmente).

---

## Cómo añadir una entrada nueva

1. Tomar el siguiente ID disponible (`DEBT-006`, …).
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

