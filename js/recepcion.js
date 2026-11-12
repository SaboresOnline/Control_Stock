// La recepción: el borrador, sus cuentas, la validación (sección 3.3 de la especificación) y lo que sale al aprobar
// (recepcion.v1 para Sabores_Gestion y las filas del Excel de Bistrosoft). Sin pantalla: sólo datos.
import * as cat from './catalogo.js';
import { r2, r3, ahoraISO, hoy, uuid, ceros, dias, limpio, pesos, cant } from './util.js';

export const TIPOS = { FA: 'Factura A', FB: 'Factura B', FC: 'Factura C', NC: 'Nota de crédito', RTO: 'Remito' };
export const DESTINOS = { articulo: 'Artículo', gisela: 'Para Gisela', gasto: 'Gasto del local', flete: 'Flete o cargo' };
export const TOLERANCIA = 10;        // pesos
export const UMBRAL_PRECIO = 4;      // % contra el último costo
export const UMBRAL_RARO = 25;       // % : probable error de lectura
export const CONFIANZA_MIN = 0.75;

export function nueva(usuario) {
  const t = ahoraISO();
  return { uuid: uuid(), estado: 'borrador', creado: t, actualizado: t, proveedor: null, proveedor_leido: null,
    comp: { tipo: 'FA', punto_venta: '', numero: '', fecha: hoy(), vence: '', neto: null, iva: null, percepciones: null, otros: null, total: null, reemplaza: null },
    adjuntos: [], renglones: [], escaneos: [], aceptados: {}, manuscrito: [], nota: '',
    firmas: { recibido_por: usuario.usuario_id, recibido_en: t, aprobado_por: null, aprobado_en: null },
    lectura: { campos: 0, corregidos: 0, pasos: [] }, salidas: [] };
}
export function renglonNuevo(rec, datos = {}) {
  const linea = rec.renglones.reduce((m, r) => Math.max(m, r.linea), 0) + 1;
  const r = { linea, codigo_prov: null, descripcion: null, destino: null, item_id: null, equivalencia_id: null, regla_tipo: null, nuevo: false, nose: false,
    cant_facturada: null, cant_recibida: null, cant_escaneada: null, unidad: null, factor: 1, precio: null, bonif: 0, alicuota: null,
    lote: null, vence: null, origen: 'manual', leido: null, confianza: null, revisado: true, editado_por: null, editado_en: null, nota: null, ...datos };
  rec.renglones.push(r);
  return r;
}
export const costoUnit = (r) => (r.precio === null || r.precio === undefined ? null : r2(r.precio * (1 - (r.bonif || 0) / 100)));
export const importe = (r) => { const c = costoUnit(r); return c === null || r.cant_facturada === null ? null : r2(c * r.cant_facturada); };
/** Costo por unidad de stock (una caja de 12 a $1.200 = $100 por unidad). */
export const costoStock = (r) => { const c = costoUnit(r); return c === null ? null : r2(c / (r.factor || 1)); };

export function totales(rec) {
  const c = rec.comp;
  const suma = r2(rec.renglones.reduce((s, r) => s + (importe(r) || 0), 0));
  const gisela = r2(rec.renglones.filter((r) => r.destino === 'gisela').reduce((s, r) => s + (importe(r) || 0), 0));
  const resto = (c.iva || 0) + (c.percepciones || 0) + (c.otros || 0);
  const esperado = c.neto !== null && c.neto !== undefined ? c.neto : c.total !== null && c.total !== undefined ? r2(c.total - resto) : null;
  return { suma, gisela, esperado, diferencia: esperado === null ? null : r2(suma - esperado),
    armado: c.neto !== null && c.neto !== undefined ? r2(c.neto + resto) : null };
}

