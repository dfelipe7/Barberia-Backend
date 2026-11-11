# 03. Alcance y Contexto del Sistema (Arc42 §3)

El alcance define las fronteras entre el sistema Barbería VIP SaaS y su entorno externo.

---

## 3.1 Contexto de Negocio

El sistema interactúa con los siguientes actores y canales de negocio:

```mermaid
flowchart LR
    Cliente["Cliente Final\n(VIP o Invitado)"]
    Barbero["Barbero\n(Profesional)"]
    Admin["Administrador\nde Sede"]
    Superadmin["Superadmin\nde Plataforma"]

    subgraph SaaS ["Sistema Barbería VIP SaaS"]
        Portal["Portal Público & Motor de Citas"]
        Dashboard["Panel Administrativo & Métricas"]
        PlataformaHub["Consola Central de Plataforma"]
    end

    Cliente -->|Reserva, consulta catálogo y cancela| Portal
    Barbero -->|Consulta agenda y gestiona turnos| Dashboard
    Admin -->|Configura servicios, horarios y personal| Dashboard
    Superadmin -->|Onboarding de sedes y auditoría| PlataformaHub
```

### Mapeo de Canales de Negocio

| Actor | Canal de Entrada | Acciones Principales | Canal de Salida |
| :--- | :--- | :--- | :--- |
| **Cliente** | Navegador Web / Móvil (`/:slug/reservar`) | Selección de servicio, barbero y franja horaria. | Comprobante digital en pantalla y mensaje de confirmación por WhatsApp. |
| **Barbero** | Navegador Web (`/:slug/dashboard`) | Consulta de agenda diaria, marcar cita completada o inasistencia. | Vista reactiva de citas y cálculo de comisiones generadas. |
| **Admin** | Navegador Web (`/:slug/configuracion`) | Modificación de precios, horarios, vinculación de WhatsApp y tema. | Catálogo actualizado para clientes y socket WhatsApp conectado. |
| **Superadmin** | Navegador Web (`/plataforma`) | Creación de nuevas barberías y auditoría global. | Nueva sede operativa accesible bajo su propio subdominio/slug. |

---

## 3.2 Contexto Técnico

El diagrama describe los límites del sistema con los servicios, protocolos y almacenamiento técnico circundante:

```mermaid
flowchart TD
    subgraph Clientes y Navegadores
        NavegadorWeb["Frontend Web SPA\n(React 19 / Vite)\nPuerto 5173 / HTTPS"]
    end

    subgraph Servicios Externos
        GoogleOAuth["Google Identity Services\n(OAuth2 / OpenID Connect)\nHTTPS"]
        WhatsAppNetwork["Red de WhatsApp\n(Servidores de Meta)\nProtocolo Baileys / WSS"]
    end

    subgraph Backend Core NestJS
        API["API RESTful NestJS 11\nPuerto 3000 / HTTPS"]
        ContextInterceptor["NegocioContextInterceptor\n(Resolución de Slug)"]
        WhatsAppPool["Pool de Sesiones Baileys\n(Map por negocioId)"]
    end

    subgraph Infraestructura de Persistencia
        PrismaClient["Prisma ORM 7"]
        MySQLDB[(Base de Datos MySQL 8.0\nEsquema Multitenant Compartido)]
        StorageLocal["Sistema de Archivos (/uploads)\nDirectorios Aislados por negocioId"]
        StorageSessions["Almacenamiento de Credenciales\n(~/.barberia_whatsapp_sessions)"]
    end

    NavegadorWeb -->|HTTPS / JSON + Encabezado X-Negocio-Slug| ContextInterceptor
    ContextInterceptor --> API

    API -.->|Validación de token Google OAuth| GoogleOAuth
    API --> WhatsAppPool
    WhatsAppPool -.->|WebSockets cifrados de WhatsApp| WhatsAppNetwork

    API --> PrismaClient
    PrismaClient -->|TCP / Conexión SQL parametrizada| MySQLDB
    API -->|Escritura y lectura de multimedia| StorageLocal
    WhatsAppPool -->|Persistencia de claves y credenciales| StorageSessions
```

### Interfases Técnicas Externas

1. **Interfaz de Clientes (HTTP / JSON):**
   * Protocolo: HTTPS, formato de intercambio JSON.
   * Encabezado de Contexto: `X-Negocio-Slug` identifica la sede en cada solicitud.
   * Autenticación: Tokens JWT en encabezado `Authorization: Bearer <token>` o cookies seguras `HttpOnly`.
2. **Interfaz de Identidad Federada (Google OAuth2):**
   * Verificación criptográfica del token `sub` de Google para mitigar secuestros de cuenta.
3. **Interfaz de WhatsApp (Baileys WebSockets):**
   * Protocolo binario WebSocket cifrado de extremo a extremo que interactúa con la red de WhatsApp emulando un cliente web oficial por cada sede.
