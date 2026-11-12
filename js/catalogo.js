// Catálogo de Sabores_Gestion (catalogo_app.v1) guardado en el teléfono, con sus índices para buscar sin señal,
// y las equivalencias proveedor -> artículo (las del catálogo y las aprendidas en el celular).
import * as db from './db.js';
import { normalizarDescripcion, parecido, VERSION_NORMALIZADOR } from './normalizar.js';
import { soloDigitos, uuid, ahoraISO } from './util.js';

export const FORMATO = 'catalogo_app.v1';
let cat = null;            // el catálogo tal como vino
let porId = new Map();     // item_id -> artículo
let porBarras = new Map(); // código de barras -> item_id
let barrasLocal = {};      // códigos vinculados en el celular -> item_id
let reglasLocal = [];      // equivalencias aprendidas en el celular
const plano = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const actual = () => cat;
export const articulo = (id) => porId.get(id) || null;
export const proveedores = () => (cat ? cat.proveedores : []);
export const usuarios = () => (cat ? cat.usuarios : []);
export const proveedor = (nombre) => proveedores().find((p) => p.proveedor === nombre) || null;

function indexar() {
  porId = new Map(); porBarras = new Map();
  if (!cat) return;
  for (const a of cat.articulos) {
    porId.set(a.item_id, a);
    a._busca = plano([a.nombre, a.categoria, a.fabricante, a.item_id, a.codigo_bistrosoft, ...(a.codigos_barras || []), ...(a.proveedores || []).map((p) => p.proveedor)].filter(Boolean).join(' '));
    for (const c of a.codigos_barras || []) porBarras.set(String(c), a.item_id);
    if (a.codigo_bistrosoft && /^\d{8,14}$/.test(a.codigo_bistrosoft) && !porBarras.has(a.codigo_bistrosoft)) porBarras.set(a.codigo_bistrosoft, a.item_id);
  }
}

export async function cargar() {
  cat = (await db.leer('kv', 'catalogo')) || null;
  barrasLocal = (await db.leer('kv', 'barras_local')) || {};
  reglasLocal = await db.todos('reglas');
  indexar();
  return cat;
}

