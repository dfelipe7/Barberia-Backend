# Frontend Migration Guide: Breaking Changes & Security Enhancements

**Date:** 2026-10-31  
**Target:** `Barberia-Frontend`  
**Scope:** Multitenant Security Fixes (Account Takeover, Cross-Tenant Lockout & Public Platform API Hardening)

---

## 1. Context

The backend has closed critical security vulnerabilities involving cross-tenant account takeover, cross-tenant user lockout, and an unauthenticated public platform management API. As a result of these architectural and security fixes, three API contracts have changed and one authentication rule has been strengthened. The frontend application must adapt to these contract changes to maintain full compatibility and avoid HTTP 400/401/403 errors.

---

## 2. Change 1 — Platform Hub Directory & Admin Routes

### Summary of Change
- **Old behavior:** `GET /plataforma/negocios` was unauthenticated and returned full tenant details including internal metrics and settings.
- **New behavior:** 
  - A dedicated public endpoint **`GET /plataforma/negocios/publico`** (unauthenticated) has been introduced specifically for the public exploration hub. It returns a reduced, flattened DTO without internal business telemetry or private operational data.
  - The administrative endpoints **`GET /plataforma/negocios`**, **`POST /plataforma/negocios`**, and **`PATCH /plataforma/negocios/:id/estado`** are now strictly protected behind `JwtSesionGuard` and `PlataformaAdminGuard`. They require a valid staff JWT whose authenticated email is included in the backend's `PLATFORM_ADMIN_EMAILS` environment allowlist.

### Frontend File to Update
- `Barberia-Frontend/src/pages/Plataforma/PlataformaHubPage.tsx`

### Request & Response Shape for Public Hub
- **Method:** `GET`
- **URL:** `/plataforma/negocios/publico`
- **Auth:** None (Public)
- **Response Shape (JSON Example):**
```json
[
  {
    "id": 1,
    "nombre": "Kyrios Studio",
    "slug": "kyrios-studio",
    "ciudad": "Popayán",
    "logoBlancoUrl": "https://storage.googleapis.com/.../logo-blanco.png",
    "bannerUrl": "https://storage.googleapis.com/.../banner.png",
    "frasePrincipal": "Tu estilo, tu mejor versión"
  }
]
```

### Forbidden / Removed Fields
The public hub endpoint **flattens** the response and **does NOT include** the following fields:
- `perfil.direccion`
- `perfil.departamento`
- `zonaHoraria`
- `creadoEn`
- `estadisticas.totalReservas`
- `estadisticas.totalClientes`
- `estadisticas.totalBarberos`
- `estadisticas.totalServicios`

> **Instruction for Frontend UI:** The frontend must stop rendering or referencing these removed fields in public views. If `PlataformaHubPage.tsx` displays total metrics (e.g. counters of barbers, services, or appointments across the platform), those components must either be removed from public view or conditionally rendered only when an authorized platform admin is logged in.

### Handling 403 Forbidden on Management Routes
Calls to `POST /plataforma/negocios` (registering a new barbershop from the hub modal) or `PATCH /plataforma/negocios/:id/estado` (activating/deactivating a barbershop toggle) will now return **HTTP 403 Forbidden** if the user is unauthenticated or if their email is not allowlisted in `PLATFORM_ADMIN_EMAILS`. The frontend must handle 403 responses gracefully by displaying an informative notification ("Requiere permisos de administrador de plataforma") or prompting the user to sign in with their authorized administrator account.

---

## 3. Change 2 — Edit User No Longer Accepts Email

### Summary of Change
- **Old behavior:** `PATCH /usuarios/:id` accepted `email` in the body payload.
- **New behavior:** `PATCH /usuarios/:id` strictly rejects `email` with **HTTP 400 Bad Request** due to `forbidNonWhitelisted: true` in the backend validation pipe. The backend treats global user emails as immutable from tenant-level administration to eliminate cross-tenant account takeover risks.

### Frontend File to Update
- `Barberia-Frontend/src/features/usuarios/pages/EditarUsuarioPage.tsx`

### Instruction
1. Remove `email` from the submitted payload in the edit user form.
2. In the UI, display the email input field as **read-only** (`disabled` or static badge).
3. Only `nombre`, `apellido`, and tenant-specific role configuration fields (`esAdministrador`, `esBarbero`, `telefono`, `porcentajeComision`) should be dispatched in `PATCH /usuarios/:id`.

---

## 4. Change 3 — Change User Status Requires Explicit Membership Type (`tipo`)

### Summary of Change
- **Old behavior:** `PATCH /usuarios/:id/estado` accepted `{ estado: 'ACTIVO' | 'INACTIVO' }` and modified the user's global account (`Usuario.estado`), inadvertently locking the person out of all other barbershops on the platform.
- **New behavior:** `PATCH /usuarios/:id/estado` now requires an explicit membership target via the `tipo` property:
```json
{
  "estado": "ACTIVO",
  "tipo": "administrador"
}
```
Available options for `tipo`:
- `'administrador'`: Updates only the `Administrador` membership in the active business.
- `'barbero'`: Updates only the `Barbero` membership in the active business.
- `'ambos'`: Updates both memberships in the active business.

