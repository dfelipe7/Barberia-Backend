# Registro Completo de Cambios: Plataforma Multitenant y Mejoras del Sistema

Este documento describe **todos los cambios, módulos actualizados, endpoints creados o modificados y componentes desarrollados** en la rama `feature/multitenant-core-fixes` para `Barberia-Backend` y `Barberia-Frontend`.

---

## Índice de Contenidos

1. [Edición de Usuarios y Normalización de Perfiles Multitenant](#1-edición-de-usuarios-y-normalización-de-perfiles-multitenant)
2. [Asociación de Barberos a Servicios](#2-asociación-de-barberos-a-servicios)
3. [Autogestión de Reservas para Invitados y Notificaciones de WhatsApp](#3-autogestión-de-reservas-para-invitados-y-notificaciones-de-whatsapp)
4. [Perfil del Cliente y Sincronización de Teléfono](#4-perfil-del-cliente-y-sincronización-de-teléfono)
5. [Landing Comercial de la Plataforma SaaS (`/`)](#5-landing-comercial-de-la-plataforma-saas-)
6. [Consola Hub de Barberías Multitenant (`/plataforma`)](#6-consola-hub-de-barberías-multitenant-plataforma)
7. [Endpoints Backend de la Plataforma (Gestión de Negocios)](#7-endpoints-backend-de-la-plataforma-gestión-de-negocios)
8. [Onboarding Profesional Multisede (Barberos y Administradores)](#8-onboarding-profesional-multisede-barberos-y-administradores)
9. [Higiene y Sanitización de Slugs en el Frontend](#9-higiene-y-sanitización-de-slugs-en-el-frontend)
10. [Portal VIP del Cliente con Soporte Dark/Light](#10-portal-vip-del-cliente-con-soporte-darklight)
11. [Matriz Consolidada de Endpoints](#11-matriz-consolidada-de-endpoints)

---

## 1. Edición de Usuarios y Normalización de Perfiles Multitenant

### Archivos modificados:
- `Barberia-Backend/src/modules/usuarios/service/usuarios.service.ts`
- `Barberia-Backend/src/modules/usuarios/service/usuarios-authorization.service.ts`
- `Barberia-Backend/src/modules/usuarios/dto/dto-respuesta/usuario-perfil.dto.ts`
- `Barberia-Frontend/src/features/usuarios/pages/EditarUsuarioPage.tsx`

### ¿Qué problema solucionó?
En el paso al modelo multitenant, Prisma transformó las relaciones de `usuario.administrador` y `usuario.barbero` de 1:1 a 1:N (`administradores[]` y `barberos[]`), porque una persona puede tener perfiles en diferentes barberías. Esto provocaba que al intentar editar un usuario o cambiar sus roles en `EditarUsuarioPage`, el backend leyera los campos en `undefined` o fallara la validación de autorización.

### Cambios realizados:
- **Método central de normalización (`normalizarPerfilesNegocio`):** Se introdujo una función en `usuarios.service.ts` que recibe el usuario de Prisma y extrae de los arreglos `administradores[]` y `barberos[]` el perfil específico que corresponde al `negocioId` activo de la petición, proyectándolos como `usuario.administrador` y `usuario.barbero` singulares. Esto resolvió el problema donde el panel no detectaba los roles del usuario al editarlo.
- **Gestión segura de roles (`gestionarRolAdministrador` y `gestionarRolBarbero`):** Ahora permite al Superadmin activar o desactivar el perfil de administrador o barbero de un usuario para su sede sin alterar los roles globales ni los de otras barberías.
- **Blindaje de autorización (`usuarios-authorization.service.ts`):** Verifica que la persona que edita a otro usuario sea realmente el `SUPERADMIN` de la barbería activa.
- **Soporte en DTO (`usuario-perfil.dto.ts`):** Retorna `roles`, `administrador` y `barbero` computados fidedignamente para la sede en sesión.

---

## 2. Asociación de Barberos a Servicios

### Archivos modificados:
- `Barberia-Backend/src/modules/servicios/service/servicios.service.ts`
- `Barberia-Backend/src/modules/servicios/repository/servicios.repository.ts`
- `Barberia-Backend/src/modules/negocios/prisma-extension-aislamiento.ts`
- `Barberia-Frontend/src/features/servicios/components/ServicioFormModal.tsx`

### ¿Qué problema solucionó?
Al crear o editar un servicio (`POST /servicios` o `PATCH /servicios/:id`), el formulario permite seleccionar qué barberos prestan ese servicio (`barberoIds: number[]`). Anteriormente, la sincronización en la tabla intermedia `barberoServicios` fallaba porque la extensión de seguridad de Prisma rechazaba operaciones de borrado o creación masiva en modelos compuestos de relación que no tenían contexto directo.

### Cambios realizados:
- **Normalización de IDs de Barberos (`normalizarYValidarBarberosActivos`):** Método implementado en `servicios.service.ts` que recibe los IDs enviados desde el frontend (que podían ser `Usuario.id` o `Barbero.id`) y los traduce de forma fidedigna al `Barbero.id` real de esa barbería, verificando que pertenezcan a la sede activa antes de insertarlos en la tabla intermedia `barberoServicios`.
- **Sincronización en repositorio:** Se reescribió `sincronizarBarberos` en `servicios.repository.ts` usando transacciones controladas para eliminar asociaciones previas y recrear las nuevas de forma limpia.
- **Ajuste en `prisma-extension-aislamiento.ts`:** Se refinó la regla de `deleteMany` para tablas intermedias tenant-scoped (`barberoServicios`) garantizando que siempre lleven el filtro de `negocioId`.

---

## 3. Autogestión de Reservas para Invitados y Notificaciones de WhatsApp

### Archivos modificados:
- `Barberia-Backend/src/modules/reservas/controller/reservas.controller.ts`
- `Barberia-Backend/src/modules/reservas/service/reservas.service.ts`
- `Barberia-Backend/src/modules/reservas/repository/reservas.repository.ts`
- `Barberia-Backend/src/modules/whatsapp/whatsapp.service.ts`
- `Barberia-Frontend/src/features/reservas/pages/ReservaGestionInvitadoPage.tsx`
- `Barberia-Frontend/src/App.tsx`

### ¿Qué hace?
- **Endpoint nuevo:** `GET /reservas/invitado/:reservaId?token=...`
  - Permite a un cliente que agendó como **invitado** (sin cuenta de Google) consultar los detalles completos de su cita de forma segura mediante un token firmado.
- **Acciones directas:**
  - `PATCH /reservas/invitado/:reservaId/reprogramar?token=...`
  - `PATCH /reservas/invitado/:reservaId/cancelar?token=...`
- **Ruta corta amigable en el Frontend:**
  - `http://localhost:5173/:slug/c/:id/:token`
  - Al abrir este enlace desde el celular, el cliente ve su comprobante, estado del turno y botones directos para reprogramar o cancelar.
- **Integración con WhatsApp:**
  - Los mensajes automáticos de confirmación, recordatorio y reprogramación ahora incluyen el enlace dinámico directo a la sede (`${frontendUrl}/${negocio.slug}/c/${reserva.id}/${token}`).

---

## 4. Perfil del Cliente y Sincronización de Teléfono

### Archivos creados / modificados:
- `Barberia-Backend/src/auth/clientes/clientes-auth.controller.ts`
- `Barberia-Backend/src/auth/clientes/clientes-auth.service.ts`
- `Barberia-Backend/src/auth/clientes/dto/actualizar-perfil-cliente.dto.ts`
- `Barberia-Backend/src/modules/reservas/repository/clientes.repository.ts`
- `Barberia-Backend/src/modules/reservas/service/reservas.service.ts`

### ¿Qué hace?
- **Endpoints nuevos:**
  - `GET /auth/clientes/perfil`: Consulta la información de la ficha del cliente autenticado con Google en esa sede.
  - `PATCH /auth/clientes/perfil`: Permite al cliente actualizar su nombre, apellido y su número de WhatsApp de avisos.
- **Sincronización en reservas:**
  - Cuando un cliente autenticado agenda una cita y proporciona su teléfono, el backend actualiza automáticamente su ficha de cliente si no tenía teléfono registrado, evitando que deba ingresarlo manualmente en el futuro.

---

## 5. Landing Comercial de la Plataforma SaaS (`/`)

### Archivos creados / modificados:
- `Barberia-Frontend/src/pages/Plataforma/LandingPlataformaPage.tsx`
- `Barberia-Frontend/src/pages/Plataforma/LandingPlataformaPage.css`
- `Barberia-Frontend/src/App.tsx`

### ¿Qué hace?
- **Ruta:** `http://localhost:5173/`
- Convierte la raíz del sistema en una página de presentación comercial orientada a barberías y franquicias.
- **Contenido:**
  - Hero con titular y propuesta de valor ("El sistema operativo definitivo para barberías de alto estándar").
  - Mockup en vivo simulando citas confirmadas, bot de WhatsApp y métricas.
  - Pilares: agendamiento inteligente, WhatsApp bot, aislamiento multitenant, portal VIP, responsive y control de roles.
  - Botones de acceso directo al Hub de Barberías (`/plataforma`) y a la barbería demo (`/barberia-demo-2`).

---

## 6. Consola Hub de Barberías Multitenant (`/plataforma`)

### Archivos creados / modificados:
- `Barberia-Frontend/src/pages/Plataforma/PlataformaHubPage.tsx`
- `Barberia-Frontend/src/pages/Plataforma/PlataformaHubPage.css`

### ¿Qué hace?
- **Ruta:** `http://localhost:5173/plataforma` (y alias `/explorar`).
- Galería en cuadrícula estilo tarjetas/posters tipo Netflix de todas las barberías registradas en la base de datos.
- **Métricas globales en tiempo real:** Sedes totales, sedes activas, barberos en red y citas agendadas totales.
- **Buscador interactivo:** Filtra en vivo por nombre o slug.
- **Acciones directas por barbería:**
  - `Abrir Sitio Web` (`/:slug`)
  - `Reservar` (`/:slug/reservar`)
  - `Panel` (`/:slug/login`)
  - `Activar / Desactivar` (interruptor de estado conectado a BD).
- **Botón de retorno:** `< Volver a la Web Principal` para regresar a la landing `/`.
- **Modal de creación:** Formulario para registrar una nueva sede y asignar de inmediato el correo de Google de su **Dueño / Superadministrador Inicial**.

---

## 7. Endpoints Backend de la Plataforma (Gestión de Negocios)

### Archivos creados / modificados:
- `Barberia-Backend/src/modules/negocios/negocios-plataforma.controller.ts`
- `Barberia-Backend/src/modules/negocios/dto/crear-negocio-plataforma.dto.ts`
- `Barberia-Backend/src/modules/negocios/dto/cambiar-estado-negocio.dto.ts`
- `Barberia-Backend/src/modules/negocios/negocios.module.ts`

### ¿Qué hace?
- **`GET /plataforma/negocios`**: Lista todas las barberías con su perfil, slug y conteo de barberos, servicios, reservas y clientes.
- **`POST /plataforma/negocios`**: Registra una nueva sede. Si se especifica correo de dueño, lo vincula automáticamente como `superadmin = true` en `administradores`. Se realiza mediante **escrituras anidadas nativas de Prisma** en `Negocio.create`, garantizando inserción atómica en una sola sentencia SQL sin violar el middleware de aislamiento.
- **`PATCH /plataforma/negocios/:id/estado`**: Activa o suspende una barbería en la base de datos.

---

## 8. Onboarding Profesional Multisede (Barberos y Administradores)

### Archivos modificados:
- `Barberia-Backend/src/modules/usuarios/service/barberos.service.ts`
- `Barberia-Backend/src/modules/usuarios/service/administradores.service.ts`

### ¿Qué hace?
- **Eliminación del bloqueo de correo duplicado:** Antes, intentar registrar a un barbero o administrador cuyo correo ya existía en la plataforma arrojaba `ConflictException`.
- **Estándar SaaS Global:**
  - La persona mantiene su cuenta única global de Google (`Usuario`).
  - Si el usuario ya existe en la plataforma (en otra sede), el sistema lo reconoce y **le crea su membresía en la nueva barbería** con su propio teléfono, comisión y horarios exclusivos de esa sede.
  - Si el usuario ya forma parte del equipo en la **misma sede**, el sistema lo advierte o lo reactiva si estaba inactivo.

---

## 9. Higiene y Sanitización de Slugs en el Frontend

### Archivos modificados:
- `Barberia-Frontend/src/shared/lib/http/axios.ts`
- `Barberia-Frontend/src/pages/Login/LoginPage.tsx`

### ¿Qué hace?
- **Problema corregido:** Al entrar a `/plataforma`, `axios.ts` guardaba `"plataforma"` en `localStorage` como si fuera el slug de un negocio. Luego, en el panel administrativo, enviaba `X-Negocio-Slug: plataforma`, causando errores 404 en las consultas de barberos y servicios.
- **Solución implementada:**
  - Se añadieron `'plataforma'`, `'explorar'`, `'reserva'` y `'c'` a `RUTAS_RESERVADAS`.
  - Se implementó purga automática en `obtenerNegocioSlugActivo()` para limpiar cualquier valor reservado residual en `localStorage`.
  - En `LoginPage.tsx`, se garantiza que el slug recibido por URL (`/:slug/login`) se fije de forma prioritaria en `localStorage`.

---

## 10. Portal VIP del Cliente con Soporte Dark/Light

### Archivos creados / modificados:
- `Barberia-Frontend/src/features/reservas/pages/ClientePortalPage.tsx`
- `Barberia-Frontend/src/features/reservas/pages/ClientePortalPage.css`
- `Barberia-Frontend/src/features/reservas/pages/ClienteAccesoPage.tsx`
- `Barberia-Frontend/src/features/reservas/pages/AuthSplitLayout.css`
- `Barberia-Frontend/src/pages/Home/components/SelectorAccesoModal.tsx`
- `Barberia-Frontend/src/pages/Home/components/HomeNavbar.tsx`

### ¿Qué hace?
- **Ruta:** `http://localhost:5173/:slug/cliente/mi-cuenta`
- Rediseño con estética luxury siguiendo la paleta oficial de Kyrios (`#0071BC`, `#0C0C0C`, `#FFFDFA`).
- **Conmutador de tema:** Soporte para **Modo Claro**, **Modo Oscuro** y **Seguir Sistema**.
- **Contraste y legibilidad:** Tipografía clara y badges de estado legibles en ambos modos.
- **Pestañas:** Mis Citas Agendadas, Mis Favoritos, Tarjeta de Fidelización y Mi Perfil/WhatsApp.
- **Autenticación Split-Screen:** Pantalla dividida elegante para acceso de clientes y personal.

---

## 11. Matriz Consolidada de Endpoints

| Método | Endpoint | Módulo / Controlador | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/plataforma/negocios` | `NegociosPlataformaController` | Lista todas las barberías registradas con métricas agregadas |
| `POST` | `/plataforma/negocios` | `NegociosPlataformaController` | Registra una nueva sede y asigna a su dueño inicial (`superadmin`) |
| `PATCH` | `/plataforma/negocios/:id/estado` | `NegociosPlataformaController` | Activa o desactiva una sede en la base de datos |
| `GET` | `/auth/clientes/perfil` | `ClientesAuthController` | Obtiene el perfil del cliente autenticado con Google |
| `PATCH` | `/auth/clientes/perfil` | `ClientesAuthController` | Actualiza teléfono y datos del cliente |
| `GET` | `/reservas/invitado/:id` | `ReservasController` | Consulta detalle de reserva de invitado mediante token |
| `PATCH` | `/reservas/invitado/:id/reprogramar`| `ReservasController` | Reprograma cita de invitado validando token |
| `PATCH` | `/reservas/invitado/:id/cancelar` | `ReservasController` | Cancela cita de invitado validando token |
| `POST` | `/barberos` | `BarberosController` | Crea barbero o vincula usuario existente a la sede (multisede) |
| `POST` | `/administradores` | `AdministradoresController` | Crea administrador o vincula usuario existente a la sede |
| `PATCH` | `/usuarios/:id` | `UsuariosController` | Edita usuario y gestiona sus roles dentro de la sede activa |
| `POST` | `/servicios` | `ServiciosController` | Crea servicio asociando barberos de la sede activa |
| `PATCH` | `/servicios/:id` | `ServiciosController` | Actualiza servicio y sincroniza barberos asociados |
