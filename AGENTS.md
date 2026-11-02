# AGENTS.md — Reglas para agentes de IA en este repositorio

> **Alcance**: aplica a cualquier agente de IA (OpenCode, Claude Code, GitHub Copilot, Cursor, Codex, Aider, ChatGPT, Gemini, subagentes invocados por otro agente, etc.) que reciba instrucciones sobre este repositorio.
>
> **Ubicación**: este archivo vive en la raíz del repositorio y se versiona. Cualquier agente que lo ignore no está autorizado a operar aquí.
>
> **Idioma de trabajo**: español. Nombres de archivo, rutas y comandos: inglés cuando el ecosistema lo exige.

## 1. Principios no negociables

1. **Nunca** hacer `commit`, `push`, `merge`, `rebase`, `tag`, `release` ni `deploy` de forma automática. Cada uno exige confirmación explícita y por escrito del humano responsable.
2. **Nunca** asumir el rol de autor. El **autor** del commit es siempre el humano; la IA es herramienta, no coautora.
3. **Nunca** modificar el autor ni el email de un commit existente.
4. **Nunca** ocultar la intervención de la IA. Todo commit con asistencia de IA declara herramienta y modelo.
5. **Nunca** operar sobre `main`, `master`, `release/*` ni ramas protegidas sin autorización explícita.
6. **Nunca** reescribir historial publicado (`push --force`, `filter-branch`, `filter-repo`, `rebase` sobre ramas compartidas) sin autorización explícita.
7. **Nunca** modificar archivos de seguridad/CI/deploy sin revisión humana (`.github/workflows/`, `Dockerfile`, `nginx.conf`, `.env*`, `terraform/`, `k8s/`, `docker-compose*`).
8. **Siempre** detenerse si el alcance excede lo acotado en la instrucción original (ver §6).
9. **Nunca** usar `git commit --no-verify` ni `git push --no-verify` sin autorización explícita y motivo escrito.

## 2. Flujo obligatorio por tarea

Cada vez que el humano envíe un prompt que implique **acción** (no solo explicación), el agente debe seguir este flujo, en orden, sin saltarse pasos.

### 2.1 Revisar guías, skills y contexto
- Leer `AGENTS.md`, `CLAUDE.md`, `.opencode/rules.md`, `.cursor/rules`, `CONTRIBUTING.md` y `docs/` relevantes.
- Revisar si hay **skills, subagentes, comandos personalizados o herramientas especializadas** disponibles para el área (auth, DB, tests, infra) y usarlas si aplican.
- Revisar el estado real: `git status`, `git branch --show-current`, `git log -3 --oneline`.
- Revisar si hay issue, plan o ADR previo que acote el trabajo.

### 2.2 Auditar antes de actuar
- Leer el **código real** del repo, no solo el snippet del prompt.
- Verificar que los archivos mencionados existen en el estado actual.
- Identificar impacto: archivos que se tocan, tests que cubren ese código, migraciones, contratos, variables de entorno.
- Reportar hallazgos al humano **antes** de proponer cambios.

### 2.3 Proponer, no imponer
- Presentar un plan de acción antes de modificar.
- Si el plan requiere más de 3 archivos no listados, o toca áreas sensibles (§6), detenerse y pedir confirmación.
- Esperar `ok`, `dale`, `procede`, `adelante` o equivalente **antes de escribir**.

### 2.4 Ejecutar acotado
- Tocar solo los archivos autorizados.
- No reformatear archivos ajenos al cambio.
- No instalar dependencias nuevas sin autorización.
- No cambiar configuración sin autorización.

### 2.5 Verificar
- `npm run typecheck`, `npm run lint` (sin `--fix`), tests relevantes.
- Reportar la salida completa, no resumida.
- Si algo falla, detenerse y reportar; no "arreglar" fuera del alcance.

### 2.6 Reportar (ver §5)
- Listar archivos tocados.
- Adjuntar salida de comandos.
- Declarar IA utilizada (herramienta, modelo, sesión).
- Esperar confirmación antes de commit.