Missing `tipo` will be rejected immediately with **HTTP 400 Bad Request**.

### Semantics
- This operation no longer touches or suspends the global account (`Usuario.estado`). It only alters the target person's operational status for the current active tenant (`X-Negocio-Slug`).
- If the target user does not possess the requested profile in the active business (for example, requesting `tipo: "barbero"` for a user who is only an administrator), the backend returns **HTTP 409 Conflict**.
- Specific endpoints (`PATCH /usuarios/administradores/:id/estado` and `PATCH /usuarios/barberos/:usuarioId/estado`) remain **UNCHANGED** and still accept `{ estado: 'ACTIVO' | 'INACTIVO' }`.

### Frontend Files to Update
- Search for all callers of `/usuarios/${id}/estado` or `PATCH /usuarios/:id/estado` across `Barberia-Frontend` (typically user management tables, staff lists, or action dropdowns).
- Update the payload sent to include `tipo: 'administrador' | 'barbero' | 'ambos'` depending on which membership the administrator intends to toggle.

---

## 5. Change 4 — Staff Google Login Rejects Unverified Google Emails

### Summary of Change
- During Google OAuth login (`POST /auth/google/login`), the backend now enforces `payload.email_verified === true`. If the Google account does not have a verified email, the backend rejects the login with **HTTP 401 Unauthorized** (`"La cuenta de Google debe tener un correo electrónico verificado."`).
- **Frontend Impact:** No code changes required. The frontend should display the backend error message in the login alert toast/modal.

---

## 6. Non-Goals / Out of Scope for Frontend in this PR

- **Global account deactivation:** Tenant administrators can no longer deactivate a person's global platform login. Global deactivation will be managed via a future platform-level administration panel.
- **Low-severity audit findings:** Guest reservation token parameters and notification fallbacks will be addressed in separate sprints.

---

## 7. Rollout Checklist for the Frontend Owner

- [ ] **Platform Hub:** Update `PlataformaHubPage.tsx` to fetch from `GET /plataforma/negocios/publico` instead of `/plataforma/negocios`.
- [ ] **Public Views:** Remove references to deleted fields (`direccion`, `departamento`, `zonaHoraria`, `estadisticas.*`) in public hub components.
- [ ] **Admin Actions in Hub:** Add error handling for HTTP 403 when creating or toggling businesses without allowlisted platform admin credentials.
- [ ] **Edit User Page:** Set the email input to read-only in `EditarUsuarioPage.tsx` and ensure `email` is excluded from the `PATCH /usuarios/:id` request body.
- [ ] **Status Toggle:** Ensure calls to `PATCH /usuarios/:id/estado` pass the required `{ estado, tipo }` payload.
- [ ] **Testing:** Verify no console errors or undefined field warnings appear when navigating the Hub and User Management views.

---

## 8. Backend References

The following backend files were introduced or modified in this PR:
- `src/auth/google/google-auth.service.ts`
- `src/auth/google/google-auth.service.spec.ts`
- `src/modules/negocios/dto/negocio-publico.dto.ts` *(new)*
- `src/modules/negocios/guards/plataforma-admin.guard.ts` *(new)*
- `src/modules/negocios/guards/plataforma-admin.guard.spec.ts` *(new)*
- `src/modules/negocios/negocios-plataforma.controller.ts`
- `src/modules/negocios/plataforma.controller.spec.ts` *(new)*
- `src/modules/negocios/negocios.module.ts`
- `src/modules/usuarios/dto/dto-peticion/actualizar-usuario.dto.ts`
- `src/modules/usuarios/dto/dto-peticion/cambiar-estado-usuario-gestion.dto.ts` *(new)*
- `src/modules/usuarios/controller/usuarios.controller.ts`
- `src/modules/usuarios/service/usuarios.service.ts`
- `src/modules/usuarios/service/usuarios.service.spec.ts`
- `src/modules/usuarios/service/usuarios-authorization.service.ts`
- `src/modules/usuarios/service/usuarios-authorization.service.spec.ts`
- `src/modules/usuarios/service/administradores.service.ts`
- `src/modules/usuarios/service/administradores.service.spec.ts`
- `src/modules/usuarios/service/barberos.service.ts`
- `src/modules/usuarios/service/barberos.service.spec.ts`
- `src/modules/usuarios/repository/administradores.repository.ts`
- `src/modules/usuarios/repository/administradores.repository.spec.ts`
- `src/modules/usuarios/repository/usuarios.repository.ts`
- `src/modules/usuarios/repository/usuarios.repository.spec.ts`
- `.env.example`
- `.env.multitenant-dev.example`

> **Note:** **NO** Prisma migrations were generated and `prisma/schema.prisma` was **NOT** modified.
