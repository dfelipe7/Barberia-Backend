# Registro de Cambios: Plataforma SaaS Multitenant y Directorio de Barberías

Este documento detalla todas las modificaciones, archivos creados, rutas implementadas y propósitos técnicos realizados en la plataforma **Kyrios Multitenant**.

---

## 1. Landing Comercial de la Plataforma SaaS (`/`)

### Archivos creados / modificados:
- `Barberia-Frontend/src/pages/Plataforma/LandingPlataformaPage.tsx`
- `Barberia-Frontend/src/pages/Plataforma/LandingPlataformaPage.css`
- `Barberia-Frontend/src/App.tsx`

### ¿Qué hace?
- **Ruta principal:** `http://localhost:5173/`
- Convierte la raíz del proyecto en la vitrina comercial de la plataforma SaaS (orientada a barberías y franquicias interesadas en unirse al sistema).
- **Hero & Propuesta de valor:** "El sistema operativo definitivo para barberías de alto estándar".
- **Mockup interactivo en vivo:** Simula la visualización de una cita confirmada, notificaciones automáticas de WhatsApp y métricas de crecimiento.
- **Grilla de pilares clave:** Agendamiento inteligente sin fricción, Notificaciones WhatsApp automáticas, Aislamiento multitenant, Portal VIP para clientes, Experiencia móvil responsive y Control total de roles (Superadmin, Administrador, Barbero, Cliente).
- **Llamadas a la acción (CTAs):**
  - Botón hacia el Hub de Barberías (`/plataforma`).
  - Botón para probar la experiencia de reserva en vivo en una barbería demo (`/barberia-demo-2`).

---

## 2. Consola Hub de Barberías Multitenant (`/plataforma`)

### Archivos creados / modificados:
- `Barberia-Frontend/src/pages/Plataforma/PlataformaHubPage.tsx`
- `Barberia-Frontend/src/pages/Plataforma/PlataformaHubPage.css`

### ¿Qué hace?
- **Ruta:** `http://localhost:5173/plataforma` (y alias `/explorar`).
- **Visualización estilo Netflix:** Catálogo en cuadrícula con tarjetas oscuras ("posters") de cada barbería registrada en la base de datos.
- **Cinta de estadísticas globales:** Muestra sedes totales, sedes activas, total de barberos en red y total de citas agendadas sumando todas las sedes.
- **Buscador interactivo en tiempo real:** Filtra sedes por nombre o por identificador de slug.
- **Acciones directas por tarjeta:**
  - `Abrir Sitio Web`: Abre la landing pública de esa sede en una nueva pestaña (`/:slug`).
  - `Reservar`: Abre el wizard de reservas de clientes de esa sede (`/:slug/reservar`).
  - `Panel`: Abre el acceso de inicio de sesión de personal (`/:slug/login`).
  - `Interruptor Activo/Inactivo`: Activa o suspende una barbería directamente en la base de datos con un clic.
- **Navegación de retorno:** Botón `< Volver a la Web Principal` y logotipo enlazado a la raíz `/`.
- **Modal de creación rápida con Dueño Inicial:**
  - Formulario para dar de alta una nueva barbería con autogeneración de slug en tiempo real.
  - Sección para definir el **Dueño / Superadministrador Inicial** mediante su correo de Google, nombre y apellido.

---

## 3. Endpoints Backend de la Plataforma (NestJS + Prisma)

### Archivos creados / modificados:
- `Barberia-Backend/src/modules/negocios/negocios-plataforma.controller.ts`
- `Barberia-Backend/src/modules/negocios/dto/crear-negocio-plataforma.dto.ts`
- `Barberia-Backend/src/modules/negocios/dto/cambiar-estado-negocio.dto.ts`
- `Barberia-Backend/src/modules/negocios/negocios.module.ts`

### ¿Qué hace?
- **`GET /plataforma/negocios`**: Lista todas las barberías registradas, su perfil visual y el conteo de barberos, servicios, reservas y clientes.
- **`POST /plataforma/negocios`**: Da de alta una nueva sede. Si se proporciona un correo de dueño, lo vincula automáticamente con rol `superadmin = true` en la tabla `administradores`. Se ejecuta mediante **escrituras anidadas nativas de Prisma** dentro de `Negocio.create`, garantizando atomicidad y respetando las reglas de aislamiento multitenant.
- **`PATCH /plataforma/negocios/:id/estado`**: Alterna el estado de una barbería entre `ACTIVO` e `INACTIVO`.

---

## 4. Onboarding Profesional Multisede (Barberos y Administradores)

