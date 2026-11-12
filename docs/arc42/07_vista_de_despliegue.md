# 07. Vista de Despliegue (Arc42 §7)

La vista de despliegue describe la infraestructura técnica donde se ejecutan los artefactos de software y el mapeo de los componentes a nodos físicos o en la nube.

---

## 7.1 Nivel de Infraestructura 1: Entorno de Producción Cloud (Railway)

```mermaid
flowchart TD
    Internet((Usuarios en Internet))

    subgraph CloudRailway ["Infraestructura Cloud (Railway Platform)"]
        EdgeRouter["Edge Router & SSL Termination\n(Reverse Proxy HTTPS / HTTP2)"]
        
        subgraph FrontendService ["Servicio Frontend SPA"]
            NginxServer["Contenedor Web\n(Archivos estáticos compilados en dist/)\nPuerto 80 / 443"]
        end

        subgraph BackendService ["Servicio Backend API"]
            NestApp["Contenedor Docker Node.js 20\n(NestJS 11 Runtime)\nPuerto 3000"]
            VolumeUploads[("Volumen Persistente Railway\n/uploads")]
            VolumeSessions[("Volumen Persistente Railway\n~/.barberia_whatsapp_sessions")]
        end

        subgraph DatabaseService ["Servicio de Base de Datos"]
            MySQLProd[("MySQL 8.0 Cloud Database\nPuerto 3306\nInnoDB / READ COMMITTED")]
        end
    end

    subgraph ServiciosExternos ["Servicios de Terceros"]
        GoogleOIDC["Google Identity Platform"]
        WAMetaNet["Red de Servidores WhatsApp"]
    end

    Internet -->|HTTPS / WSS| EdgeRouter
    EdgeRouter -->|Ruta: /*| NginxServer
    EdgeRouter -->|Ruta: /api/* y /uploads/*| NestApp

    NestApp --> VolumeUploads
    NestApp --> VolumeSessions
    NestApp -->|Conexión TCP cifrada Prisma| MySQLProd
    NestApp -.->|HTTPS| GoogleOIDC
    NestApp -.->|WSS Baileys| WAMetaNet
```

### Mapeo de Componentes a Infraestructura

| Componente de Software | Unidad de Despliegue | Nodo de Ejecución | Almacenamiento Asociado |
| :--- | :--- | :--- | :--- |
| **Frontend Web** | Paquete compilado estático (HTML, JS, CSS) | Nginx Server en Railway | Caché en borde (Edge Cache) |
| **Backend API** | Imagen Docker generada desde `Dockerfile` | Contenedor Node.js 20 | Memoria RAM (Pool Baileys) |
| **Almacenamiento Multimedia** | Directorio físico `/uploads` | Montaje de volumen persistente | Sistema de archivos particionado |
| **Credenciales WhatsApp** | Directorio `~/.barberia_whatsapp_sessions` | Montaje de volumen persistente | Archivos de autenticación Baileys |
| **Capa de Datos** | Esquema relacional administrado | Contenedor MySQL 8.0 | Disco SSD NVMe transaccional |

---

## 7.2 Nivel de Infraestructura 2: Entorno de Desarrollo Local (Docker Compose)

Para reproducir fielmente el entorno productivo en el equipo de desarrollo sin dependencias externas:

```mermaid
flowchart LR
    DevUser["Desarrollador / QA"]

    subgraph HostLocal ["Máquina Local (Windows / Linux / macOS)"]
        subgraph DevFrontend ["Proceso Frontend"]
            ViteDev["Vite Dev Server (HMR)\nhttp://localhost:5173"]
        end

        subgraph DevBackend ["Proceso Backend"]
            NestDev["NestJS CLI (Watch Mode)\nhttp://localhost:3000"]
            DiskUploads[("Directorio Local\n./uploads")]
            DiskSessions[("Directorio Local de Sesiones\n~/.barberia_whatsapp_sessions")]
        end

        subgraph DockerDesktop ["Docker Desktop"]
            MySQLDev[("Contenedor mysql-multitenant-dev\nMySQL 8.0\nPuerto expuesto 3307\nVolumen docker: mysql-multitenant-data")]
        end
    end

    DevUser --> ViteDev
    DevUser --> NestDev
    ViteDev -->|Proxy HTTP / CORS| NestDev
    NestDev --> DiskUploads
    NestDev --> DiskSessions
    NestDev -->|TCP localhost:3307| MySQLDev
```

### Comandos de Operación Local

1. **Levantar base de datos aislada:**
   ```bash
   docker compose -f docker-compose.multitenant-dev.yml up -d mysql-multitenant-dev
   ```
2. **Aplicar migraciones:**
   ```bash
   npx prisma migrate deploy
   ```
3. **Poblar datos de prueba (Seed):**
   ```bash
   npm run seed:local:multitenant
   ```
4. **Iniciar backend en modo observador:**
   ```bash
   npm run start:dev
   ```
