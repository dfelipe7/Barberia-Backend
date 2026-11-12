# 06. Vista de Tiempo de Ejecución (Arc42 §6)

La vista de ejecución describe el comportamiento dinámico y las interacciones temporales entre componentes durante escenarios clave.

---

## 6.1 Escenario 1: Creación Atómica de Cita y Notificación Asíncrona por WhatsApp

Describe el ciclo de vida completo desde que un cliente solicita un turno hasta que se confirma y notifica:

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente (Web/Móvil)
    participant Front as Frontend (Axios)
    participant Interceptor as NegocioContextInterceptor
    participant RC as ReservasController
    participant RS as ReservasService
    participant RR as ReservasRepository
    participant DB as MySQL 8.0 (Prisma)
    participant WS as WhatsAppService (Baileys)

    C->>Front: Selecciona servicio, barbero, fecha y hora
    Front->>Interceptor: POST /reservas (Header: X-Negocio-Slug: sede-centro)
    Interceptor->>Interceptor: Resuelve slug y asigna request.negocioId = 4
    Interceptor->>RC: Petición contextualizada + DTO validado
    RC->>RS: crearReserva(dto, negocioId=4)
    RS->>RR: crearConBloqueo(...)
    
    rect rgb(240, 248, 255)
        Note over RR,DB: Transacción Atómica de Disponibilidad
        RR->>DB: SELECT horario, bloqueos y citas existentes (FOR UPDATE)
        alt Franja ocupada o no disponible
            DB-->>RR: Conflicto detectado
            RR-->>RS: Error 409 Conflict
            RS-->>Front: Error de concurrencia al usuario
        else Franja libre
            RR->>DB: INSERT INTO reservas (negocioId=4, ...)
            DB-->>RR: Reserva confirmada con ID y tokenGestion
        end
    end

    RR-->>RS: Objeto Reserva creado
    RS-->>RC: Respuesta con Voucher y Enlace de Gestión
    RC-->>Front: HTTP 201 Created (Datos de reserva)
    Front-->>C: Renderiza Voucher digital en pantalla

    Note over RS,WS: Despacho Asíncrono Desacoplado (Segundo Plano)
    RS-)WS: dispararConfirmacionWhatsApp(reserva, negocioId=4)
    WS->>WS: Consulta sesión en memoria para negocioId=4
    alt Sesión online
        WS-)C: Envío de mensaje por WhatsApp al número del cliente
    else Sesión temporalmente offline
        WS->>WS: Encola en colasPendientes[4] para reintento automático
    end
```

---

## 6.2 Escenario 2: Autenticación con Google OAuth2 y Protección Anti-Takeover

Garantiza que una cuenta registrada localmente con un correo no sea suplantada por un inicio de sesión de Google con un `sub` distinto:

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuario
    participant Front as Frontend
    participant AC as AuthController
    participant AS as AuthService
    participant G as Google Identity API
    participant DB as MySQL (Prisma)

    U->>Front: Clic en "Continuar con Google"
    Front->>G: Solicita credencial ID Token
    G-->>Front: Retorna Google JWT (contiene sub, email, name)
    Front->>AC: POST /auth/google { token }
    AC->>AS: validarTokenGoogle(token)
    AS->>G: Verifica firma criptográfica del token
    G-->>AS: Token verificado (email: "carlos@gmail.com", sub: "google-uid-123")
    
    AS->>DB: SELECT * FROM usuarios WHERE email = 'carlos@gmail.com'
    alt Usuario ya existía con otro googleId
        DB-->>AS: Usuario encontrado (googleId != 'google-uid-123')
        AS-->>AC: Error 401 Unauthorized (Anti-Account Takeover)
        AC-->>Front: Bloqueo de inicio de sesión por discrepancia de identidad
    else Usuario nuevo o con googleId coincidente
        AS->>DB: UPSERT usuario con googleId verificado
        AS->>AS: Genera JWT de sesión del SaaS
        AS-->>AC: Retorna JWT y perfil del usuario
        AC-->>Front: HTTP 200 OK con sesión activa
    end
```

---

## 6.3 Escenario 3: Subida y Sanitización de Recursos de Marca

Muestra cómo se garantiza el aislamiento en disco y la seguridad ante archivos maliciosos:

```mermaid
sequenceDiagram
    autonumber
    actor A as Administrador
    participant Front as Frontend
    participant PC as PerfilNegocioController
    participant Multer as Multer Storage Engine
    participant Security as Seguridad Utils
    participant FS as Sistema de Archivos (/uploads)

    A->>Front: Selecciona imagen de logotipo (PNG / SVG)
    Front->>PC: POST /perfil-negocio/logo (Multipart/form-data, X-Negocio-Slug)
    PC->>Multer: Procesa stream del archivo
    Multer->>Multer: Resuelve ruta física: /uploads/negocios/{negocioId}/logos/
    Multer->>Security: Inspecciona primeros bytes del archivo (Magic Bytes)
    
    alt Extensión no coincide con el contenido real
        Security-->>PC: Rechaza archivo por discrepancia MIME
        PC-->>Front: HTTP 400 Bad Request
    else Archivo es SVG
        Security->>Security: Ejecuta sanitize-html eliminando <script> y onload
        Security->>FS: Escribe SVG sanitizado en disco
    else Archivo binario legítimo (PNG/JPG)
        Security->>FS: Escribe archivo en disco
    end

    PC-->>Front: HTTP 200 OK con URL pública del recurso
```