/** Busca la equivalencia de un renglón recién leído o tipeado y la aplica si la regla lo permite. */
export function asociarSolo(rec, r) {
  // 1) código de barras
  if (r.codigo_prov && /^\d{8,14}$/.test(String(r.codigo_prov))) {
    const x = cat.interpretarCodigo(r.codigo_prov);
    if (x.item_id) { r.destino = 'articulo'; r.item_id = x.item_id; r.equivalencia_id = null; r.regla_tipo = 'barras'; return 'barras'; }
  }
  // 2 y 3) regla guardada por código o por descripción normalizada
  const e = cat.buscarRegla(rec.proveedor, r.codigo_prov, r.descripcion);
  if (e && e.tipo_regla !== 'preguntar' && (e.destino !== 'articulo' || cat.articulo(e.item_id))) {
    r.destino = e.destino; r.item_id = e.destino === 'articulo' ? e.item_id : null; r.factor = e.factor || 1;
    r.equivalencia_id = e.local ? null : e.equivalencia_id; r.regla_tipo = e.tipo_regla; r.regla_local = !!e.local;
    return e.tipo_regla;
  }
  return e ? 'preguntar' : null;   // 4 y 5) queda para elegir a mano
}

// ---------- validación ----------
const firma = (...v) => v.map((x) => (x === null || x === undefined ? '' : String(x))).join('~');
/**
 * Devuelve la lista de bloqueos y avisos. `otras` son las demás recepciones guardadas (para el duplicado).
 * Cada uno lleva `ambito`: 'fisico' (lo controla quien recibe) o 'precio' (lo resuelve un dueño o encargado).
 */
