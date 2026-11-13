# 🔎 Matriz de Verificación y Trazabilidad de Código Fuente — Barbería VIP SaaS
### Manual de Usuario (Versión 2.1.0) vs. Implementación en Código

> **Objetivo:** Cumplimiento de la Cláusula 6 y 7 de la norma **ISO/IEC/IEEE 26514:2022**. Demostrar que cada afirmación, ruta, rol, límite y mensaje documentado en el manual proviene de una validación real del código fuente de **Barbería VIP SaaS** (Backend NestJS + Prisma y Frontend React).

---

## 📋 Tabla de Verificación de Afirmaciones

| Sección del Manual | Afirmación / Dato Documentado | Tipo de Dato | Archivo de Código Fuente de Verificación | Estado |
| :--- | :--- | :---: | :--- | :---: |
| **Cabecera** | Versión de backend `0.0.1` | Versión | `Barberia-Backend/package.json` | ✅ Verificado |
| **Cabecera** | Versión de frontend `0.0.0` | Versión | `Barberia-Frontend/package.json` | ✅ Verificado |
| **1.1** | Idioma predeterminado español (`es-CO`) | Idioma | `Barberia-Frontend/src/App.tsx` | ✅ Verificado |
| **2.3** | Componente de encabezado y menú hamburguesa | UI / Layout | `Barberia-Frontend/src/shared/layout/Header.tsx` | ✅ Verificado |
| **2.3** | Menú desplegable de usuario y avatar | UI / Layout | `Barberia-Frontend/src/shared/layout/UserDropdown.tsx` | ✅ Verificado |
| **2.3** | Cambio de tema secuencial (Claro, Oscuro, Sistema) | UI / Estado | `Barberia-Frontend/src/shared/context/ThemeContext.tsx` | ✅ Verificado |
| **2.3** | Selector dinámico de idiomas en la interfaz | UI | No existe selector dinámico en el código | ⚠️ `[CONFIRMAR: selector multilingüe planificado]` |
| **2.3** | Indicador "WhatsApp offline" en color rojo | UI / Alerta | `Barberia-Frontend/src/shared/layout/WhatsAppStatusIndicator.tsx` | ✅ Verificado |
| **2.3** | Diálogo de confirmación al cerrar sesión | UI / Modal | `Barberia-Frontend/src/shared/layout/Header.tsx` | ✅ Verificado |
| **3.1** | Dominio base de producción | Red / URL | `.env.example` / Sin dominio productivo fijo | ⚠️ `[CONFIRMAR: dominio base de producción]` |
| **3.3** | Doble modalidad de agendamiento (Servicio o Barbero) | Funcionalidad | `Barberia-Frontend/src/features/reservas/pages/ReservaClientePage.tsx` | ✅ Verificado |
| **3.3** | Campos de reserva: nombre, apellido, teléfono (invitado) | Validación DTO | `Barberia-Backend/src/modules/reservas/dto/dto-peticion/crear-reserva.dto.ts` | ✅ Verificado |
| **3.3** | Regex de fecha `^\d{4}-\d{2}-\d{2}$` y hora `HH:mm` | Validación DTO | `Barberia-Backend/src/modules/reservas/dto/dto-peticion/crear-reserva.dto.ts` | ✅ Verificado |
| **3.5** | Ruta corta de gestión: `/:slug/c/:id/:token` | Enrutamiento | `Barberia-Frontend/src/App.tsx` (`ReservaGestionInvitadoPage.tsx`) | ✅ Verificado |
| **3.5** | Política de anticipación de cancelación en minutos | Lógica de Negocio | `Barberia-Backend/src/modules/reservas/service/reservas.service.ts` | ✅ Verificado |
| **3.6** | Catálogo público de productos (`/:slug/catalogo/productos`) | Enrutamiento | `Barberia-Frontend/src/pages/Catalogo/Productos/CatalogoProductosPage.tsx` | ✅ Verificado |
| **3.7** | Portal de cliente registrado (`/:slug/cliente/mi-cuenta`) | Enrutamiento | `Barberia-Frontend/src/features/reservas/pages/ClientePortalPage.tsx` | ✅ Verificado |
| **4.1** | Autenticación 100% Google Sign-In (sin contraseñas) | Seguridad / Auth | `Barberia-Frontend/src/pages/Login/LoginPage.tsx` (`@react-oauth/google`) | ✅ Verificado |
| **4.1** | Endpoint de validación Google: `/auth/google` | Backend Auth | `Barberia-Backend/src/modules/autenticacion/controller/auth.controller.ts` | ✅ Verificado |
| **4.3** | Estados de cita: `COMPLETED`, `NO_SHOW`, `CANCELLED` | Enums Prisma | `Barberia-Backend/prisma/schema.prisma` (`ReservationStatus`) | ✅ Verificado |
| **4.4** | Bloqueo de horario: fecha, startTime, endTime, motivo | Validación DTO | `Barberia-Backend/src/modules/horarios/dto/dto-peticion/crear-bloqueo-horario.dto.ts` | ✅ Verificado |
| **5.1** | Límites de recursos gráficos: SVG $\le$ 256 KB, PNG $\le$ 2 MB | Constantes | `Barberia-Backend/src/modules/perfil-negocio/perfil-negocio.constants.ts` | ✅ Verificado |
| **5.1** | Coordenadas GPS: Latitud [-90, 90], Longitud [-180, 180] | Validación DTO | `Barberia-Backend/src/modules/perfil-negocio/perfil-negocio.constants.ts` | ✅ Verificado |
| **5.1** | Redes sociales: protocolo `https` obligatorio, máx. 500 car. | Validación DTO | `Barberia-Backend/src/modules/perfil-negocio/dto/dto-peticion/crear-red-social.dto.ts` | ✅ Verificado |
| **5.2** | Servicio: nombre (3-100 car.), precio $\ge 0$, duración $\ge 1$ | Validación DTO | `Barberia-Backend/src/modules/servicios/dto/dto-peticion/crear-servicio.dto.ts` | ✅ Verificado |
| **5.3** | Barbero: nombre (2-50 car.), comisión (0-100), teléfono regex | Validación DTO | `Barberia-Backend/src/modules/usuarios/dto/dto-peticion/crear-barbero.dto.ts` | ✅ Verificado |
| **5.4** | Producto: nombre máx. 100 car., precio 0.01 a 99.999.999,99 | Constantes | `Barberia-Backend/src/modules/productos/productos.constants.ts` | ✅ Verificado |
| **5.4** | Imagen de producto: JPG, PNG o WEBP de máx. 5 MB | Constantes | `Barberia-Backend/src/modules/productos/productos.constants.ts` | ✅ Verificado |
| **5.5** | Conexión de WhatsApp con Baileys por sesión de tenant | Servicio Backend | `Barberia-Backend/src/modules/whatsapp/service/whatsapp.service.ts` | ✅ Verificado |
| **5.6** | Variables dinámicas: `{cliente}`, `{servicio}`, `{fecha}`, etc. | Motor Plantillas | `Barberia-Backend/src/modules/whatsapp/templates/whatsapp-template.engine.ts` | ✅ Verificado |
| **5.7** | Reserva administrativa en mostrador (`CrearReservaAdminDto`) | Validación DTO | `Barberia-Backend/src/modules/reservas/dto/dto-peticion/crear-reserva-admin.dto.ts` | ✅ Verificado |
| **5.8** | Métricas del Dashboard (citas hoy, no-shows, liquidación) | UI / Páginas | `Barberia-Frontend/src/pages/Dashboard/Dashboard.tsx` | ✅ Verificado |
| **6.1** | Alta de barbería: nombre (2-150 car.), slug (2-63 car.) | Validación DTO | `Barberia-Backend/src/modules/negocios/dto/crear-negocio-plataforma.dto.ts` | ✅ Verificado |
| **6.2** | Lista de 21 slugs reservados (`RUTAS_RESERVADAS`) | Constante Front | `Barberia-Frontend/src/shared/lib/http/axios.ts` | ✅ Verificado |
| **6.3** | Estados de negocio: `ACTIVO`, `INACTIVO` | Enums Prisma | `Barberia-Backend/prisma/schema.prisma` (`EstadoNegocio`) | ✅ Verificado |
| **7.1** | Mensajes de error mapeados (401, 403, 404, 409, 400, 503) | Utilidad Front | `Barberia-Frontend/src/shared/lib/mapApiError.ts` | ✅ Verificado |
| **7.1** | Mensaje de error por cancelación fuera de plazo | Servicio Backend | `Barberia-Backend/src/modules/reservas/service/reservas.service.ts` (L1427) | ✅ Verificado |
| **9.0** | Contacto oficial de soporte técnico | Soporte | Sin canal de soporte fijo definido en código | ⚠️ `[CONFIRMAR: Canal o correo oficial de soporte técnico]` |

---

## 📌 Resumen de marcadores `[CONFIRMAR]` pendientes

1. **Dominio base de producción:** `[CONFIRMAR: dominio base de producción]` (utilizado en las URLs canónicas del manual como `https://<dominio>/:slug`).
2. **Selector de idioma multilingüe:** `[CONFIRMAR: selector de idioma multilingüe planificado para futuras versiones]` (el sistema opera 100% en español en la actualidad).
3. **Canal o correo de soporte técnico:** `[CONFIRMAR: Canal o correo oficial de soporte técnico]` (debe ser suministrado por la institución u operador del SaaS en producción).
