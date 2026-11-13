// Lectura del comprobante, de lo gratis a lo pago (cascada de la especificación):
//   1) QR de ARCA (en el teléfono, gratis): da el encabezado.
//   2) Texto del PDF (en el teléfono, gratis).
//   3) Claude Haiku con el texto, o con la imagen si es una foto. Clave propia de la prueba, guardada sólo en este teléfono,
//      con tope de gasto por mes.
import * as db from './db.js';
import { achicar, blobABase64, num, soloDigitos, ahoraISO } from './util.js';

// ---------- 1) QR de ARCA ----------
const TIPOS_ARCA = { 1: 'FA', 2: 'FA', 3: 'NC', 6: 'FB', 7: 'FB', 8: 'NC', 11: 'FC', 12: 'FC', 13: 'NC', 51: 'FA', 52: 'FA', 53: 'NC', 201: 'FA', 203: 'NC', 206: 'FB', 208: 'NC', 211: 'FC', 213: 'NC' };
/** Interpreta el texto de un QR de factura electrónica. Devuelve null si no es de ARCA. */
export function leerQRArca(texto) {
  const m = String(texto || '').match(/[?&]p=([A-Za-z0-9+/_=-]+)/);
  if (!m) return null;
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    if (!j.cuit || !j.nroCmp) return null;
    return { cuit: soloDigitos(j.cuit), tipo: TIPOS_ARCA[j.tipoCmp] || null, tipo_arca: j.tipoCmp, punto_venta: String(j.ptoVta ?? ''), numero: String(j.nroCmp),
      fecha: /^\d{4}-\d{2}-\d{2}/.test(j.fecha || '') ? j.fecha.slice(0, 10) : null, total: num(j.importe), cae: j.codAut ? String(j.codAut) : null };
  } catch { return null; }
}
export const hayDetector = () => 'BarcodeDetector' in globalThis;
/** Busca un QR de ARCA en una imagen. */
export async function qrEnImagen(blob) {
  if (!hayDetector()) return null;
  try {
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const bmp = await createImageBitmap(blob);
    const cs = await det.detect(bmp);
    for (const c of cs) { const q = leerQRArca(c.rawValue); if (q) return q; }
  } catch { }
  return null;
}

// ---------- 2) PDF ----------
let pdfjs = null;
async function cargarPdfjs() {
  if (!pdfjs) { pdfjs = await import('../vendor/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href; }
  return pdfjs;
}
/** Texto de cada página (ordenado por renglón) y una imagen de cada una. */
export async function leerPDF(blob, { imagenes = true, escala = 1.6 } = {}) {
  const lib = await cargarPdfjs();
  const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  const paginas = [];
  for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
    const pag = await doc.getPage(n);
    const tc = await pag.getTextContent();
    const filas = new Map();
    for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5] / 3) * 3; if (!filas.has(y)) filas.set(y, []); filas.get(y).push({ x: it.transform[4], s: it.str }); }
    const texto = [...filas.entries()].sort((a, b) => b[0] - a[0]).map(([, f]) => f.sort((a, b) => a.x - b.x).map((k) => k.s).join('  ')).join('\n');
    let imagen = null;
    if (imagenes) {
      const vp = pag.getViewport({ scale: escala });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pag.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      imagen = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    }
    paginas.push({ texto, imagen });
  }
  return { paginas, texto: paginas.map((p) => p.texto).join('\n\n'), conTexto: paginas.reduce((s, p) => s + p.texto.length, 0) > 150 };
}

