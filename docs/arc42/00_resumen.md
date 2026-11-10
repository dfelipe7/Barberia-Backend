# 00. Resumen Ejecutivo de la Arquitectura

**Sistema:** Barbería VIP SaaS — Plataforma Multitenant de Gestión y Agendamiento  
**Versión:** 2.0.0  
**Fecha:** Noviembre 2026  
**Estándar de Documentación:** Arc42 (Revisión 7.0 ES) & IEEE 1063  

---

## Propósito del Sistema
Barbería VIP SaaS es una solución integral multi-negocio (*multitenant*) orientada al sector de la estética masculina y barberías. El sistema permite que múltiples negocios independientes operen sobre una infraestructura compartida con aislamiento estricto de datos, personalización de marca, gestión de citas en tiempo real, control de comisiones por profesional y notificaciones automatizadas vía WhatsApp.

## Componentes Principales
1. **Backend Core (NestJS 11 + Prisma 7 + MySQL 8.0):**
   * Arquitectura modular con resolución dinámica de contexto de negocio vía encabezado `X-Negocio-Slug` o subdominio.
   * Aislamiento lógico de datos mediante discriminador indexado por columna (`negocioId`).
   * Motor de reservas atómico con control de concurrencia y prevención de *double-booking*.
   * Pool de sesiones de WhatsApp independiente por sede mediante WebSockets (`@whiskeysockets/baileys`).
   * Aislamiento de almacenamiento físico para archivos multimedia por sede (`uploads/negocios/{negocioId}/`).

2. **Frontend SPA (React 19 + Vite 8 + TanStack Query 5):**
   * Portal público de clientes y catálogo por sede (`/:slug/reservar`).
   * Consola administrativa desacoplada para barberos, administradores y dueños.
   * Sistema de theming reactivo con 6 identidades estéticas de marca configurables y soporte de modo claro/oscuro (WCAG AA).
   * Landing page y hub central de la plataforma SaaS aislados de los contextos de tenant.

3. **Seguridad y Aseguramiento:**
   * SAST continuo con SonarCloud en CI/CD.
   * SCA automatizado mediante auditoría de dependencias (`npm audit` contra OWASP A03 / CVEs).
   * Validación estricta de payloads con `ValidationPipe({ forbidNonWhitelisted: true })`.
   * Esquema interactivo OpenAPI 3.0 documentado en Swagger.
