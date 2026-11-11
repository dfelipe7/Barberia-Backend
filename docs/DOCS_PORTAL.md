# 💈 Barbería VIP SaaS — Developer Architecture Hub

Bienvenido al portal oficial de **arquitectura técnica y contratos de código fuente** de **Barbería VIP SaaS Backend**, generado bajo las normas de ingeniería **Arc42** (vistas de arquitectura) e **IEEE 1063** (contratos y especificaciones de software).

---

## 🗺️ Mapa de Dominios de Negocio (Business Domains)

Selecciona un dominio para consultar sus controladores, servicios de negocio, repositorios y contratos de datos:

| Dominio | Capa / Responsabilidad | Clases & Servicios Clave |
| :--- | :--- | :--- |
| **🏢 Negocios & Multitenant** | Aislamiento estricto de base de datos por sede mediante `AsyncLocalStorage` y extensiones de Prisma. | `NegocioContextoService`, `NegocioAislamientoService`, `NegociosRepository`, `NegociosPlataformaController` |
| **🔐 Autenticación & Seguridad** | Verificación criptográfica Google OAuth 2.0, emisión de tokens JWT diferenciados (Personal vs Cliente) y Guardias Zero-Trust. | `GoogleAuthService`, `PersonalJwtService`, `ClienteJwtService`, `JwtAuthGuard`, `RolesGuard` |
| **💈 Barberos & Personal** | Gestión del staff de cada barbería, control de estados operativos (`ACTIVO`/`INACTIVO`), comisiones y avatares. | `BarberosController`, `BarberosService`, `BarberosRepository`, `UsuariosAuthorizationService` |
| **✂️ Servicios & Catálogo** | Catálogo público y administrativo de cortes y tratamientos, asignación de profesionales y duración. | `ServiciosController`, `ServiciosService`, `ServiciosRepository` |
| **🗓️ Reservas & Citas** | Motor de agendamiento para clientes autenticados e invitados con tokens criptográficos de autoservicio y control de auditoría. | `ReservasController`, `ReservasAdminController`, `ReservasService`, `ReservasRepository` |
| **📅 Horarios & Disponibilidad** | Cálculo de franjas horarias libres, matriz de turnos semanales y excepciones por bloqueos. | `DisponibilidadController`, `HorarioSemanalController`, `BloqueosHorarioController` |
| **💬 WhatsApp & Notificaciones** | Integración con Baileys para envío de confirmaciones y recordatorios automáticos de citas con QR en tiempo real. | `WhatsAppController`, `WhatsAppService`, `WhatsAppSessionManager`, `WhatsAppTemplateEngine` |
| **⚙️ Configuración & Alertas** | Gestión de parámetros de negocio (antelación de cancelaciones, moneda) y auditoría de seguridad OWASP A09. | `ConfiguracionService`, `AlertsService`, `MulterConfig` |
| **🗄️ Base de Datos & Prisma** | Conexión a MariaDB, transacciones ACID y aislamiento multi-inquilino a nivel de consulta. ([Ver Diccionario de Datos](DICCIONARIO_DE_DATOS.md)). | `PrismaService`, `PrismaExtensionAislamiento` |

---

## 🏛️ Flujo Arquitectónico en Profundidad (Capa por Capa)

Cada petición que ingresa al backend sigue una cadena de defensa en profundidad diseñada para garantizar cero fugas de información entre barberías:

```text
[ Petición HTTP Entrante ]
       │
       ▼
1. NegocioContextoMiddleware   ──► Resuelve el slug (X-Negocio-Slug), valida existencia y activa AsyncLocalStorage
       │
       ▼
2. JwtAuthGuard & RolesGuard   ──► Valida token Bearer JWT y comprueba que negocioId coincida con la sede activa
       │
       ▼
3. Controller (Frontera REST)  ──► Valida DTOs de entrada con ValidationPipe (Class-Validator)
       │
       ▼
4. Service (Lógica de Negocio) ──► Aplica reglas de dominio, validaciones de negocio y transacciones ACID
       │
       ▼
5. Repository & Prisma Ext.    ──► Inyecta automáticamente { where: { negocioId } } en cada query SQL
       │
       ▼
[ Base de Datos MariaDB ]
```

---

## 🛡️ Principios de Seguridad & Calidad de Código

1. **Aislamiento Multitenant Zero-Trust (OWASP A01):**  
   Ningún usuario, barbero o administrador puede acceder o modificar datos de otra barbería. El contexto se propaga de forma asíncrona e inmutable.
2. **Defensa Anti-Account Takeover:**  
   El login con Google asocia de forma permanente el identificador federado `sub` de Google a la cuenta de usuario, impidiendo suplantaciones por colisión de correo.
3. **Contratos Explícitos y Fuertemente Tipados (IEEE 1063):**  
   Cada método público declara `@param`, `@returns` y `@throws`, garantizando tipado estricto sin uso de `any`.
4. **Documentación OpenAPI en Vivo:**  
   Para probar interactivamente los endpoints REST y ver las especificaciones Swagger, ejecuta el servidor e ingresa a `/api/docs`.

---

*💡 **Consejo de Navegación:** Utiliza el buscador (`Ctrl + K` o la lupa superior) para saltar instantáneamente a cualquier servicio o clase por su nombre.*
