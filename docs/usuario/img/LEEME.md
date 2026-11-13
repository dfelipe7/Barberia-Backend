# 📸 Registro de Capturas de Pantalla Pendientes — Barbería VIP SaaS

Este documento contiene el inventario formal de capturas de pantalla requeridas para ilustrar el **Manual de Usuario (versión 2.1.0)** conforme a los lineamientos de diseño visual y accesibilidad del estándar **ISO/IEC/IEEE 26514:2022**.

---

## 📐 Especificaciones de Captura

* **Resolución Escritorio (Desktop):** Ancho recomendado de **1280 px** (viewport estándar `1280 x 800` o `1440 x 900`).
* **Resolución Móvil (Mobile):** Ancho recomendado de **390 px** (viewport iPhone 13/14/15 `390 x 844`).
* **Formato de Archivo:** PNG optimizado con compresión sin pérdidas.
* **Privacidad de Datos:** Utilizar datos de prueba (*mock data*) evitando nombres, correos o teléfonos personales reales en las capturas.
* **Modo de Color:** Salvo que se indique lo contrario, capturar en **Modo Claro** para máxima legibilidad en impresiones y lectores de pantalla.

---

## 📋 Inventario de Capturas del Manual

| Nombre de archivo | Pantalla / Módulo | Ruta en la aplicación | Ancho sugerido | Modo sugerido | Descripción de la escena a capturar |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `pantalla-portal-inicio.png` | Portada del Portal Público | `/:slug` | 1280 px / 390 px | Claro | Encabezado con logotipo, horario comercial, lema de la sede, botón de GPS y catálogo visual de servicios. |
| `pantalla-reserva-stepper.png` | Asistente de Reserva Online | `/:slug/reservar` | 390 px (Móvil) | Claro | Asistente de reserva en el paso 3 (calendario y franjas horarias libres de 30 o 45 min). |
| `pantalla-reserva-comprobante.png` | Comprobante Digital de Cita | `/:slug/reservar` (Paso 4) | 390 px (Móvil) | Claro | Pantalla de confirmación con código de reserva, servicio, barbero, fecha, hora y aviso de WhatsApp. |
| `pantalla-login.png` | Inicio de Sesión Seguro | `/:slug/login` | 1280 px / 390 px | Claro | Pantalla de login en pestaña "Personal / Staff" mostrando el botón oficial "Continuar con Google". |
| `pantalla-agenda-barbero.png` | Agenda de Turnos del Barbero | `/:slug/reservas` | 1280 px | Claro | Calendario interactivo con citas pendientes en amarillo, completadas en verde y bloques en gris. |
| `pantalla-configuracion-perfil.png` | Configuración de la Sede | `/:slug/configuracion` | 1280 px | Claro | Panel administrativo con formulario de lema, extractor de Google Maps y selector de temas de marca. |
| `pantalla-whatsapp-qr.png` | Vinculación WhatsApp Web | `/:slug/whatsapp` | 1280 px | Claro | Pantalla con el Código QR generado en vivo y las instrucciones de escaneo desde el móvil. |
| `pantalla-dashboard.png` | Tablero de Control y Métricas | `/:slug/dashboard` | 1280 px | Claro | Vista principal con contadores de citas hoy, ingresos estimados, inasistencias y liquidación de comisiones. |

---

> ℹ️ **Nota de Integración:**  
> Una vez tomadas las imágenes, deben guardarse en esta carpeta (`docs/usuario/img/`) con el nombre exacto especificado en la primera columna para que se rendericen automáticamente en el `MANUAL_DE_USUARIO.md`.