// ---------- 3) Claude ----------
const API = 'https://api.anthropic.com/v1';
const cabeceras = (clave) => ({ 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' });
export const mesActual = () => ahoraISO().slice(0, 7);
export async function gastoDelMes() { const g = (await db.leer('kv', 'gasto')) || {}; return g[mesActual()] || { usd: 0, llamadas: 0, entrada: 0, salida: 0 }; }
async function sumarGasto(uso, cfg) {
  const g = (await db.leer('kv', 'gasto')) || {}; const m = mesActual();
  const x = g[m] || { usd: 0, llamadas: 0, entrada: 0, salida: 0 };
  const ent = (uso.input_tokens || 0) + (uso.cache_creation_input_tokens || 0) + (uso.cache_read_input_tokens || 0), sal = uso.output_tokens || 0;
  x.entrada += ent; x.salida += sal; x.llamadas++;
  x.usd = Math.round((x.usd + ent / 1e6 * (cfg.precio_entrada ?? 1) + sal / 1e6 * (cfg.precio_salida ?? 5)) * 1e6) / 1e6;
  g[m] = x; await db.guardar('kv', 'gasto', g);
  return x;
}
/** Los modelos Haiku que ofrece la cuenta, del más nuevo al más viejo. */
export async function modelosHaiku(clave) {
  const r = await fetch(API + '/models?limit=100', { headers: cabeceras(clave) });
  if (!r.ok) throw new Error(await errorDe(r));
  const j = await r.json();
  return (j.data || []).filter((m) => /haiku/i.test(m.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((m) => ({ id: m.id, nombre: m.display_name || m.id }));
}
async function errorDe(r) {
  let d = ''; try { const j = await r.json(); d = j?.error?.message || ''; } catch { }
  if (r.status === 401) return 'La clave de la API no es válida.';
  if (r.status === 404) return 'Ese modelo no existe para esta clave. Elegí otro en Configuración › Lectura con IA.';
  if (r.status === 429) return 'La API está limitando las llamadas. Probá de nuevo en un minuto.';
  return `La API respondió ${r.status}${d ? ': ' + d : ''}`;
}

const INSTRUCCIONES = `Sos un lector de comprobantes de proveedores de un almacén gourmet de Argentina (facturas A, B, C, notas de crédito y remitos, impresos o escritos a mano).
Devolvé SOLO un objeto JSON, sin texto antes ni después, con esta forma:
{"proveedor":{"nombre":string|null,"cuit":string|null},
 "comprobante":{"tipo":"FA"|"FB"|"FC"|"NC"|"RTO"|null,"punto_venta":string|null,"numero":string|null,"fecha":"AAAA-MM-DD"|null,"vence":"AAAA-MM-DD"|null,"neto":number|null,"iva":number|null,"percepciones":number|null,"otros":number|null,"total":number|null},
 "renglones":[{"codigo":string|null,"descripcion":string,"cantidad":number|null,"unidad":string|null,"precio":number|null,"bonif":number|null,"alicuota":number|null,"importe":number|null,"confianza":number}],
 "manuscrito":[string],
 "confianza":number}
Reglas:
- El proveedor es quien EMITE el comprobante, no el cliente (el cliente es Sabores para Compartir o su dueña).
- "precio" es el precio unitario tal como figura en el renglón (en factura A, sin IVA). "bonif" es el porcentaje de bonificación o descuento del renglón (0 si no hay). "importe" es el importe del renglón.
- "alicuota" es el porcentaje de IVA del renglón (21, 10.5, 27) si figura.
- Números con punto decimal y sin separador de miles. Fechas en AAAA-MM-DD.
- "neto" es el subtotal sin impuestos; "iva" la suma de IVA; "percepciones" la suma de percepciones (IIBB, IVA); "otros" impuestos internos u otros cargos.
- Un remito puede no tener precios: dejalos en null.
- "confianza" va de 0 a 1 por renglón y en general: bajala cuando la letra, el número o la columna sean dudosos. No inventes datos: si algo no se lee, null.
- "manuscrito": todo lo anotado a mano encima del comprobante impreso (por ejemplo "pagado $50.000", "devuelto 1 caja", "falta 2"), una entrada por anotación. Lista vacía si no hay.
- Copiá las descripciones tal cual están escritas, sin corregirlas ni traducirlas.`;

/**
 * Lee un comprobante con Claude. `entrada` es { texto } (PDF con texto) o { imagenes: [Blob] } (fotos o PDF escaneado).
 * Devuelve { datos, uso, gasto } o tira un error con un mensaje para mostrar.
 */
export async function leerConClaude(entrada, cfg) {
  const dentro = await enArtefacto();
  if (dentro) return leerEnArtefacto(dentro, entrada);
  if (!cfg.api_clave) throw new Error('Falta la clave de la API. Cargala en Configuración › Lectura con IA.');
  if (!navigator.onLine) throw new Error('No hay señal. La foto queda guardada: leela cuando vuelva la conexión, o cargá los renglones a mano.');
  const g = await gastoDelMes();
  const tope = cfg.tope_usd ?? 5;
  if (g.usd >= tope) throw new Error(`Se llegó al tope de US$ ${tope} de este mes (van US$ ${g.usd.toFixed(2)}). Subilo en Configuración o cargá a mano.`);
  let modelo = cfg.modelo;
  if (!modelo) { const ms = await modelosHaiku(cfg.api_clave); if (!ms.length) throw new Error('La cuenta no ofrece ningún modelo Haiku.'); modelo = ms[0].id; cfg.modelo = modelo; cfg._modeloElegido = true; }
  const contenido = [];
  if (entrada.imagenes && entrada.imagenes.length) {
    for (const b of entrada.imagenes.slice(0, 6)) { const a = await achicar(b, 1568, 0.85); contenido.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobABase64(a.blob) } }); }
    contenido.push({ type: 'text', text: 'Leé este comprobante (puede tener varias páginas) y devolvé el JSON.' });
  } else contenido.push({ type: 'text', text: 'Texto extraído del PDF del comprobante, renglón por renglón:\n\n' + String(entrada.texto || '').slice(0, 60000) + '\n\nDevolvé el JSON.' });
  const r = await fetch(API + '/messages', { method: 'POST', headers: cabeceras(cfg.api_clave),
    body: JSON.stringify({ model: modelo, max_tokens: 8000, system: [{ type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: contenido }] }) });
  if (!r.ok) throw new Error(await errorDe(r));
  const j = await r.json();
  const gasto = await sumarGasto(j.usage || {}, cfg);
  const texto = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const i = texto.indexOf('{'), f = texto.lastIndexOf('}');
  let datos; try { datos = JSON.parse(texto.slice(i, f + 1)); } catch { throw new Error('La lectura no devolvió datos que se puedan usar. Probá con otra foto, más derecha y con luz, o cargá a mano.'); }
  if (j.stop_reason === 'max_tokens') datos.cortado = true;
  return { datos, uso: j.usage, gasto, modelo };
}

// Dentro de un artefacto de Claude no hay clave: la página le pide la lectura a Claude con la cuenta de quien la mira.
let _muestra;
async function enArtefacto() {
  if (_muestra === undefined) { try { _muestra = globalThis.claude && globalThis.claude.use ? await globalThis.claude.use('sample') : null; } catch { _muestra = null; } }
  return _muestra || null;
}
export const lecturaSinClave = async () => !!(await enArtefacto());
async function leerEnArtefacto(muestra, entrada) {
  const opciones = { cache: false, modelTier: 'default' };
  let pedido = INSTRUCCIONES + '\n\n';
  if (entrada.imagenes && entrada.imagenes.length) {
    const lim = await muestra.limits().catch(() => null);
    if (!lim || !lim.images) throw new Error('Esta vista no puede mandar imágenes a Claude. Cargá los renglones a mano.');
    const fotos = [];
    for (const b of entrada.imagenes.slice(0, lim.images.maxCount || 4)) fotos.push((await achicar(b, 1568, 0.85)).blob);
    opciones.images = fotos;
    pedido += 'Leé el comprobante de las imágenes adjuntas (puede tener varias páginas) y devolvé el JSON.';
  } else pedido += 'Texto extraído del PDF del comprobante, renglón por renglón:\n\n' + String(entrada.texto || '').slice(0, 60000) + '\n\nDevolvé el JSON.';
  let r;
  try { r = await muestra(pedido, opciones); }
  catch (e) {
    const m = { not_granted: 'No se dio permiso para usar Claude en esta página. Cargá los renglones a mano.', rate_limited: 'Claude está ocupado. Probá de nuevo en un minuto.', images_unavailable: 'Esta vista no puede mandar imágenes a Claude.', cancelled: 'Se canceló la lectura.' };
    throw new Error(m[e && e.code] || 'No se pudo leer con Claude' + (e && e.code ? ` (${e.code})` : '') + '. Probá de nuevo o cargá a mano.');
  }
  const texto = r.text || '', i = texto.indexOf('{'), f = texto.lastIndexOf('}');
  let datos; try { datos = JSON.parse(texto.slice(i, f + 1)); } catch { throw new Error('La lectura no devolvió datos que se puedan usar. Probá con otra foto, más derecha y con luz, o cargá a mano.'); }
  if (r.truncated) datos.cortado = true;
  return { datos, uso: null, gasto: await gastoDelMes(), modelo: 'claude (artefacto)' };
}

/** Pasa lo que devolvió el modelo a los campos de la app, con los números limpios. */
export function interpretar(datos) {
  const c = datos.comprobante || {}, p = datos.proveedor || {};
  const tipo = ['FA', 'FB', 'FC', 'NC', 'RTO'].includes(c.tipo) ? c.tipo : null;
  const f = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
  return {
    proveedor: { nombre: p.nombre || null, cuit: soloDigitos(p.cuit).length === 11 ? soloDigitos(p.cuit) : null },
    comp: { tipo, punto_venta: c.punto_venta ? soloDigitos(c.punto_venta) : null, numero: c.numero ? soloDigitos(c.numero) : null, fecha: f(c.fecha), vence: f(c.vence),
      neto: num(c.neto), iva: num(c.iva), percepciones: num(c.percepciones), otros: num(c.otros), total: num(c.total) },
    renglones: (Array.isArray(datos.renglones) ? datos.renglones : []).filter((r) => r && (r.descripcion || r.codigo)).map((r) => {
      let precio = num(r.precio); const cantidad = num(r.cantidad), bonif = num(r.bonif) || 0, imp = num(r.importe);
      // si falta el precio pero está el importe, sale de la cuenta
      if (precio === null && imp !== null && cantidad) precio = Math.round(imp / cantidad / (1 - bonif / 100) * 100) / 100;
      return { codigo_prov: r.codigo ? String(r.codigo).trim() : null, descripcion: String(r.descripcion || '').trim() || null, cantidad, unidad: r.unidad ? String(r.unidad).trim() : null,
        precio, bonif, alicuota: num(r.alicuota), importe_leido: imp, confianza: typeof r.confianza === 'number' ? Math.max(0, Math.min(1, r.confianza)) : 0.6 };
    }),
    manuscrito: (Array.isArray(datos.manuscrito) ? datos.manuscrito : []).map((s) => String(s).trim()).filter(Boolean),
    confianza: typeof datos.confianza === 'number' ? datos.confianza : null, cortado: !!datos.cortado,
  };
}
