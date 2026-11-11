# Skills de agente para Barberia-Backend (NestJS + Prisma)

Este paquete instala skills locales para un agente compatible con el formato Agent Skills, especialmente OpenCode. Están adaptadas al backend existente: NestJS 11, TypeScript, Prisma 7, MariaDB/MySQL, Google OAuth/JWT, guards/roles, Swagger, Winston, Multer y módulos de usuarios/servicios.

## Instalación

1. Haz una copia de seguridad o confirma que Git no tiene cambios que quieras proteger.
2. Descomprime este ZIP en la raíz de `Barberia-Backend`.
3. Verifica que los archivos hayan quedado en rutas como:

```text
Barberia-Backend/
├── .opencode/
│   └── skills/
│       ├── backend-audit/SKILL.md
│       ├── owasp-appsec-review/SKILL.md
│       └── ...
└── src/
```

4. Reinicia OpenCode o abre una sesión nueva y comprueba las skills que detecta.
5. Úsalas bajo demanda: no necesitas pedir que aplique todas las skills en todas las tareas.

## Prioridad recomendada

### Instalar desde el comienzo

| Skill | Cuándo usarla | Prioridad |
|---|---|---|
| `backend-audit` | Antes de planear una funcionalidad o refactorización | P0 |
| `owasp-appsec-review` | Antes de integrar cambios sensibles o hacer una revisión de seguridad | P0 |
| `api-authorization-rbac` | En todo endpoint privado o con IDs de recursos | P0 |
| `oauth-jwt-hardening` | Al cambiar login, guards, claims, roles o validación de tokens | P0 |
| `config-secrets-hardening` | Al cambiar `main.ts`, configuración, CORS, Swagger, SMTP o despliegue | P0 |
| `nestjs-prisma-secure-coding` | En la mayoría de tareas backend con DTO/servicio/repositorio/Prisma | P0 |
| `test-first-fix` | En cada bug o funcionalidad | P0 |

### Activar cuando corresponda

| Skill | Cuándo usarla | Prioridad |
|---|---|---|
| `database-review` | Schema, migraciones, integridad, transacciones e índices | P1 |
| `scheduling-business-rules` | Funcionalidades HE-08 y cualquier integración con reservas HE-04 | P1 |
| `secure-file-upload` | Fotos de barberos/usuarios o archivos subidos | P1 |
| `secure-logging-alerting` | Winston, `AllExceptionsFilter`, auditoría y correos de alerta | P1 |
| `supply-chain-dependencies` | Instalación/actualización de dependencias npm | P1 |
| `api-contract-swagger` | Crear/modificar endpoints, DTOs o documentación de API | P1 |
| `performance-query-review` | Listados grandes o problemas medidos de latencia | P2 |
| `architecture-patterns` | Diseño o refactorización de módulos y reglas complejas | P2 |

## Particularidades que el agente debe recordar

- Las convenciones de rutas deben derivarse de los controladores reales. El backend ya cuenta con módulos como `usuarios` y `servicios`; no cambies automáticamente las rutas a inglés por seguir una propuesta de diseño.
- Confirma los tipos de IDs y relaciones en `prisma/schema.prisma`. No asumas UUID/Int sin revisar el schema real.
- La identidad para operaciones propias debe proceder del principal autenticado, no del body.
- `AvailabilityService` debe ser la fuente de verdad para la disponibilidad cuando se implemente HE-08/HE-04; no dupliques la lógica.
- La jornada `09:00–20:00`, la zona `America/Bogota`, los slots de 60 minutos y los estados de reserva indicados en `scheduling-business-rules` proceden de la especificación de HE-08 suministrada; valida decisiones y conflictos con el contrato HE-04 y con el schema implementado.
- No edites los archivos generados de `generated/prisma` manualmente.
- En `package.json`, `npm run lint` incluye `--fix` y puede modificar archivos; revisa Git antes de ejecutarlo. `npm run format` también modifica archivos.
- La revisión inicial debe ser de solo lectura. No ejecutar migraciones destructivas, despliegues, pruebas agresivas ni cambios de credenciales sin autorización.

## Observaciones de seguridad que conviene verificar en el código actual

Estas son comprobaciones que debe hacer la skill `config-secrets-hardening`; no significan que ya se haya confirmado una vulnerabilidad:

1. Confirmar si Swagger (`/api/docs`) está realmente deshabilitado o protegido en producción, dado que el comentario por sí solo no implementa esa condición.
2. Revisar la existencia de valores por defecto para SMTP y exigir configuración real en entornos que lo necesiten.
3. Revisar validaciones, nombres y límites de los archivos que se sirven desde `/uploads`.
4. Revisar si el rate limiting global está ajustado por tipo de endpoint y si el backend confía correctamente en un proxy.
5. Comprobar que el filtro global y las alertas no exponen secretos o generan ruido por errores esperados.

## Formato y límites

Cada skill está en `.opencode/skills/<nombre>/SKILL.md` con frontmatter `name` y `description` compatible con OpenCode. Las skills son instrucciones para el agente, no herramientas de escaneo por sí solas: el agente debe usar herramientas realmente instaladas, citar evidencias y declarar qué no pudo comprobar.

## Referencias oficiales

- OWASP Top 10:2025: https://top10.owasp.org/2025/
- OWASP API Security Top 10 (2023): https://api-security.owasp.org/editions/2023/en/0x11-t10/
- OWASP ASVS 5.0.0: https://github.com/OWASP/ASVS/releases
- OpenCode Agent Skills: https://docs.opencode.ai/docs/skills/
- NestJS Security: https://docs.nestjs.com/security
- NestJS File Upload: https://docs.nestjs.com/techniques/file-upload
- NestJS Configuration: https://docs.nestjs.com/techniques/configuration
- Prisma ORM 7 best practices: https://www.prisma.io/docs/orm/v7/more/best-practices
- Prisma ORM 7 transactions: https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions
