// Lo que se genera al aprobar: PDF de control, Excel para Bistrosoft y recepcion_<uuid>.json. Todo en el teléfono.
import * as db from './db.js';
import * as cat from './catalogo.js';
import * as R from './recepcion.js';
import { escribirHoja } from './xlsx.js';
import { leerPDF } from './leer.js';
import { nombreDe } from './sesion.js';
import { sha1, ahoraISO, pesos, cant, fechaCorta, fechaHora, blobADataURL, achicar } from './util.js';

const txt = (s) => String(s ?? '').replace(/[^\x09\x0a\x20-\x7e -ÿ]/g, (c) => ({ '›': '>', '—': '-', '–': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '→': '->', '×': 'x', '≥': '>=', '≤': '<=' }[c] ?? '?'));
const valor = (v) => (v === null || v === undefined || v === '' ? '-' : typeof v === 'number' ? cant(v) : String(v));

/** Las imágenes del original (las fotos, o las páginas del PDF del proveedor). */
async function paginasOriginal(rec) {
  const out = [];
  for (const a of rec.adjuntos) {
    const blob = await db.leer('archivos', a.id); if (!blob) continue;
    if (a.tipo === 'application/pdf') { try { const p = await leerPDF(blob, { imagenes: true, escala: 1.8 }); for (const x of p.paginas) if (x.imagen) out.push(x.imagen); } catch { } }
    else out.push(blob);
  }
  return out;
}

