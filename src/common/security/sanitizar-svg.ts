import { BadRequestException } from '@nestjs/common';

/**
 * Saneado de SVG antes de almacenarlo y servirlo.
 *
 * POR QUÉ HAY QUE SANEAR UN SVG
 * -----------------------------
 * Un SVG es un documento XML que puede contener SCRIPT. Servido desde el
 * MISMO ORIGEN que la API, un SVG con `<script>` se ejecuta en el navegador
 * de quien lo visita: es un XSS almacenado. Como el favicon y los logos se
 * sirven desde el dominio de la aplicación, el SVG se sanea ANTES de
 * guardarlo.
 *
 * QUÉ SE ELIMINA
 * ---------------
 * - Elementos ejecutables o que embeben contenido externo: `script`, `style`,
 *   `foreignObject`, `iframe`, `embed`, `object`, `a`, `animate`, `set`,
 *   `handler`, `listener`, `audio`, `video`, `image`.
 * - Atributos de evento (`onclick`, `onload`, ...).
 * - Referencias que no son locales (`href`/`xlink:href` a `#id`): se
 *   eliminan las externas (pueden cargar contenido de terceros o ejecutar
 *   `javascript:`).
 * - Declaraciones `DOCTYPE`/`ENTITY`: permitenExpansion de entidades y
 *   ataques XXE.
 * - Estilos con `url()`, `expression()` o `javascript:`.
 *
 * Se trabaja con una LISTA BLANCA de elementos y atributos: lo que no está
 * explícitamente permitido se elimina.
 */

/** Elementos que se conservan. */
const ELEMENTOS_PERMITIDOS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'metadata',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'fegaussianblur',
  'feoffset',
  'feblend',
  'fecolormatrix',
  'femerge',
  'femergenode',
  'feflood',
  'fecomposite',
]);

/**
 * Elementos cuyo CONTENIDO se elimina por completo (no basta con quitar la
 * etiqueta: su contenido también es peligroso).
 */
const ELEMENTOS_BLOQUE_COMPLETO = [
  'script',
  'style',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'a',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'handler',
  'listener',
  'audio',
  'video',
  'image',
];

/** Atributos que se conservan (sin prefijo de espacio de nombres). */
const ATRIBUTOS_PERMITIDOS = new Set([
  'id',
  'class',
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'viewbox',
  'preserveaspectratio',
  'transform',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'opacity',
  'color',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'word-spacing',
  'xmlns',
  'xmlns:xlink',
  'version',
  'baseprofile',
  'style',
]);

