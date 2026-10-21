<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Documentación técnica

- [Contratos de API para operación por negocio (multitenant)](CONTRATOS_API_MULTITENANT.md):
  cómo se selecciona la barbería, qué identificador usa cada endpoint
  (`Barbero.id` vs `Usuario.id`), encabezados requeridos, CORS y
  disponibilidad de la documentación OpenAPI.
- `Contexto_tecnico_backend_barberia_HE08.md` y
  `Contexto_tecnico_HE04_Reservas_integracion_HE08.md`: contexto funcional de
  HE-04/HE-08.
- `HE-04_integracion_disponibilidad.md`: integración de la disponibilidad.

## Operación multitenant (resumen operativo)

Este backend opera **por barbería**: cada petición se resuelve contra UN
negocio y todas las operaciones quedan acotadas a ese negocio.

### Contexto de negocio

- Mecanismo principal: subdominio (`<slug>.<NEGOCIO_DOMINIO_BASE>`).
- Alternativa: cabecera `X-Negocio-Slug`.
- Sin contexto, las rutas de negocio **fallan** (`403`): nunca se ejecutan
  sobre el conjunto completo de negocios.
- **Ningún endpoint acepta un `negocioId`** del cuerpo, la query o la URL.

### Roles: el SUPERADMIN es una MEMBRESÍA, no un rol global

| Rol | Origen | Alcance |
|---|---|---|
| `ADMINISTRADOR` | membresía `Administrador` (`negocioId`, `estado = ACTIVO`) | su negocio |
| `SUPERADMIN` | membresía `Administrador` con `superadmin = true` | **su** negocio |
| `BARBERO` | membresía `Barbero` (`negocioId`, `estado = ACTIVO`) | su negocio |

- **No existe un SUPERADMIN global de plataforma.** El campo global
  `Usuario.rol` (valores heredados `SUPERADMIN` | `PERSONAL`) es
  **informativo**: no concede ningún privilegio. La autorización se deriva de
  la **membresía activa** y del **contexto** del negocio.
- Cambiar de negocio (`POST /auth/tenant/:slug`) exige una **membresía
  activa en el negocio de destino**, también para el SUPERADMIN de otra
  barbería (`403` si no la tiene). No hay transición privilegiada.
- Las membresías se asignan con el comando explícito
  `npm run multitenant:fundadores`.

### Esquema de base de datos

Las migraciones se aplican **de forma explícita**; la aplicación **nunca**
modifica el esquema al arrancar (no hay `db push` en el arranque):

```bash
npm run db:migrate          # aplica las migraciones sobre DATABASE_URL
npm run db:migrate:status   # estado del historial
npm run db:validate         # valida prisma/schema.prisma
```

### Entorno local aislado (MySQL 8.0)

```bash
copy .env.multitenant-dev.example .env.multitenant-dev   # Windows
docker compose -f docker-compose.multitenant-dev.yml up -d mysql-multitenant-dev
npm run db:migrate:dev        # aplica las migraciones en la base aislada
npm run seed:local:multitenant # datos de prueba (exige autorización)
```

La base de desarrollo es `bd_barberia_multitenant_dev` (puerto 3308) y tiene
su propio volumen: **no** comparte datos con `bd_barberia`.

### Archivos subidos (recursos de marca)

- `UPLOADS_DIR` fija el directorio de los archivos (por defecto
  `<cwd>/uploads`). Los recursos de cada negocio viven en
  `<UPLOADS_DIR>/negocios/{negocioId}/perfil/`.
- En Docker local es un volumen persistente
  (`barberia_multitenant_dev_uploads`).
- En **Railway** hay que montar un volumen persistente en la ruta configurada
  por `UPLOADS_DIR` (o migrar a un adaptador de objetos): el sistema de
  ficheros del contenedor es efímero. Detalles y procedimiento de respaldo en
  el [documento de contratos](CONTRATOS_API_MULTITENANT.md) (§8.8).

### Dirección y nombre comercial

- El nombre comercial sale de `Negocio.nombre` del contexto.
- La dirección comercial sale de `PerfilNegocio.direccion`.
- La clave heredada `negocio_direccion` queda como **respaldo temporal**; se
  traslada con `npm run multitenant:migrar-direccion` (no sobrescribe nada y
  no borra el valor heredado).

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