export async function pdfControl(rec, lista) {
  const { jsPDF } = globalThis.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, H = 210, M = 10;
  const c = rec.comp, t = R.totales(rec), q = R.calidad(rec);
  const titulo = `${rec.proveedor} · ${R.TIPOS[c.tipo]} ${R.numeroLargo(c)} · ${fechaCorta(c.fecha)}`;

  // ---- Parte 2: lo entendido, renglón por renglón ----
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(txt('Control de recepción'), M, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(txt(titulo), M, 20);
  doc.setFontSize(9);
  doc.text(txt(`Recibido y controlado por: ${nombreDe(rec.firmas.recibido_por)} (${fechaHora(rec.firmas.recibido_en)})    Aprobado por: ${nombreDe(rec.firmas.aprobado_por)} (${fechaHora(rec.firmas.aprobado_en)})`), M, 25.5);
  const fila = (r) => {
    const a = r.item_id ? cat.articulo(r.item_id) : null;
    const corr = R.correcciones(r).map((x) => `${x.campo}: ${valor(x.leido)} -> ${valor(x.final)}`);
    const avisos = lista.filter((v) => v.linea === r.linea && v.nivel === 'aviso' && rec.aceptados[v.clave]).map((v) => `Aviso aceptado: ${v.detalle} Motivo: ${rec.aceptados[v.clave].motivo}`);
    const dif = r.cant_recibida !== null && r.cant_facturada !== null ? r.cant_recibida - r.cant_facturada : null;
    const leido = r.leido ? `${r.leido.codigo_prov ? '[' + r.leido.codigo_prov + '] ' : ''}${r.leido.descripcion ?? ''}\n${valor(r.leido.cantidad)} ${r.leido.unidad ?? ''} x ${r.leido.precio === null || r.leido.precio === undefined ? '-' : pesos(r.leido.precio)}` : '(no se leyó: cargado a mano o por escaneo)';
    return [String(r.linea), txt(leido),
      txt(r.destino === 'articulo' ? (a ? a.nombre : 'PRODUCTO NUEVO') + (r.factor && r.factor !== 1 ? `\n1 = ${cant(r.factor)} ${a?.unidad || 'u'}` : '') : (R.DESTINOS[r.destino] || '-').toUpperCase()),
      cant(r.cant_facturada), cant(r.cant_recibida), r.cant_escaneada === null ? '-' : cant(r.cant_escaneada), dif ? (dif > 0 ? '+' : '') + cant(dif) : '',
      txt(r.unidad || ''), R.costoUnit(r) === null ? '-' : pesos(R.costoUnit(r)), R.importe(r) === null ? '-' : pesos(R.importe(r)),
      txt([r.vence ? fechaCorta(r.vence) : '', r.lote ? 'L ' + r.lote : ''].filter(Boolean).join('\n')),
      txt({ foto: 'Foto', pdf: 'PDF', escaneo: 'Escaneo', manual: 'Manual' }[r.origen] || r.origen),
      txt([...corr.map((x) => 'Corregido ' + x), r.editado_por ? `por ${nombreDe(r.editado_por)}` : '', ...avisos, r.nota || ''].filter(Boolean).join('\n'))];
  };
  const cabecera = [['#', 'Lo que leyó el sistema', 'Artículo o destino', 'Fact.', 'Recib.', 'Escan.', 'Dif.', 'Un.', 'Costo unit.', 'Importe', 'Vence / lote', 'Origen', 'Corregido a mano y avisos aceptados']];
  const estilos = { 0: { cellWidth: 7 }, 1: { cellWidth: 48 }, 2: { cellWidth: 38 }, 3: { halign: 'right', cellWidth: 13 }, 4: { halign: 'right', cellWidth: 13 }, 5: { halign: 'right', cellWidth: 13 }, 6: { halign: 'right', cellWidth: 11 },
    7: { cellWidth: 10 }, 8: { halign: 'right', cellWidth: 21 }, 9: { halign: 'right', cellWidth: 23 }, 10: { cellWidth: 19 }, 11: { cellWidth: 14 }, 12: { cellWidth: 'auto' } };
  const tabla = (filas, y, pie) => { doc.autoTable({ head: cabecera, body: filas, foot: pie ? [pie] : undefined, startY: y, margin: { left: M, right: M }, rowPageBreak: 'avoid', showFoot: 'lastPage', styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [20, 21, 24], textColor: 255, fontSize: 9 }, footStyles: { fillColor: [235, 233, 227], textColor: 20, fontStyle: 'bold' }, columnStyles: estilos,
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 6 && d.cell.raw) d.cell.styles.textColor = [208, 59, 59]; if (d.section === 'body' && d.column.index === 12 && d.cell.raw) d.cell.styles.textColor = [30, 80, 170]; } }); return doc.lastAutoTable.finalY; };
  const local = rec.renglones.filter((r) => r.destino !== 'gisela'), gis = rec.renglones.filter((r) => r.destino === 'gisela');
  let y = tabla(local.map(fila), 30, ['', '', 'Subtotal del local', '', '', '', '', '', '', pesos(t.suma - t.gisela), '', '', '']);
  if (gis.length) {
    if (y > H - 30 - gis.length * 12) { doc.addPage(); y = 6; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(txt('Para Gisela (no suma stock ni costo del local)'), M, y + 7);
    y = tabla(gis.map(fila), y + 9, ['', '', 'Subtotal para Gisela', '', '', '', '', '', '', pesos(t.gisela), '', '', '']);
  }

  // ---- Parte 3: resumen ----
  if (y > H - 70) { doc.addPage(); y = 10; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(txt('Resumen de la operación'), M, y + 9);
  const minutos = Math.max(1, Math.round((new Date(rec.firmas.aprobado_en) - new Date(rec.creado)) / 60000));
  const generales = lista.filter((v) => v.linea === null && v.nivel === 'aviso' && rec.aceptados[v.clave]);
  const cuerpo = [
    ['Renglones sumados', pesos(t.suma), 'Neto del comprobante', c.neto === null || c.neto === undefined ? '-' : pesos(c.neto)],
    ['IVA', c.iva === null || c.iva === undefined ? '-' : pesos(c.iva), 'Percepciones y otros', pesos((c.percepciones || 0) + (c.otros || 0))],
    ['Total del comprobante', pesos(c.total), 'Diferencia renglones contra comprobante', t.diferencia === null ? '-' : pesos(t.diferencia)],
    ['Campos leídos por el sistema', String(q.leidos), 'Corregidos a mano', `${q.corregidos}${q.acierto === null ? '' : ` (acierto ${String(q.acierto).replace('.', ',')}%)`}`],
    ['Tiempo de carga', `${minutos} min`, 'Modo', [...new Set(rec.renglones.map((r) => r.origen))].join(' + ') || '-'],
    ['Recibido y controlado por', `${nombreDe(rec.firmas.recibido_por)} · ${fechaHora(rec.firmas.recibido_en)}`, 'Aprobado por', `${nombreDe(rec.firmas.aprobado_por)} · ${fechaHora(rec.firmas.aprobado_en)}`],
    ['Vencimiento del comprobante', c.vence ? fechaCorta(c.vence) : '-', 'Identificador', rec.uuid],
  ].map((f) => f.map(txt));
  doc.autoTable({ body: cuerpo, startY: y + 12, margin: { left: M, right: M }, theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.4 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 }, 1: { cellWidth: 83, halign: 'left' }, 2: { fontStyle: 'bold', cellWidth: 60 }, 3: { cellWidth: 'auto' } } });
  y = doc.lastAutoTable.finalY;
  const notas = [...generales.map((v) => `Aviso aceptado: ${v.detalle} Motivo: ${rec.aceptados[v.clave].motivo} (${nombreDe(rec.aceptados[v.clave].por)})`),
    ...(rec.manuscrito || []).map((m) => 'Anotado a mano en el comprobante: ' + m), rec.nota ? 'Nota: ' + rec.nota : ''].filter(Boolean);
  if (notas.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); const l = doc.splitTextToSize(txt(notas.join('\n')), W - 2 * M); if (y + 6 + l.length * 4 > H - 8) { doc.addPage(); y = 8; } doc.text(l, M, y + 6); y += 6 + l.length * 4; }
  if (rec.escaneos && rec.escaneos.length) {
    doc.autoTable({ head: [['Hora', 'Código leído', 'Artículo', 'Suma']], body: rec.escaneos.map((e) => [e.hora.slice(11, 19), e.codigo, txt(e.item_id ? cat.articulo(e.item_id)?.nombre || e.item_id : e.que || 'sin vincular'), cant(e.suma ?? 1)]),
      startY: y + 6, margin: { left: M, right: M }, styles: { font: 'helvetica', fontSize: 9, cellPadding: 1 }, headStyles: { fillColor: [85, 89, 95] } });
  }

  // ---- Parte 1: el original completo, en páginas propias ----
  const originales = await paginasOriginal(rec);
  for (const [i, img] of originales.entries()) {
    const a = await achicar(img, 2200, 0.8);
    const vertical = a.alto >= a.ancho;
    doc.addPage('a4', vertical ? 'portrait' : 'landscape');
    const pw = vertical ? 210 : 297, ph = vertical ? 297 : 210, f = Math.min((pw - 12) / a.ancho, (ph - 20) / a.alto);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(txt(`Original ${i + 1} de ${originales.length} · ${titulo}`), 6, 7);
    doc.addImage(await blobADataURL(a.blob), 'JPEG', (pw - a.ancho * f) / 2, 10, a.ancho * f, a.alto * f, undefined, 'FAST');
  }
  // el original va primero: se mueven sus páginas al principio
  const total = doc.getNumberOfPages(), nOrig = originales.length;
  for (let k = 0; k < nOrig; k++) doc.movePage(total - nOrig + 1 + k, 1 + k);

  // marca de agua y pie en todas las páginas
  for (let p = 1; p <= doc.getNumberOfPages(); p++) {
    doc.setPage(p);
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.13 }));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(120);
    doc.text(txt('Control interno - no válido como comprobante'), pw / 2, ph / 2, { align: 'center', angle: 28 });
    doc.restoreGraphicsState(); doc.setTextColor(110); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(txt(`SpC Depósito · Control interno, no válido como comprobante · página ${p} de ${doc.getNumberOfPages()}`), pw / 2, ph - 4, { align: 'center' });
    doc.setTextColor(0);
  }
  return doc.output('blob');
}