## 3. Commits — formato y atribución

### 3.1 Autor del commit
- **Autor**: siempre el humano responsable.
- Si el humano no tiene `user.name` / `user.email` configurados, el agente **se detiene** y pide configurarlos antes de commitear.
- La IA **nunca** se pone como autor ni como committer.

### 3.2 Trailers obligatorios (fin del mensaje de commit)

Todo commit con asistencia de IA termina con estos trailers, separados del cuerpo por una línea en blanco:
AI-Assisted-By: <herramienta>
AI-Model: <modelo>
AI-Session: <id-o-fecha-iso-8601>

- `<herramienta>`: nombre oficial, sin versión. `OpenCode`, `Claude Code`, `GitHub Copilot`, `Cursor`, `Aider`, `Codex`, `ChatGPT`, `Gemini`, etc.
- `<modelo>`: identificador del modelo tal cual lo reporta la herramienta. `claude-sonnet-4.5`, `gpt-5`, `gemini-2.5-pro`, `qwen2.5-coder-32b`, `minimax-m3.1`, etc.
- `<id-o-fecha>`: UUID de sesión si la herramienta lo expone; si no, fecha ISO-8601 (`2026-11-01T14:30:00-05:00`).

### 3.3 Prohibiciones explícitas
- **No** `Co-authored-by:` para IA.
- **No** `Generated-by:` salvo que el commit consista únicamente en código generado sin revisión humana.
- **No** atribuir a IA commits hechos por un humano sin asistencia.
- **No** inventar el modelo o la sesión. Si no se sabe, escribir `unknown` y anotarlo en el reporte.

### 3.4 Hooks del repo
- `git config commit.template .gitmessage.txt` (local al repo).
- `git config core.hooksPath .githooks` (local al repo).
- El hook `prepare-commit-msg` inyecta los trailers si el agente exporta `AI_TOOL`, `AI_MODEL`, `AI_SESSION` antes de commitear.
- El hook `commit-msg` **rechaza** el commit si detecta `AI_TOOL` en el entorno y falta el trailer `AI-Assisted-By:`.
- El script `scripts/setup-ai-hooks` (o su variante `.ps1`) activa todo de forma idempotente.

## 4. Si el prompt es ambiguo

Detenerse y preguntar **antes** de asumir. Ejemplos:

- "arregla el bug" → ¿cuál? ¿hay issue? ¿hay repro?
- "haz que funcione" → ¿qué comportamiento esperado? ¿hay test?
- "refactoriza esto" → ¿alcance? ¿qué no se debe tocar?
- "actualiza dependencias" → ¿versión objetivo? ¿breaking changes aceptables?
- "cambia el schema" → ¿migración? ¿backfill? ¿rollback?

Si el humano insiste en proceder sin aclarar, el agente deja **constancia escrita** de las suposiciones en el reporte final y en `.ai/sessions/`.

## 5. Reporte que el agente entrega al cerrar una tarea

Estructura mínima:
1. Resumen
<qué se hizo en 2-3 líneas>

2. Archivos tocados
path/to/file.ts (+12 -3)

path/to/otro.ts (+4 -0)

3. Verificaciones
☑ typecheck: 0 errores
☑ lint (sin --fix): 0 errores nuevos
☑ test relevante: X/Y passing
4. Riesgos / suposiciones
<lista>
5. IA utilizada
Herramienta: <OpenCode>

Modelo: <claude-sonnet-4.5>

Sesión: <id o fecha>

6. Pendiente de confirmación
□ Commit
□ Push
□ PR

## 6. Escalado — el agente se detiene y pide confirmación si:

- El cambio excede **3 archivos** no listados en la instrucción.
- Requiere tocar **migraciones de BD, contratos de API pública o variables de entorno**.
- Requiere tocar **CI/CD, Docker, nginx, deploy**.
- Requiere tocar **autenticación, autorización, criptografía o manejo de secretos**.
- Requiere **instalar o actualizar dependencias**.
- El humano pide algo que **contradice** este archivo.
- Un comando falla de forma inesperada y la causa raíz **no es trivial**.
- El agente ya falló **dos veces** intentando lo mismo.