/** Patrones peligrosos dentro de un valor de estilo. */
const PATRONES_ESTILO_PELIGROSO =
  /url\s*\(|expression\s*\(|javascript\s*:|@import|behavior\s*:|binding\s*:/i;

/**
 * Expresiones que delatan un intento de inyección en el SVG.
 *
 * Se comprueban sobre el documento YA SANEADO: son la segunda barrera, por
 * si el saneado dejara pasar algo.
 */
const EXPRESION_PELIGROSA =
  /<\s*script|javascript\s*:|\son[a-z]+\s*=|data\s*:\s*text\/html/i;

/**
 * Construcciones que hacen que el archivo se RECHACE (no se "limpia").
 *
 * Un SVG con estas construcciones no es un logo: es un intento de ejecutar
 * código en el navegador de quien lo visita. Aceptarlo "saneado" ocultaría
 * el ataque, así que el archivo se rechaza con un error claro y NO se
 * almacena.
 */
const CONSTRUCCIONES_PELIGROSAS: readonly RegExp[] = [
  /<\s*(?:script|foreignobject|iframe|embed|object|animate|set\b)/i,
  /javascript\s*:/i,
  /\son[a-z]+\s*=/i,
  /data\s*:\s*text\/html/i,
  /<!(?:DOCTYPE|ENTITY)/i,
];

/**
 * Sanea un SVG y devuelve su contenido seguro.
 *
 * @throws BadRequestException si el documento no es un SVG válido o contiene
 * construcciones prohibidas (DOCTYPE/ENTITY).
 */
export function sanitizarSvg(contenido: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(contenido)) {
    throw new BadRequestException(
      'El SVG no es válido: no se admiten declaraciones DOCTYPE ni ENTITY.',
    );
  }

  // Un SVG con script, manejadores de evento o marcos NO es un logo: se
  // RECHAZA. No se "limpia" en silencio: se avisa al operador.
  if (CONSTRUCCIONES_PELIGROSAS.some((r) => r.test(contenido))) {
    throw new BadRequestException(
      'El SVG contiene construcciones no permitidas (script, manejadores de ' +
        'evento, marcos o referencias ejecutables). No se almacena.',
    );
  }

  let resultado = contenido;

  // Comentarios, declaración XML e instrucciones de proceso: pueden apuntar a
  // recursos externos (`<?xml-stylesheet?>`) y no aportan nada al dibujo.
  resultado = resultado.replace(/<!--[\s\S]*?-->/g, '');
  resultado = resultado.replace(/<\?[\s\S]*?\?>/g, '');

  // Elementos peligrosos: se elimina la etiqueta Y su contenido.
  for (const elemento of ELEMENTOS_BLOQUE_COMPLETO) {
    const conCierre = new RegExp(
      String.raw`<${elemento}\b[\s\S]*?<\/${elemento}\s*>`,
      'gi',
    );
    const sinCierre = new RegExp(String.raw`<${elemento}\b[^>]*\/?>`, 'gi');

    resultado = resultado.replace(conCierre, '').replace(sinCierre, '');
  }

  // Etiquetas permitidas: se conservan con sus atributos saneados.
  //
  // SVG es XML: los nombres de elemento y de atributo distinguen mayúsculas
  // (`viewBox` NO es `viewbox`). Se comprueba contra la lista en minúsculas,
  // pero se REESCRIBE el nombre original.
  resultado = procesarEtiquetasSvg(resultado);

  const svg = resultado.trim();

  if (!/^<svg[\s/>]/i.test(svg)) {
    throw new BadRequestException(
      'El archivo no es un SVG válido: falta el elemento raíz <svg>.',
    );
  }

  if (EXPRESION_PELIGROSA.test(svg)) {
    throw new BadRequestException(
      'El SVG contiene construcciones no permitidas (script, javascript: o manejadores de evento).',
    );
  }

  return svg;
}

/**
 * Procesa las etiquetas XML del documento de forma lineal sin backtracking ReDoS.
 */
function procesarEtiquetasSvg(contenido: string): string {
  let salida = '';
  let i = 0;
  while (i < contenido.length) {
    const inicio = contenido.indexOf('<', i);
    if (inicio === -1) {
      salida += contenido.slice(i);
      break;
    }
    salida += contenido.slice(i, inicio);
    const fin = contenido.indexOf('>', inicio);
    if (fin === -1) {
      salida += contenido.slice(inicio);
      break;
    }

    const cuerpo = contenido.slice(inicio + 1, fin);
    i = fin + 1;

    let pos = 0;
    while (pos < cuerpo.length && /\s/.test(cuerpo[pos])) pos++;
    const esCierre = cuerpo[pos] === '/';
    if (esCierre) pos++;
    while (pos < cuerpo.length && /\s/.test(cuerpo[pos])) pos++;

    const inicioNombre = pos;
    while (pos < cuerpo.length && !/[\s/>]/.test(cuerpo[pos])) pos++;
    const nombreOriginal = cuerpo.slice(inicioNombre, pos);
    const elemento = nombreOriginal.toLowerCase();

    if (!nombreOriginal || !ELEMENTOS_PERMITIDOS.has(elemento)) {
      continue;
    }

    const resto = cuerpo.slice(pos);
    const saneados = sanearAtributos(resto);
    const esAutoCierre = !esCierre && resto.trimEnd().endsWith('/');

    salida += `<${esCierre ? '/' : ''}${nombreOriginal}${saneados}${esAutoCierre ? ' />' : '>'}`;
  }
  return salida;
}

/**
 * Filtra los atributos de una etiqueta y reconstruye el fragmento con análisis lineal.
 */
function sanearAtributos(atributos: string): string {
  const permitidos: string[] = [];
  const trimmed = atributos.trim();
  if (!trimmed) return '';

  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length || trimmed[i] === '/') break;

    const inicioNombre = i;
    while (i < trimmed.length && !/[\s=>/]/.test(trimmed[i])) i++;
    const nombreOriginal = trimmed.slice(inicioNombre, i);
    if (!nombreOriginal) {
      i++;
      continue;
    }

    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length || trimmed[i] !== '=') {
      continue;
    }
    i++;
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;

    let valor = '';
    if (i < trimmed.length && (trimmed[i] === '"' || trimmed[i] === "'")) {
      const quote = trimmed[i];
      i++;
      const inicioValor = i;
      while (i < trimmed.length && trimmed[i] !== quote) i++;
      valor = trimmed.slice(inicioValor, i);
      if (i < trimmed.length) i++;
    } else {
      const inicioValor = i;
      while (i < trimmed.length && !/[\s>]/.test(trimmed[i])) i++;
      valor = trimmed.slice(inicioValor, i);
    }

    const nombre = nombreOriginal.toLowerCase();
    if (esAtributoSeguro(nombre, valor)) {
      permitidos.push(`${nombreOriginal}="${escaparValor(valor)}"`);
    }
  }

  return permitidos.length > 0 ? ` ${permitidos.join(' ')}` : '';
}

/** Decide si un atributo puede conservarse y con qué valor. */
function esAtributoSeguro(nombre: string, valor: string): boolean {
  // Manejadores de evento (`onclick`, `onload`, ...).
  if (nombre.startsWith('on')) {
    return false;
  }

  // Referencias: solo se admiten las LOCALES (`#id`).
  if (nombre === 'href' || nombre === 'xlink:href') {
    return valor.trim().startsWith('#');
  }

  // Estilos en línea: se rechazan los que pueden cargar o ejecutar.
  if (nombre === 'style') {
    return !PATRONES_ESTILO_PELIGROSO.test(valor);
  }

  // Cualquier otro espacio de nombres que no sea `xmlns:xlink` se elimina.
  if (nombre.includes(':') && nombre !== 'xmlns:xlink') {
    return false;
  }

  // Atributos de datos propios: se permiten (no ejecutan nada).
  if (nombre.startsWith('data-')) {
    return true;
  }

  return ATRIBUTOS_PERMITIDOS.has(nombre);
}

/** Escapa el valor de un atributo para que no rompa el documento. */
function escaparValor(valor: string): string {
  return valor
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
}