export function excelBistrosoft(rec, cfg) {
  const b = R.filasBistrosoft(rec, cfg);
  return escribirHoja('Stock', [b.columnas, ...b.filas], [18, 44, 11, 15, 12, 12, 22]);
}

/**
 * Genera y guarda las tres salidas. Devuelve [{tipo, archivo, id, mime, bytes}].
 * El orden importa: el JSON lleva el hash del PDF y del Excel.
 */
export async function generar(rec, cfg, lista) {
  const t = ahoraISO(), salidas = [];
  const pon = async (tipo, archivo, blob) => { const id = `${rec.uuid}/${archivo}`; await db.guardar('archivos', id, blob); salidas.push({ tipo, archivo, id, mime: blob.type, bytes: blob.size, hash: await sha1(blob), generado: t }); };
  let n = 0;
  for (const a of rec.adjuntos) { n++; const blob = await db.leer('archivos', a.id); if (blob) salidas.push({ tipo: 'original', archivo: a.tipo === 'application/pdf' ? (n === 1 ? 'original.pdf' : `original_${n}.pdf`) : `original_${n}.jpg`, id: a.id, mime: a.tipo, bytes: blob.size, hash: await sha1(blob), generado: t }); }
  const pdf = await pdfControl(rec, lista);
  await pon('pdf', 'control.pdf', new Blob([pdf], { type: 'application/pdf' }));
  const b = R.filasBistrosoft(rec, cfg);
  if (b.filas.length) await pon('bistrosoft', 'bistrosoft.xlsx', excelBistrosoft(rec, cfg));
  rec.salidas = [...salidas, { tipo: 'gestion', archivo: `recepcion_${rec.uuid}.json`, id: `${rec.uuid}/recepcion.json`, mime: 'application/json', generado: t }];
  const json = JSON.stringify(R.aRecepcionV1(rec, cfg, lista), null, 1);
  const bj = new Blob([json], { type: 'application/json' });
  await db.guardar('archivos', `${rec.uuid}/recepcion.json`, bj);
  rec.salidas[rec.salidas.length - 1].bytes = bj.size;
  return rec.salidas;
}