## 7. Comandos prohibidos sin autorización explícita
git push
git push --force
git reset --hard
git rebase
git commit --amend (sobre commits ya publicados)
git filter-branch / git filter-repo
git tag
gh release create
npm publish
docker push
kubectl apply
terraform apply

## 8. Trazabilidad de la sesión (versionado)

Cada tarea completada deja una entrada en:
.ai/sessions/<YYYY-MM-DD>/<HHMM>-<slug>.md

Contenido mínimo:

- Herramienta, modelo, versión.
- Hash del commit resultante (o "sin commit").
- Prompt original del humano (texto literal).
- Plan ejecutado (resumen).
- Suposiciones asumidas y riesgos.
- Resultado de `typecheck`, `lint` y tests.

**Este directorio se versiona**: es la fuente de verdad para auditoría, y complementa el trailer del commit.

## 9. Excepciones

Solo un humano puede autorizar excepciones. Quedan por escrito en:

- El commit, con trailer `AI-Exception: <motivo>`.
- La entrada de `.ai/sessions/` correspondiente.

## 10. Deuda técnica (lectura obligatoria antes de proponer cambios)

### 10.1 Fuente de verdad

El inventario vive en [`TECH_DEBT.md`](./TECH_DEBT.md), en la raíz del repositorio. **Es de lectura obligatoria** antes de:

- Proponer una refactorización.
- Tocar un módulo con deuda abierta.
- "Arreglar" algo que parezca un error pero esté documentado como deuda aceptada.

### 10.2 Reglas de interacción con la deuda

1. **No arreglar deuda fuera de alcance.** Si el humano pide `A` y de paso hay deuda `DEBT-XXX` en el mismo archivo, el agente **no la toca**. Solo lo menciona en el reporte (§5) como *"deuda vecina detectada"*.
2. **No cerrar ni borrar entradas** de `TECH_DEBT.md` sin autorización explícita. La deuda se cierra con un commit dedicado y un `Resolved-By:` en la entrada.
3. **No añadir deuda nueva sin consignarla.** Si la tarea introduce un atajo consciente (ej. `any`, mock incompleto, hardcode, TODO), el agente **añade una entrada** en `TECH_DEBT.md` con el ID siguiente disponible y lo refleja en el reporte.
4. **Si la tarea toca una zona endeudada**, el reporte incluye el bloque *"Deuda vecina"* con las entradas relevantes (ID + título).
5. **No proponer refactors masivos** basados en `TECH_DEBT.md` salvo que el humano pida explícitamente "atacar deuda".

### 10.3 Formato de entrada (obligatorio)

Cada entrada usa:
DEBT-XXX — <título corto>
Severidad: BLOQUEANTE | ALTA | MEDIA | BAJA

Área: backend/<módulo> | frontend/<módulo> | infra | ci | docs | seguridad | datos

Estado: ABIERTA | EN_PROGRESO | ACEPTADA | RESUELTA

Detectada: YYYY-MM-DD

Origen: commit <hash> | PR #N | sesión .ai/sessions/<archivo> | humano

Descripción: qué pasa y por qué importa.

Impacto: qué se rompe / qué se frena si no se resuelve.

Mitigación propuesta: pasos concretos.

Criterio de cierre: cómo se verifica que quedó resuelta.

Owner (opcional):

Target (opcional): YYYY-MM-DD

Resolved-By (opcional): commit <hash> | PR #N

## 11. Actualización de este archivo

- Cambios a este archivo requieren **revisión humana** y un commit dedicado.
- El agente **no** modifica `AGENTS.md` sin autorización explícita.
- Cualquier agente que lo modifique debe anotarlo en la entrada de sesión.

---

**Última actualización**: 2026-11-01
**Mantenedor**: alexisGuille20
**Repositorio**: https://github.com/dfelipe7/Barberia-Backend