### Archivos modificados:
- `Barberia-Backend/src/modules/usuarios/service/barberos.service.ts`
- `Barberia-Backend/src/modules/usuarios/service/administradores.service.ts`

### ¿Qué hace?
- **Antes:** Si se intentaba registrar a un barbero o administrador cuyo correo ya existía en la plataforma, el sistema arrojaba un error de conflicto (`ConflictException: Ya existe un usuario en el sistema...`), impidiendo que una persona trabajara en dos sedes.
- **Ahora (Estándar SaaS):**
  - **Identidad Global:** La persona física mantiene un único registro en `Usuario` y una sola cuenta de Google.
  - **Membresías por Sede:** Si el correo ya existe en otra sede, el sistema lo reconoce y le crea su membresía en la nueva barbería con su propio teléfono, comisión y horarios exclusivos de esa sede.
  - Si el usuario ya forma parte del equipo en la **misma sede**, el sistema lo advierte o lo reactiva si estaba inactivo.

---

## 5. Higiene y Corrección de Slugs en el Frontend

### Archivos modificados:
- `Barberia-Frontend/src/shared/lib/http/axios.ts`
- `Barberia-Frontend/src/pages/Login/LoginPage.tsx`

### ¿Qué hace?
- **Problema corregido:** Al navegar a `/plataforma`, el extractor de slug en `axios.ts` interpretaba erróneamente la palabra `"plataforma"` como si fuera una barbería, guardándola en `localStorage` y enviando la cabecera `X-Negocio-Slug: plataforma`. Esto provocaba que el backend rechazara con 404 las consultas de barberos y servicios en el panel.
- **Solución implementada:**
  - Se añadieron formalmente `'plataforma'`, `'explorar'`, `'reserva'` y `'c'` a `RUTAS_RESERVADAS`.
  - Se añadió una rutina de purga automática en `obtenerNegocioSlugActivo()` que elimina cualquier slug inválido guardado en `localStorage`.
  - En `LoginPage.tsx`, se garantiza que el slug recibido por parámetro (`/:slug/login`) se almacene de forma precisa y fidedigna.

---

## 6. Portal VIP del Cliente con Soporte Dark/Light

### Archivos creados / modificados:
- `Barberia-Frontend/src/features/reservas/pages/ClientePortalPage.tsx`
- `Barberia-Frontend/src/features/reservas/pages/ClientePortalPage.css`
- `Barberia-Frontend/src/features/reservas/pages/ClienteAccesoPage.tsx`
- `Barberia-Frontend/src/features/reservas/pages/AuthSplitLayout.css`
- `Barberia-Frontend/src/pages/Home/components/SelectorAccesoModal.tsx`
- `Barberia-Frontend/src/pages/Home/components/HomeNavbar.tsx`

### ¿Qué hace?
- **Ruta:** `http://localhost:5173/:slug/cliente/mi-cuenta`
- Rediseño con estética de lujo (paleta Kyrios: `#0071BC`, `#0C0C0C`, `#FFFDFA`).
- **Conmutador de Tema:** Permite alternar entre **Modo Claro**, **Modo Oscuro** y **Seguir Sistema**.
- **Contraste optimizado:** Legibilidad nítida en nombres de servicios, barberos, estados y fechas.
- **Pestañas estructuradas:**
  - *Mis Citas Agendadas* (con opción de reprogramar o cancelar turnos).
  - *Mis Favoritos* (barberos y servicios preferidos).
  - *Tarjeta de Fidelización* (puntos acumulados y recompensas).
  - *Mi WhatsApp y Perfil* (gestión de número para recordatorios).
- **Acceso Split-Screen:** Pantalla de inicio de sesión dividida para clientes y personal, preservando el contexto del negocio.

---

## Resumen del Ruteo de URLs

| Ruta | Vista | Alcance |
| :--- | :--- | :--- |
| `http://localhost:5173/` | Landing SaaS Comercial | Global de la plataforma |
| `http://localhost:5173/plataforma` | Hub / Directorio de Barberías | Global de la plataforma |
| `http://localhost:5173/:slug` | Landing pública de la barbería | Por sede / tenant |
| `http://localhost:5173/:slug/reservar` | Wizard de reservas | Por sede / tenant |
| `http://localhost:5173/:slug/login` | Login de personal de la barbería | Por sede / tenant |
| `http://localhost:5173/:slug/cliente/mi-cuenta` | Portal VIP del cliente | Por sede / tenant |
| `http://localhost:5173/dashboard` | Panel administrativo | Sede activa resuelta |
