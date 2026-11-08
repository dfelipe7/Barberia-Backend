# HE-03-HU-05 — Catálogo público de productos disponibles

- Herramienta: OpenCode
- Modelo: opencode/big-pickle
- Versión: OpenCode CLI
- Commit resultante: sin commit
- Prompt original:

```text
Contexto: Backend NestJS del proyecto Barbería (multitenant). La HU-04 ya está implementada y verificada. Ahora implementa SOLO la HU-05: catálogo público de productos disponibles.

Historia: HE-03-HU-05 — Visualizar catálogo de productos disponibles.

Como cliente o visitante de la barbería quiero consultar el catálogo de productos disponibles para conocer qué productos ofrece el negocio antes de decidir una compra.

Alcance permitido:
- Listado público de productos.
- Detalle público de un producto.
- Solo productos ACTIVO.
- Datos mínimos: nombre, descripción, precio, imagen.
- Productos INACTIVO no aparecen ni en listado ni en detalle.
- Aislamiento estricto por negocio.
- Sin autenticación si la política actual del catálogo público lo permite.
- Sin carrito, pagos, compras, favoritos, stock avanzado ni frontend.

Primero audita:
- controlador/fachada/servicio/repositorio de productos;
- DTOs y Swagger;
- reglas de autenticación y autorización del catálogo público existente, especialmente /servicios;
- middleware/servicio de contexto de negocio;
- modelo Producto en Prisma;
- pruebas unitarias y e2e existentes;
- documentación API si existe.

No asumas que "público" significa quitar auth sin revisar la política real del proyecto. Si el patrón de catálogo público ya existe (por ejemplo GET /servicios), síguelo.

Implementa con cambios mínimos:
1. Endpoint de listado público de productos activos.
2. Endpoint de detalle público por id.
3. Filtrado por negocio del contexto y estado ACTIVO en la consulta, no en memoria.
4. DTO de respuesta sin exponer metadata administrativa innecesaria.
5. 404 uniforme si el producto no existe, está inactivo o pertenece a otro negocio.
6. Respuesta vacía coherente si no hay productos disponibles.
7. Swagger actualizado.
8. Pruebas unitarias/e2e necesarias.
9. Documentación breve si el proyecto la mantiene.

No rompas HU-01, HU-02, HU-03 ni HU-04. No cambies el contrato de los endpoints administrativos existentes.

Reglas obligatorias del repositorio:
- Mantén el flujo Controller → Facade → Service → Repository → Prisma.
- No pongas reglas de negocio ni acceso directo a Prisma en el controlador.
- El negocio sale SIEMPRE del contexto del servidor (subdominio o X-Negocio-Slug validado), nunca de body/query/params manipulables.
- No aceptes negocioId enviado por el cliente.
- No confíes en filtros de estado enviados por el cliente.
- No uses datos de otro tenant ni siquiera temporalmente.
- No añadas dependencias.
- No hagas migraciones destructivas ni resetees datos.
- No toques archivos fuera del alcance de productos y su documentación/pruebas.
- Si detectas deuda técnica vecina, no la arregles; solo repórtala.
- Si el alcance real excede lo acotado, detente y explica.

Criterios de aceptación que debes cubrir con pruebas:
- Visualización de productos disponibles.
- Información del producto.
- Producto no disponible.
- Catálogo sin productos disponibles.

Casos mínimos de prueba:
- catálogo con productos ACTIVO e INACTIVO mezclados;
- el INACTIVO no aparece en el listado;
- el detalle de un INACTIVO responde 404;
- el detalle de un producto de otro negocio responde 404;
- los campos devueltos son los mínimos acordados;
- catálogo vacío responde sin error de servidor;
- se usa el negocio correcto del contexto;
- un filtro manipulado por query no cambia el resultado;
- acceso sin token si el catálogo es público;
- sin contexto de negocio responde según la política existente;
- slug inválido responde según la política existente;
- el controlador solo delega, no consulta repositorios.

Entrega:
1. Resume hallazgos y plan breve.
2. Implementa solo esta HU.
3. Ejecuta typecheck, lint sin --fix, pruebas relevantes y build.
4. Presenta el diff y los archivos de esta HU.
5. Indica riesgos, suposiciones y deuda vecina.
6. Espera aprobación humana antes de ejecutar el commit. No hagas commit ni push por tu cuenta.
```

## Plan ejecutado

1. DTOs `ProductoCatalogoResponseDto` y `ProductosCatalogoResponseDto` con solo `id`, `nombre`, `descripcion`, `precio`, `imagenUrl` y mensaje opcional de catálogo vacío.
2. Constante `MENSAJE_SIN_PRODUCTOS_DISPONIBLES`.
3. Repositorio: `listarCatalogo()` filtra `estado = ACTIVO` dentro de `filtroLectura` y ordena por `nombre asc, id asc`; `obtenerDisponiblePorId()` filtra `id`, `estado = ACTIVO` y negocio.
4. Servicio: mapeo público sin `estado` ni fechas; colección vacía con mensaje; 404 uniforme para producto inactivo, inexistente o ajeno.
5. Fachada: exige contexto de negocio y delega el catálogo y el detalle.
6. Controlador: rutas públicas `GET /productos/catalogo` y `GET /productos/catalogo/:productoId` declaradas antes de `GET /productos/:productoId`, sin guards, con Swagger.
7. Pruebas unitarias de repositorio, servicio, fachada y controlador; pruebas e2e con dos tenants y MySQL real.
8. Documentación de las rutas en `docs/api/REFERENCIA_API.md`.

## Matriz de criterios de aceptación

- Visualización de productos disponibles: e2e verifica catálogo público con solo productos ACTIVO, datos mínimos, orden y negocio del contexto.
- Información del producto: e2e verifica nombre, descripción, precio e imagen en el detalle público.
- Producto no disponible: e2e verifica 404 uniforme para producto INACTIVO, inexistente o de otro negocio.
- Catálogo sin productos disponibles: e2e verifica `200` con `productos: []` y mensaje.
- Extras: acceso sin token, rechazo de filtros manipulados por query, contexto de negocio ausente (403), slug inválido (404), identificadores no positivos (400) y delegación del controlador.

## Suposiciones y riesgos

- El catálogo es público, igual que `GET /servicios`; no se añadió autenticación nueva.
- No se modificaron `prisma/schema.prisma` ni migraciones. Se sugiere para otra tarea un índice compuesto `(negocioId, estado, nombre)`; no se aplicó.
- No se añadió paginación porque el alcance no la pide y el catálogo actual de productos no la usa.
- El repositorio recupera la fila completa y el servicio la mapea a campos públicos; no se expone metadata administrativa.
- No se implementaron compras, pagos, carrito, favoritos ni frontend.

## Verificaciones

- `npm run typecheck`: 0 errores.
- `npx eslint src/modules/productos test/multitenant-productos.e2e-spec.ts`: 0 errores.
- `npm test -- productos --runInBand`: 81/81 passing.
- `npm run test:multitenant -- multitenant-productos --runInBand`: 44/44 passing.
- `npm run build`: OK.
- `git diff --check`: sin errores de whitespace.