export function validar(rec, otras = []) {
  const out = [];
  const pon = (nivel, regla, linea, detalle, ambito = 'fisico', f = '') => out.push({ clave: `${regla}:${linea ?? 'c'}:${f}`, nivel, regla, linea, detalle, ambito });
  const c = rec.comp, hoyISO = hoy();
  if (!rec.proveedor || !cat.proveedor(rec.proveedor)) pon('bloqueo', 'proveedor', null, 'Falta elegir el proveedor del catálogo. Si es nuevo, hay que darlo de alta en Sabores_Gestion y volver a exportar el catálogo.');
  if (!TIPOS[c.tipo]) pon('bloqueo', 'comprobante', null, 'Falta el tipo de comprobante.');
  if (!String(c.numero || '').trim()) pon('bloqueo', 'comprobante', null, 'Falta el número del comprobante.', 'fisico', 'n');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '')) pon('bloqueo', 'comprobante', null, 'Falta la fecha del comprobante.', 'fisico', 'f');
  else if (c.fecha > hoyISO) pon('aviso', 'fecha', null, `La fecha del comprobante (${c.fecha}) es posterior a hoy.`, 'fisico', c.fecha);
  if (rec.proveedor && String(c.numero || '').trim()) {
    const pv = ceros(c.punto_venta, 4), nro = ceros(c.numero, 8);
    const d = otras.find((o) => o.uuid !== rec.uuid && o.proveedor === rec.proveedor && o.comp.tipo === c.tipo && ceros(o.comp.punto_venta, 4) === pv && ceros(o.comp.numero, 8) === nro);
    if (d) pon('bloqueo', 'duplicado', null, `El comprobante ${c.tipo} ${pv ? pv + '-' : ''}${nro} de ${rec.proveedor} ya está cargado en este celular (${d.estado}).`);
  }
  if (!rec.renglones.length) pon('bloqueo', 'renglones', null, 'La recepción no tiene renglones.');

  for (const r of rec.renglones) {
    const que = r.descripcion || r.codigo_prov || (r.item_id && cat.articulo(r.item_id)?.nombre) || 'sin descripción';
    const a = r.destino === 'articulo' && r.item_id ? cat.articulo(r.item_id) : null;
    if (r.nose) pon('bloqueo', 'sin_articulo', r.linea, `${que}: quedó marcado "No sé". Lo tiene que resolver un dueño.`);
    else if (!r.destino) pon('bloqueo', 'sin_articulo', r.linea, `${que}: falta asociarlo a un artículo o a un destino.`);
    else if (r.destino === 'articulo' && !r.item_id && !r.nuevo) pon('bloqueo', 'sin_articulo', r.linea, `${que}: falta elegir el artículo.`);
    else if (r.destino === 'articulo' && r.nuevo) pon('aviso', 'producto_nuevo', r.linea, `${que}: producto nuevo. Entra con su costo y queda "para revisar" en Gestión hasta que Gisela lo dé de alta.`, 'fisico', que);
    if (r.regla_tipo === 'siempre_aviso' && !r.editado_asoc) pon('info', 'regla_aviso', r.linea, `${que}: asociado solo por una regla guardada (${r.destino === 'articulo' ? a?.nombre || r.item_id : DESTINOS[r.destino]}).`);
    if (r.cant_recibida === null || r.cant_recibida === undefined) pon('bloqueo', 'cantidad', r.linea, `${que}: falta la cantidad recibida.`);
    if ((r.cant_facturada || 0) > 0 && costoUnit(r) === null) pon('bloqueo', 'precio', r.linea, `${que}: falta el precio.`, 'precio');
    if (!r.revisado && r.confianza !== null && r.confianza < CONFIANZA_MIN) pon('aviso', 'lectura_dudosa', r.linea, `${que}: se leyó con poca confianza. Abrí el renglón y confirmalo.`, 'fisico', 'd');
    // cantidades
    if (r.cant_recibida !== null && r.cant_facturada !== null && Math.abs(r.cant_recibida - r.cant_facturada) > 1e-9)
      pon('aviso', 'cantidad', r.linea, r.cant_facturada === 0 ? `${que}: llegaron ${cant(r.cant_recibida)} sin facturar.` : `${que}: facturado ${cant(r.cant_facturada)}, recibido ${cant(r.cant_recibida)}. Queda para reclamar al proveedor.`, 'fisico', firma(r.cant_facturada, r.cant_recibida));
    // vencimientos (los pesables no llevan control de vencimiento)
    if (a && a.perecedero === true && !a.pesable && (r.cant_recibida || 0) > 0) {
      if (!r.vence) pon('bloqueo', 'vencimiento', r.linea, `${a.nombre}: es perecedero y falta la fecha de vencimiento.`);
    }
    if (r.vence && a && !a.pesable) {
      const quedan = dias(hoyISO, r.vence);
      if (quedan < 0) pon('aviso', 'vencimiento', r.linea, `${a.nombre}: llegó vencido (${r.vence}).`, 'fisico', r.vence);
      else if (quedan < 7) pon('aviso', 'vencimiento', r.linea, `${a.nombre}: vence en ${quedan} día${quedan === 1 ? '' : 's'}.`, 'fisico', r.vence);
      else if (a.vida_util_dias && quedan < a.vida_util_dias / 2) pon('aviso', 'vencimiento', r.linea, `${a.nombre}: le quedan ${quedan} días de ${a.vida_util_dias} de vida útil.`, 'fisico', r.vence);
    }
    // precios
    if (a && costoStock(r) !== null) {
      const u = cat.ultimoCosto(a.item_id, rec.proveedor);
      if (u && u.costo > 0) {
        const pct = r2((costoStock(r) - u.costo) / u.costo * 100);
        const contra = `${pesos(u.costo)} (${u.de ? 'último de ' + u.de : 'costo del maestro'}${u.fecha ? ', ' + u.fecha : ''})`;
        if (Math.abs(pct) > UMBRAL_RARO) pon('aviso', 'precio_raro', r.linea, `${a.nombre}: ${pesos(costoStock(r))} por ${a.unidad} contra ${contra}: ${pct > 0 ? '+' : ''}${String(pct).replace('.', ',')}%. Puede ser un error de lectura o de unidad.`, 'precio', firma(costoStock(r)));
        else if (Math.abs(pct) > UMBRAL_PRECIO) pon('aviso', 'precio', r.linea, `${a.nombre}: ${pesos(costoStock(r))} por ${a.unidad} contra ${contra}: ${pct > 0 ? '+' : ''}${String(pct).replace('.', ',')}%.`, 'precio', firma(costoStock(r)));
      }
    }
  }
  // totales
  const t = totales(rec);
  if (c.total === null || c.total === undefined) pon('bloqueo', 'totales', null, 'Falta el total del comprobante.', 'precio', 't');
  else {
    if (t.armado !== null && Math.abs(t.armado - c.total) > TOLERANCIA) pon('bloqueo', 'totales', null, `Neto + IVA + percepciones + otros da ${pesos(t.armado)} y el total dice ${pesos(c.total)}.`, 'precio', 'a');
    if (t.diferencia !== null && Math.abs(t.diferencia) > TOLERANCIA) pon('bloqueo', 'totales', null, `Los renglones suman ${pesos(t.suma)} y el ${c.neto !== null && c.neto !== undefined ? 'neto' : 'total sin impuestos'} es ${pesos(t.esperado)}: diferencia de ${pesos(t.diferencia)}.`, 'precio', 's');
  }
  return out;
}
/** Bloqueos y avisos sin aceptar, según lo que le toca a ese rol. */
export function pendientes(rec, lista, soloFisico = false) {
  const l = soloFisico ? lista.filter((v) => v.ambito === 'fisico') : lista;
  return { bloqueos: l.filter((v) => v.nivel === 'bloqueo'), avisos: l.filter((v) => v.nivel === 'aviso' && !rec.aceptados[v.clave]) };
}