/** El nombre con que cada archivo sale del teléfono. */
export function nombreDeSalida(rec, s) {
  if (s.tipo === 'pdf') return R.nombreControl(rec);
  if (s.tipo === 'bistrosoft') return `${rec.comp.fecha}_${rec.proveedor.replace(/[^\w]+/g, '-')}_${rec.comp.tipo}-${R.numeroLargo(rec.comp)}_bistrosoft.xlsx`;
  if (s.tipo === 'gestion') return s.archivo;
  return `${rec.comp.fecha}_${rec.proveedor.replace(/[^\w]+/g, '-')}_${s.archivo}`;
}
export async function archivoDe(rec, s) {
  const blob = await db.leer('archivos', s.id);
  return blob ? new File([blob], nombreDeSalida(rec, s), { type: s.mime || blob.type }) : null;
}
export function textoMensaje(rec, lista) {
  const q = R.calidad(rec), av = lista.filter((v) => v.nivel === 'aviso' && rec.aceptados[v.clave]).length;
  return `Recepción ${rec.proveedor} · ${R.TIPOS[rec.comp.tipo]} ${R.numeroLargo(rec.comp)} · ${pesos(rec.comp.total)}\n${rec.renglones.length} renglones, ${q.corregidos} campos corregidos, ${av} avisos aceptados.\nRecibió ${nombreDe(rec.firmas.recibido_por)}, aprobó ${nombreDe(rec.firmas.aprobado_por)}.`;
}
/** Abre "compartir" del teléfono con los archivos (WhatsApp, Gmail, Drive…). Devuelve false si el teléfono no puede. */
export async function compartir(archivos, texto) {
  const datos = { files: archivos, text: texto, title: 'Recepción SpC' };
  if (!navigator.canShare || !navigator.canShare({ files: archivos })) return false;
  try { await navigator.share(datos); return true; } catch (e) { if (e.name === 'AbortError') return null; return false; }
}
export function descargar(archivo) {
  const u = URL.createObjectURL(archivo), a = document.createElement('a');
  a.href = u; a.download = archivo.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
}