/** Valida e importa un catalogo_app.json. Devuelve el resumen y los avisos. */
export async function importar(texto) {
  let j; try { j = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (j.formato !== FORMATO) throw new Error(`No es un catálogo de Sabores_Gestion (formato "${j.formato ?? '—'}", se espera "${FORMATO}").`);
  if (!Array.isArray(j.articulos) || !Array.isArray(j.proveedores)) throw new Error('El catálogo está incompleto.');
  const avisos = [];
  if (j.version_normalizador !== VERSION_NORMALIZADOR) avisos.push(`El normalizador de Gestión es la versión ${j.version_normalizador} y el de la app la ${VERSION_NORMALIZADOR}: hay que actualizar la app antes de usar equivalencias.`);
  if (!j.usuarios || !j.usuarios.length) avisos.push('El catálogo no trae usuarios: nadie va a poder firmar. Dalos de alta en Sistema › Usuarios y volvé a exportar.');
  j.importado = ahoraISO();
  await db.guardar('kv', 'catalogo', j);
  cat = j;
  // lo aprendido en el celular que ya volvió como regla del catálogo se descarta
  const enCat = new Set((j.equivalencias || []).map((e) => e.proveedor + '|' + e.descripcion_norm));
  for (const r of await db.todos('reglas')) if (enCat.has(r.proveedor + '|' + r.descripcion_norm)) await db.borrar('reglas', r.id);
  reglasLocal = await db.todos('reglas');
  indexar();
  return { resumen: j.resumen || {}, generado: j.generado, avisos };
}

// ---------- códigos de barras ----------
const digitoEAN = (doce) => { let s = 0; for (let i = 0; i < 12; i++) s += Number(doce[i]) * (i % 2 ? 3 : 1); return String((10 - (s % 10)) % 10); };
/** Qué es un código leído: artículo del catálogo, bulto (DUN-14), etiqueta de balanza o desconocido. */
export function interpretarCodigo(codigo) {
  const c = soloDigitos(codigo);
  const directo = porBarras.get(c) || barrasLocal[c];
  if (directo && porId.has(directo)) return { clase: 'articulo', codigo: c, item_id: directo };
  if (c.length === 14) {
    const ean = c.slice(1, 13) + digitoEAN(c.slice(1, 13));
    const id = porBarras.get(ean) || barrasLocal[ean];
    if (id && porId.has(id)) return { clase: 'bulto', codigo: c, item_id: id };
  }
  if (c.length === 13 && c[0] === '2') return { clase: 'balanza', codigo: c, plu: c.slice(2, 7), valor: Number(c.slice(7, 12)) };
  if (c.length === 12) { const id = porBarras.get('0' + c); if (id) return { clase: 'articulo', codigo: c, item_id: id }; }
  return { clase: 'desconocido', codigo: c };
}
export async function vincularCodigo(codigo, item_id) {
  barrasLocal[soloDigitos(codigo)] = item_id;
  await db.guardar('kv', 'barras_local', barrasLocal);
}

// ---------- buscar artículos ----------
/** Busca por nombre, código propio, código de Bistrosoft, de barras, marca, categoría o proveedor. */
export function buscar(texto, prov = null, max = 30) {
  if (!cat) return [];
  const palabras = plano(texto).split(/\s+/).filter(Boolean);
  const out = [];
  for (const a of cat.articulos) {
    let ok = true, puntos = 0;
    for (const p of palabras) { const i = a._busca.indexOf(p); if (i < 0) { ok = false; break; } puntos += i === 0 ? 3 : a._busca[i - 1] === ' ' ? 2 : 1; }
    if (!ok) continue;
    if (prov && (a.proveedores || []).some((x) => x.proveedor === prov)) puntos += 5;
    out.push({ a, puntos });
  }
  out.sort((x, y) => y.puntos - x.puntos || x.a.nombre.localeCompare(y.a.nombre));
  return out.slice(0, max).map((x) => x.a);
}
export const delProveedor = (prov) => (cat ? cat.articulos.filter((a) => (a.proveedores || []).some((x) => x.proveedor === prov)) : []);

/** Último costo conocido de un artículo, primero el de ese proveedor. Por unidad de stock. */
export function ultimoCosto(item_id, prov) {
  const a = porId.get(item_id); if (!a) return null;
  const p = (a.proveedores || []).find((x) => x.proveedor === prov && x.ultimo_costo !== null && x.ultimo_costo !== undefined);
  if (p) return { costo: p.ultimo_costo, fecha: p.ultimo_costo_fecha, origen: p.ultimo_costo_origen, de: prov };
  if (a.costo_vigente !== null && a.costo_vigente !== undefined) return { costo: a.costo_vigente, fecha: null, origen: 'maestro', de: null };
  return null;
}

// ---------- proveedores ----------
/** Reconoce al proveedor por CUIT (exacto) o por nombre (sólo como sugerencia). */
export function reconocerProveedor({ cuit, nombre }) {
  const c = soloDigitos(cuit);
  if (c.length === 11) {
    const p = proveedores().find((x) => x.cuit === c || (x.alias || []).some((a) => a.tipo === 'cuit' && soloDigitos(a.valor) === c));
    if (p) return { proveedor: p.proveedor, seguro: true };
  }
  const n = plano(nombre).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (n) {
    const igual = (t) => plano(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const p = proveedores().find((x) => [x.proveedor, x.razon_social, ...(x.alias || []).filter((a) => a.tipo === 'nombre').map((a) => a.valor)].filter(Boolean).some((t) => { const k = igual(t); return k && (k === n || (k.length > 3 && (n.includes(k) || k.includes(n)))); }));
    if (p) return { proveedor: p.proveedor, seguro: false };
  }
  return null;
}

// ---------- equivalencias ----------
function todasLasReglas(prov) {
  // primero lo corregido en el celular: si pisa una regla del catálogo, Gestión lo deja "para revisar" al importar
  return [...reglasLocal.filter((e) => e.proveedor === prov).map((e) => ({ ...e, local: true })),
    ...(cat?.equivalencias || []).filter((e) => e.proveedor === prov).map((e) => ({ ...e, local: false }))];
}
/** La regla guardada para lo que dice el proveedor: primero por su código, después por la descripción normalizada. */
export function buscarRegla(prov, codigo_prov, descripcion) {
  if (!prov) return null;
  const rs = todasLasReglas(prov);
  const cod = String(codigo_prov ?? '').trim();
  if (cod) { const r = rs.find((e) => e.codigo_prov && String(e.codigo_prov).trim() === cod); if (r) return r; }
  const norm = normalizarDescripcion(descripcion || '');
  if (norm) { const r = rs.find((e) => e.descripcion_norm === norm); if (r) return r; }
  return null;
}
/** Hasta 5 artículos parecidos, primero los que ya se compran a ese proveedor. Sólo para sugerir: nunca se aplica solo. */
export function sugerir(prov, codigo_prov, descripcion, n = 5) {
  if (!cat || !descripcion) return [];
  const out = [];
  const cod = String(codigo_prov ?? '').trim();
  for (const a of cat.articulos) {
    const suyo = (a.proveedores || []).find((x) => x.proveedor === prov);
    let p = parecido(descripcion, a.nombre + (a.fabricante ? ' ' + a.fabricante : ''));
    if (suyo) p += 0.15;
    if (cod && suyo && suyo.codigo_prov && String(suyo.codigo_prov).trim() === cod) p = Math.max(p, 0.95);
    if (p >= 0.3) out.push({ a, puntaje: Math.min(1, p), suyo: !!suyo });
  }
  out.sort((x, y) => y.puntaje - x.puntaje);
  return out.slice(0, n);
}
/** Guarda una regla aprendida en el celular. Viaja a Gestión dentro de la recepción (el importador la aprende). */
export async function guardarRegla({ proveedor: prov, codigo_prov, descripcion, destino, item_id, tipo_regla, factor, creada_por }) {
  const norm = normalizarDescripcion(descripcion || codigo_prov || '');
  if (!prov || !norm) return null;
  const vieja = reglasLocal.find((e) => e.proveedor === prov && e.descripcion_norm === norm);
  const r = { id: vieja ? vieja.id : 'loc_' + uuid(), equivalencia_id: null, proveedor: prov, codigo_prov: codigo_prov || null, descripcion: descripcion || null, descripcion_norm: norm,
    destino, item_id: destino === 'articulo' ? item_id : null, tipo_regla: tipo_regla || 'siempre_aviso', factor: factor || 1, creada_por, creada: ahoraISO(), confirmaciones: (vieja?.confirmaciones || 0) + 1 };
  await db.guardar('reglas', r.id, r);
  reglasLocal = await db.todos('reglas');
  return r;
}
export const reglasAprendidas = () => reglasLocal;