// ---------- salidas ----------
export const numeroLargo = (c) => `${c.punto_venta ? ceros(c.punto_venta, 4) + '-' : ''}${ceros(c.numero, 8)}`;
export const carpetaDrive = (rec) => `SpC Recepciones/${limpio(rec.proveedor).replace(/-/g, ' ')}/${rec.comp.fecha}_${rec.comp.tipo}-${numeroLargo(rec.comp)}`;
export const nombreControl = (rec) => `${rec.comp.fecha}_${limpio(rec.proveedor)}_${rec.comp.tipo}-${numeroLargo(rec.comp)}_control.pdf`;

/** El archivo para Sabores_Gestion, tal como lo pide docs/RECEPCION-V1.md. */
export function aRecepcionV1(rec, cfg, lista = []) {
  const p = cat.proveedor(rec.proveedor) || {};
  const c = rec.comp;
  const origenes = new Set(rec.renglones.map((r) => (r.origen === 'pdf' ? 'foto' : r.origen)));
  const nz = (v) => (v === null || v === undefined || v === '' ? null : v);
  const validaciones = [];
  for (const v of lista) {
    const ac = rec.aceptados[v.clave];
    if (v.nivel === 'aviso' && ac) validaciones.push({ linea: v.linea, regla: v.regla, nivel: 'aviso', detalle: v.detalle, motivo_aceptado: ac.motivo, aceptado_por: ac.por, fecha: ac.fecha });
    else if (v.nivel === 'info') validaciones.push({ linea: v.linea, regla: v.regla, nivel: 'info', detalle: v.detalle, motivo_aceptado: null, aceptado_por: null, fecha: rec.firmas.aprobado_en });
  }
  for (const m of rec.manuscrito || []) validaciones.push({ linea: null, regla: 'manuscrito', nivel: 'info', detalle: 'Anotado a mano en el comprobante: ' + m, motivo_aceptado: null, aceptado_por: null, fecha: rec.firmas.aprobado_en });
  return {
    formato: 'recepcion.v1', uuid: rec.uuid, comercio: cat.actual()?.comercio || null, dispositivo: cfg.dispositivo || 'celular-local',
    modo: origenes.size > 1 ? 'mixto' : [...origenes][0] || 'manual', pedido_id: null,
    proveedor: { proveedor: rec.proveedor, cuit: p.cuit || null },
    comprobante: { tipo: c.tipo, punto_venta: ceros(c.punto_venta, 4), numero: ceros(c.numero, 8), fecha: c.fecha, vence: nz(c.vence),
      neto: nz(c.neto), iva: nz(c.iva), percepciones: nz(c.percepciones), otros: nz(c.otros), total: c.total, importe_gisela: null,
      ...(c.reemplaza && c.reemplaza.numero ? { reemplaza: { tipo: 'RTO', punto_venta: c.reemplaza.punto_venta || '', numero: c.reemplaza.numero } } : {}) },
    renglones: rec.renglones.map((r) => ({ linea: r.linea, codigo_prov: nz(r.codigo_prov), descripcion: nz(r.descripcion) || (r.item_id ? cat.articulo(r.item_id)?.nombre : null) || null,
      destino: r.destino, item_id: r.destino === 'articulo' ? r.item_id : null, equivalencia_id: r.equivalencia_id || null,
      cant_facturada: r.cant_facturada ?? 0, cant_recibida: r.cant_recibida, cant_escaneada: r.cant_escaneada, unidad: nz(r.unidad), factor: r.factor || 1,
      costo_unit: costoUnit(r), bonif: r.bonif || 0, alicuota: nz(r.alicuota), importe: importe(r) ?? 0, lote: nz(r.lote), vence: nz(r.vence),
      origen: r.origen === 'pdf' ? 'foto' : r.origen, leido: r.leido, confianza: r.confianza, editado_por: r.editado_por, editado_en: r.editado_en,
      ...(r.nota || r.nuevo ? { nota: [r.nuevo ? 'Producto nuevo propuesto desde la app' : null, r.nota].filter(Boolean).join(' · ') } : {}) })),
    validaciones,
    salidas: rec.salidas.map((s) => ({ tipo: s.tipo, archivo: s.archivo, url: null, hash: s.hash || null, generado: s.generado, canal: s.canal || null, enviado_a: null, resultado: s.resultado || null })),
    firmas: { ...rec.firmas },
    archivo: { carpeta_drive: carpetaDrive(rec), url: null },
    nota: nz(rec.nota),
  };
}

export const COLUMNAS_BISTROSOFT = ['Código', 'Nombre', 'Cantidad', 'Costo unitario', 'Sucursal', 'Fecha', 'Comprobante'];
/** Filas del Excel de Bistrosoft y lo que queda afuera, con el motivo. La pestaña y el archivo salen de acá. */
export function filasBistrosoft(rec, cfg) {
  const filas = [], afuera = [];
  for (const r of rec.renglones) {
    const a = r.item_id ? cat.articulo(r.item_id) : null;
    const que = a?.nombre || r.descripcion || r.codigo_prov || `Renglón ${r.linea}`;
    if (r.destino !== 'articulo') { afuera.push({ que, motivo: DESTINOS[r.destino] || 'Sin destino' }); continue; }
    if (!a) { afuera.push({ que, motivo: 'Producto nuevo: todavía no existe en Bistrosoft' }); continue; }
    if (!a.codigo_bistrosoft) { afuera.push({ que, motivo: 'No tiene código de Bistrosoft (queda sólo en Gestión)' }); continue; }
    if (!(r.cant_recibida > 0)) { afuera.push({ que, motivo: 'No se recibió' }); continue; }
    filas.push([a.codigo_bistrosoft, a.nombre, r3(r.cant_recibida * (r.factor || 1)), costoStock(r) ?? 0, cfg.sucursal || cat.actual()?.comercio || '', rec.comp.fecha, `${rec.comp.tipo} ${numeroLargo(rec.comp)}`]);
  }
  return { columnas: COLUMNAS_BISTROSOFT, filas, afuera };
}

/** Cuántos campos leyó el sistema y cuántos se corrigieron a mano (para el resumen del PDF). */
export function calidad(rec) {
  let leidos = 0, corregidos = 0;
  const igual = (a, b) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
  for (const r of rec.renglones) {
    if (!r.leido) continue;
    for (const [k, v] of [['descripcion', r.descripcion], ['codigo_prov', r.codigo_prov], ['cantidad', r.cant_facturada], ['unidad', r.unidad], ['precio', r.precio], ['bonif', r.bonif || 0], ['alicuota', r.alicuota]]) {
      if (!(k in r.leido)) continue;
      leidos++; if (!igual(r.leido[k], v)) corregidos++;
    }
  }
  return { leidos, corregidos, acierto: leidos ? Math.round((1 - corregidos / leidos) * 1000) / 10 : null };
}
/** Campos de un renglón que se corrigieron a mano: [{campo, leido, final}] */
export function correcciones(r) {
  if (!r.leido) return [];
  const out = [];
  const igual = (a, b) => (a ?? null) === (b ?? null) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
  for (const [k, n, v] of [['descripcion', 'descripción', r.descripcion], ['codigo_prov', 'código', r.codigo_prov], ['cantidad', 'cantidad', r.cant_facturada], ['unidad', 'unidad', r.unidad], ['precio', 'precio', r.precio], ['bonif', 'bonif.', r.bonif || 0], ['alicuota', 'IVA', r.alicuota]])
    if (k in r.leido && !igual(r.leido[k], v)) out.push({ campo: n, leido: r.leido[k], final: v });
  return out;
}
