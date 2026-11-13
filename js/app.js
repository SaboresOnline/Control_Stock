// SpC Depósito · MVP de recepción de mercadería. Pantallas y flujo. La lógica vive en recepcion.js, catalogo.js,
// leer.js y salidas.js; acá sólo se muestra, se captura y se guarda.
import * as db from './db.js';
import * as cat from './catalogo.js';
import * as ses from './sesion.js';
import * as R from './recepcion.js';
import * as L from './leer.js';
import * as S from './salidas.js';
import * as esc_ from './escaner.js';
import { esc, num, r2, r3, pesos, cant, campo, ahoraISO, hoy, fechaCorta, fechaHora, uuid, achicar, dias } from './util.js';

export const VERSION = '0.1.0';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app'), capas = $('#capas');
let cfg = { dispositivo: 'celular-local', bloqueo_min: 10, sucursal: '', api_clave: '', modelo: '', tope_usd: 5, precio_entrada: 1, precio_salida: 5 };
let rec = null;          // la recepción abierta
let lista = [];          // su validación
let ctx = {};            // lo que está abierto en una capa (renglón, búsqueda…)
const urls = new Map();  // miniaturas

// ---------- piezas comunes ----------
function aviso(texto, clase = '') {
  const t = document.createElement('div'); t.className = 'tostada ' + clase; t.textContent = texto; $('#tostadas').appendChild(t);
  setTimeout(() => t.remove(), clase === 'mal' ? 7000 : 3500);
}
function capa(html, clase = '') {
  const d = document.createElement('div'); d.className = 'capa ' + clase; d.innerHTML = `<div class="hoja">${html}</div>`;
  capas.appendChild(d); document.body.classList.add('con-capa');
  return d;
}
function cerrarCapa(d) { const c = d || capas.lastElementChild; if (c) c.remove(); if (!capas.children.length) document.body.classList.remove('con-capa'); }
function confirmar(texto, si = 'Sí', no = 'No') {
  return new Promise((ok) => {
    const d = capa(`<p class="pregunta">${esc(texto)}</p><div class="fila-botones"><button class="boton" data-r="0">${esc(no)}</button><button class="boton fuerte" data-r="1">${esc(si)}</button></div>`, 'chica');
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { cerrarCapa(d); ok(b.dataset.r === '1'); } });
  });
}
function pedir(texto, { valor = '', tipo = 'text', modo = 'text', ayuda = '' } = {}) {
  return new Promise((ok) => {
    const d = capa(`<p class="pregunta">${esc(texto)}</p>${ayuda ? `<p class="suave">${esc(ayuda)}</p>` : ''}<input class="entrada grande" id="pedido" type="${tipo}" inputmode="${modo}" value="${esc(valor)}" autocomplete="off">
      <div class="fila-botones"><button class="boton" data-r="0">Cancelar</button><button class="boton fuerte" data-r="1">Aceptar</button></div>`, 'chica');
    const i = $('#pedido', d); setTimeout(() => i.focus(), 50);
    const fin = (v) => { cerrarCapa(d); ok(v); };
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(i.value); });
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) fin(b.dataset.r === '1' ? i.value : null); });
  });
}
const ocupado = (texto) => capa(`<div class="ocupado"><div class="rueda"></div><p>${esc(texto)}</p></div>`, 'chica fija');
async function guardarRec() { rec.actualizado = ahoraISO(); await db.guardar('recepciones', rec.uuid, rec); }
async function guardarCfg() { const { _modeloElegido, ...c } = cfg; await db.guardar('kv', 'config', c); ses.cambiarMinutos(cfg.bloqueo_min); }
const otras = async () => (await db.todos('recepciones')).filter((o) => o.uuid !== rec.uuid);
async function revalidar() { lista = R.validar(rec, await otras()); return lista; }
const yo = () => ses.actual();
const nombreItem = (id) => cat.articulo(id)?.nombre || id;
const estadoTxt = { borrador: 'En curso', controlada: 'Lista para aprobar', aprobada: 'Aprobada' };

// ---------- rutas ----------
function ir(ruta) { if (location.hash === '#' + ruta) pintar(); else location.hash = ruta; }
addEventListener('hashchange', pintar);
async function pintar() {
  while (capas.firstChild) cerrarCapa();
  esc_.cerrar();
  if (!cat.actual()) return pantallaSinCatalogo();
  if (!yo()) return pantallaEntrar();
  const [, que, id] = location.hash.split('/');
  if (que === 'config') return pantallaConfig();
  if (que === 'r' || que === 'p' || que === 'a') {
    rec = await db.leer('recepciones', id);
    if (!rec) { aviso('Esa recepción no está en este celular.', 'mal'); return ir('/'); }
    await revalidar();
    if (rec.estado === 'aprobada') return pantallaAprobada();
    return que === 'p' ? pantallaPrevia() : pantallaRecepcion();
  }
  rec = null;
  return pantallaInicio();
}

// ---------- entrar ----------
function pantallaSinCatalogo() {
  app.innerHTML = `<div class="centro"><img src="iconos/logo.png" class="logo" alt=""><h1>SpC Depósito</h1>
    <p>Para empezar hace falta el catálogo de Sabores_Gestion.</p>
    <p class="suave">En la PC: Sistema › Importaciones › <b>Exportar para la app</b>. Pasá <code>catalogo_app.json</code> al teléfono (Drive, mail o cable) y elegilo acá.</p>
    <label class="boton fuerte ancho">Elegir catalogo_app.json<input type="file" accept=".json,application/json" data-in="catalogo" hidden></label>
    ${globalThis.SPC_DEMO ? '<button class="boton ancho" data-acc="demo">Probar con datos de ejemplo</button>' : ''}
    <p class="suave pie">Versión ${VERSION}. Los datos quedan sólo en este teléfono.</p></div>`;
}
function pantallaEntrar() {
  const us = cat.usuarios();
  app.innerHTML = `<div class="centro"><img src="iconos/logo.png" class="logo" alt=""><h1>SpC Depósito</h1>
    ${us.length ? `<p>¿Quién sos?</p><div class="usuarios">${us.map((u) => `<button class="boton usuario" data-acc="elegir-usuario" data-id="${esc(u.usuario_id)}"><b>${esc(u.nombre)}</b><span>${esc(u.rol)}</span></button>`).join('')}</div>`
      : `<p class="caja mal">El catálogo no trae usuarios. Dalos de alta en Sabores_Gestion (Sistema › Usuarios), exportá de nuevo y cargá el catálogo.</p>`}
    <label class="boton ancho">Cargar otro catálogo<input type="file" accept=".json,application/json" data-in="catalogo" hidden></label>
    <p class="suave pie">Cada persona entra con su usuario: lo que se recibe y aprueba queda firmado.</p></div>`;
}
async function elegirUsuario(id) {
  const u = cat.usuarios().find((x) => x.usuario_id === id);
  if (!(await ses.tienePin(id))) {
    const p1 = await pedir(`${u.nombre}: elegí tu PIN`, { tipo: 'password', modo: 'numeric', ayuda: 'De 4 a 6 números. Es sólo tuyo: no lo compartas. Es la primera vez que entrás en este celular.' });
    if (p1 === null) return;
    const p2 = await pedir('Repetí el PIN', { tipo: 'password', modo: 'numeric' });
    if (p2 === null) return;
    if (p1 !== p2) return aviso('Los dos PIN no coinciden.', 'mal');
    try { await ses.crearPin(id, p1); await ses.entrar(id, p1); } catch (e) { return aviso(e.message, 'mal'); }
  } else {
    const p = await pedir(`PIN de ${u.nombre}`, { tipo: 'password', modo: 'numeric' });
    if (p === null) return;
    try { await ses.entrar(id, p); } catch (e) { return aviso(e.message, 'mal'); }
  }
  ir('/');
}

// ---------- inicio ----------
const cabecera = (titulo, atras = null, extra = '') => `<header class="barra">${atras !== null ? `<button class="icono" data-acc="ir" data-a="${atras}" aria-label="Volver">‹</button>` : '<img src="iconos/logo.png" class="logo-chico" alt="">'}
  <h1>${esc(titulo)}</h1>${extra}<button class="chip usuario-chip" data-acc="cambiar-usuario" title="Cambiar de usuario">${esc(yo().nombre.split(' ')[0])} ⇄</button></header>`;
const tituloRec = (r) => `${r.proveedor || 'Sin proveedor'} · ${r.comp.tipo}${r.comp.numero ? ' ' + R.numeroLargo(r.comp) : ''}`;
async function pantallaInicio() {
  const c = cat.actual(), todas = (await db.todos('recepciones')).sort((a, b) => b.actualizado.localeCompare(a.actualizado));
  const curso = todas.filter((r) => r.estado !== 'aprobada'), hechas = todas.filter((r) => r.estado === 'aprobada').slice(0, 40);
  const viejo = dias((c.importado || c.generado || hoy()).slice(0, 10), hoy()) > 7;
  const tarjeta = (r) => `<button class="tarjeta" data-acc="ir" data-a="/${r.estado === 'aprobada' ? 'a' : 'r'}/${r.uuid}"><div><b>${esc(tituloRec(r))}</b>
    <span class="suave">${fechaCorta(r.comp.fecha)} · ${r.renglones.length} renglones · recibió ${esc(ses.nombreDe(r.firmas.recibido_por))}${r.estado === 'aprobada' && ses.veCostos() ? ' · ' + pesos(r.comp.total) : ''}</span></div>
    <span class="chip ${r.estado === 'aprobada' ? (r.enviado_gestion ? 'bien' : 'alerta') : r.estado === 'controlada' ? 'alerta' : ''}">${r.estado === 'aprobada' ? (r.enviado_gestion ? 'Enviada' : 'Falta enviar') : estadoTxt[r.estado]}</span></button>`;
  app.innerHTML = `${cabecera('SpC Depósito', null, '<button class="icono" data-acc="ir" data-a="/config" aria-label="Configuración">⚙</button>')}
    <main><button class="boton fuerte ancho gigante" data-acc="nueva">+ Nueva recepción</button>
    <p class="caja ${viejo ? 'alerta' : ''}">Catálogo del ${fechaHora(c.generado)} · ${c.articulos.length} artículos · ${c.proveedores.length} proveedores${viejo ? '. Tiene más de 7 días: conviene exportarlo de nuevo en Gestión.' : ''}</p>
    <h2>En curso</h2>${curso.length ? curso.map(tarjeta).join('') : '<p class="suave">No hay recepciones en curso.</p>'}
    <h2>Aprobadas</h2>${hechas.length ? hechas.map(tarjeta).join('') : '<p class="suave">Todavía no se aprobó ninguna.</p>'}</main>`;
}

// ---------- la recepción ----------
function miniatura(a) { return urls.get(a.id) || ''; }
async function cargarMiniaturas() {
  for (const a of rec.adjuntos) if (!urls.has(a.id) && a.tipo !== 'application/pdf') { const b = await db.leer('archivos', a.id); if (b) urls.set(a.id, URL.createObjectURL(b)); }
}
function renglonHTML(r) {
  const a = r.item_id ? cat.articulo(r.item_id) : null;
  const vs = lista.filter((v) => v.linea === r.linea);
  const bloq = vs.some((v) => v.nivel === 'bloqueo' && (ses.veCostos() || v.ambito === 'fisico')), av = vs.some((v) => v.nivel === 'aviso' && !rec.aceptados[v.clave] && (ses.veCostos() || v.ambito === 'fisico'));
  const destino = r.nose ? '<span class="chip mal">No sé</span>' : r.destino === 'articulo' ? (a ? esc(a.nombre) : r.nuevo ? '<span class="chip alerta">Producto nuevo</span>' : '<span class="chip mal">Sin artículo</span>')
    : r.destino ? `<span class="chip ${r.destino === 'gisela' ? 'gisela' : ''}">${R.DESTINOS[r.destino]}</span>` : '<span class="chip mal">Sin asociar</span>';
  return `<button class="renglon ${bloq ? 'rojo' : av ? 'amarillo' : 'verde'}" data-acc="renglon" data-l="${r.linea}">
    <div class="r1"><b>${destino}</b>${r.editado_por ? '<i class="punto azul" title="Corregido a mano"></i>' : ''}</div>
    ${r.descripcion || r.codigo_prov ? `<div class="suave">${r.codigo_prov ? '[' + esc(r.codigo_prov) + '] ' : ''}${esc(r.descripcion || '')}</div>` : ''}
    <div class="r3"><span>Fact. <b>${cant(r.cant_facturada)}</b></span><span>Recib. <b>${cant(r.cant_recibida)}</b></span>${r.cant_escaneada !== null ? `<span>Escan. <b>${cant(r.cant_escaneada)}</b></span>` : ''}
      ${r.unidad ? `<span>${esc(r.unidad)}</span>` : ''}${ses.veCostos() ? `<span class="der">${R.importe(r) === null ? 'sin precio' : pesos(R.importe(r))}</span>` : ''}</div>
    ${r.vence ? `<div class="suave">Vence ${fechaCorta(r.vence)}${r.lote ? ' · lote ' + esc(r.lote) : ''}</div>` : ''}</button>`;
}
async function pantallaRecepcion() {
  await cargarMiniaturas();
  const c = rec.comp, t = R.totales(rec), plata = ses.veCostos();
  const p = R.pendientes(rec, lista, !plata);
  const leidoProv = rec.proveedor_leido && !rec.proveedor ? `<p class="caja alerta">El comprobante dice: <b>${esc(rec.proveedor_leido.nombre || '')}</b>${rec.proveedor_leido.cuit ? ' · CUIT ' + esc(rec.proveedor_leido.cuit) : ''}. No está en el catálogo con ese CUIT: elegilo de la lista.</p>` : '';
  const dinero = (k, n) => `<label>${n}<input class="entrada der" inputmode="decimal" data-in="comp" data-k="${k}" value="${campo(c[k])}"></label>`;
  app.innerHTML = `${cabecera('Recepción', '/')}
  <main class="con-pie">
    <section class="bloque"><h2>Comprobante</h2>
      <div class="adjuntos">${rec.adjuntos.map((a, i) => `<button class="adj" data-acc="ver-adjunto" data-i="${i}">${a.tipo === 'application/pdf' ? '<span class="pdf">PDF</span>' : `<img src="${miniatura(a)}" alt="">`}</button>`).join('')}
        <label class="adj mas">📷<small>Foto</small><input type="file" accept="image/*" capture="environment" data-in="adjuntar" hidden></label>
        <label class="adj mas">＋<small>Foto o PDF</small><input type="file" accept="image/*,application/pdf" multiple data-in="adjuntar" hidden></label></div>
      ${rec.adjuntos.length ? `<button class="boton ancho" data-acc="leer">Leer el comprobante${rec.renglones.some((r) => r.leido) ? ' otra vez' : ''}</button>` : '<p class="suave">Sacale una foto al remito o a la factura, o elegí el PDF. También podés cargar todo a mano.</p>'}
      ${(rec.manuscrito || []).length ? `<p class="caja alerta"><b>Anotado a mano:</b> ${rec.manuscrito.map(esc).join(' · ')}</p>` : ''}
      ${leidoProv}
      <button class="selector ${rec.proveedor ? '' : 'falta'}" data-acc="elegir-proveedor"><small>Proveedor</small><b>${esc(rec.proveedor || 'Elegir proveedor')}</b></button>
      <div class="grilla">
        <label>Tipo<select class="entrada" data-in="comp" data-k="tipo">${Object.entries(R.TIPOS).map(([k, v]) => `<option value="${k}" ${c.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Fecha<input class="entrada" type="date" data-in="comp" data-k="fecha" value="${esc(c.fecha || '')}"></label>
        <label>Punto de venta<input class="entrada" inputmode="numeric" data-in="comp" data-k="punto_venta" value="${esc(c.punto_venta || '')}" placeholder="0003"></label>
        <label>Número<input class="entrada" inputmode="numeric" data-in="comp" data-k="numero" value="${esc(c.numero || '')}"></label>
        ${plata ? `<label>Vence el pago<input class="entrada" type="date" data-in="comp" data-k="vence" value="${esc(c.vence || '')}"></label>
        ${dinero('neto', 'Neto (sin impuestos)')}${dinero('iva', 'IVA')}${dinero('percepciones', 'Percepciones')}${dinero('otros', 'Otros')}${dinero('total', 'Total')}` : ''}
      </div>
      ${plata && c.tipo !== 'RTO' && c.tipo !== 'NC' ? `<label class="reemplaza">Reemplaza al remito N° (si ya se cargó)<input class="entrada" inputmode="numeric" data-in="reemplaza" value="${esc(c.reemplaza?.numero || '')}" placeholder="Sólo si esta factura llega después de su remito"></label>` : ''}
      <label>Nota<input class="entrada" data-in="nota" value="${esc(rec.nota || '')}" placeholder="Opcional"></label>
    </section>
    <section class="bloque"><h2>Renglones <small>${rec.renglones.length}</small></h2>
      ${rec.renglones.map(renglonHTML).join('') || '<p class="suave">Todavía no hay renglones. Leé el comprobante, escaneá los productos o agregalos a mano.</p>'}
      ${plata && rec.renglones.length ? `<div class="totales"><span>Suman los renglones</span><b>${pesos(t.suma)}</b>
        ${t.esperado !== null ? `<span>${c.neto !== null && c.neto !== undefined ? 'Neto del comprobante' : 'Total sin impuestos'}</span><b>${pesos(t.esperado)}</b><span>Diferencia</span><b class="${Math.abs(t.diferencia) > R.TOLERANCIA ? 'mal' : 'bien'}">${pesos(t.diferencia)}</b>` : ''}
        ${t.gisela ? `<span>De eso, para Gisela</span><b>${pesos(t.gisela)}</b>` : ''}</div>
        ${c.total === null || c.total === undefined ? `<button class="boton ancho" data-acc="usar-suma">Usar ${pesos(t.suma)} como total (sin IVA aparte)</button>` : ''}` : ''}
    </section>
    ${rec.estado === 'borrador' || yo().usuario_id === rec.firmas.recibido_por ? '<button class="boton peligro ancho" data-acc="borrar-rec">Descartar esta recepción</button>' : ''}
  </main>
  <footer class="pie-acciones"><button class="boton" data-acc="escanear">▦ Escanear</button><button class="boton" data-acc="renglon-nuevo">＋ Renglón</button>
    <button class="boton fuerte" data-acc="ir" data-a="/p/${rec.uuid}">Revisar${p.bloqueos.length ? ` · ${p.bloqueos.length} ✕` : p.avisos.length ? ` · ${p.avisos.length} !` : ' ✓'}</button></footer>`;
}

// ---------- adjuntar y leer ----------
async function adjuntar(archivos) {
  const o = ocupado('Guardando…');
  try {
    for (const f of archivos) {
      const id = `${rec.uuid}/adj_${uuid().slice(0, 8)}`;
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        await db.guardar('archivos', id, new Blob([await f.arrayBuffer()], { type: 'application/pdf' }));
        rec.adjuntos.push({ id, tipo: 'application/pdf', nombre: f.name });
        try { const p = await L.leerPDF(f, { imagenes: true }); for (const x of p.paginas) { const q = x.imagen && await L.qrEnImagen(x.imagen); if (q) { aplicarQR(q); break; } } } catch { }
      } else {
        const a = await achicar(f, 2400, 0.86);
        await db.guardar('archivos', id, a.blob);
        rec.adjuntos.push({ id, tipo: 'image/jpeg', nombre: f.name });
        const q = await L.qrEnImagen(a.blob); if (q) aplicarQR(q);
      }
    }
    await guardarRec();
  } catch (e) { aviso('No se pudo guardar el archivo: ' + e.message, 'mal'); }
  cerrarCapa(o); pintar();
}
function ponerProveedorLeido(p) {
  if (!p || (!p.cuit && !p.nombre)) return;
  rec.proveedor_leido = p;
  const x = cat.reconocerProveedor(p);
  if (x && x.seguro && !rec.proveedor) { rec.proveedor = x.proveedor; rec.proveedor_leido = null; }
  else if (x && !rec.proveedor) rec.proveedor_sugerido = x.proveedor;
}
function aplicarQR(q) {
  const c = rec.comp;
  if (q.tipo) c.tipo = q.tipo;
  c.punto_venta = q.punto_venta || c.punto_venta; c.numero = q.numero || c.numero; if (q.fecha) c.fecha = q.fecha; if (q.total !== null) c.total = q.total;
  ponerProveedorLeido({ cuit: q.cuit, nombre: null });
  rec.lectura.pasos.push({ paso: 'qr_arca', cuando: ahoraISO() });
  aviso('Se leyó el QR de ARCA: tipo, número, fecha y total.', 'bien');
}
async function leerComprobante() {
  if (rec.renglones.some((r) => r.leido) && !(await confirmar('Ya hay renglones leídos. ¿Los reemplazo por una lectura nueva? Lo cargado a mano o por escaneo se mantiene.', 'Reemplazar', 'Cancelar'))) return;
  const o = ocupado('Leyendo el comprobante…');
  try {
    // cascada: texto del PDF si lo trae; si no, las imágenes
    let texto = '', imagenes = [];
    for (const a of rec.adjuntos) {
      const b = await db.leer('archivos', a.id); if (!b) continue;
      if (a.tipo === 'application/pdf') { const p = await L.leerPDF(b, { imagenes: true }); if (p.conTexto) texto += p.texto + '\n\n'; else imagenes.push(...p.paginas.map((x) => x.imagen).filter(Boolean)); }
      else imagenes.push(b);
    }
    const entrada = texto.trim() && !imagenes.length ? { texto } : { imagenes: imagenes.length ? imagenes : null, texto };
    if (!entrada.imagenes && !entrada.texto) throw new Error('No hay nada para leer.');
    const r = await L.leerConClaude(entrada.imagenes ? { imagenes: entrada.imagenes } : { texto: entrada.texto }, cfg);
    if (cfg._modeloElegido) await guardarCfg();
    const d = L.interpretar(r.datos);
    rec.lectura.pasos.push({ paso: entrada.imagenes ? 'ia_imagen' : 'ia_texto', modelo: r.modelo, cuando: ahoraISO(), entrada: r.uso?.input_tokens, salida: r.uso?.output_tokens });
    const c = rec.comp, qr = rec.lectura.pasos.some((x) => x.paso === 'qr_arca');
    for (const k of ['tipo', 'punto_venta', 'numero', 'fecha', 'total']) if (d.comp[k] !== null && !(qr && c[k])) c[k] = d.comp[k];   // lo del QR de ARCA manda
    for (const k of ['vence', 'neto', 'iva', 'percepciones', 'otros']) if (d.comp[k] !== null) c[k] = d.comp[k];
    rec.comp_leido = { ...d.comp };
    if (!rec.proveedor) ponerProveedorLeido(d.proveedor);
    rec.manuscrito = d.manuscrito;
    rec.renglones = rec.renglones.filter((x) => !x.leido);
    for (const x of d.renglones) {
      const r0 = R.renglonNuevo(rec, { codigo_prov: x.codigo_prov, descripcion: x.descripcion, cant_facturada: x.cantidad, cant_recibida: x.cantidad, unidad: x.unidad, precio: x.precio, bonif: x.bonif || 0, alicuota: x.alicuota,
        origen: entrada.imagenes ? 'foto' : 'pdf', confianza: x.confianza, revisado: false,
        leido: { codigo_prov: x.codigo_prov, descripcion: x.descripcion, cantidad: x.cantidad, unidad: x.unidad, precio: x.precio, bonif: x.bonif || 0, alicuota: x.alicuota, importe: x.importe_leido } });
      // si cantidad × precio no da el importe que figura, la lectura es dudosa
      const calc = R.importe(r0); if (x.importe_leido !== null && calc !== null && Math.abs(calc - x.importe_leido) > Math.max(1, Math.abs(x.importe_leido) * 0.005)) r0.confianza = Math.min(r0.confianza, 0.5);
      R.asociarSolo(rec, r0);
      completarDesdeArticulo(r0);
    }
    rec.renglones.forEach((x, i) => { x.linea = i + 1; });
    await guardarRec();
    aviso(`Se leyeron ${d.renglones.length} renglones${d.cortado ? ' (el comprobante es largo y puede faltar el final: revisalo)' : ''}.${r.uso ? ` Gasto del mes: US$ ${r.gasto.usd.toFixed(3)}.` : ''}`, d.cortado ? 'mal' : 'bien');
  } catch (e) { aviso(e.message, 'mal'); }
  cerrarCapa(o); pintar();
}
/** Completa unidad y, si el renglón no trae precio, el último costo conocido (queda a la vista para corregir). */
function completarDesdeArticulo(r) {
  const a = r.destino === 'articulo' && r.item_id ? cat.articulo(r.item_id) : null; if (!a) return;
  if (!r.unidad) r.unidad = a.unidad;
  if (r.precio === null) { const u = cat.ultimoCosto(a.item_id, rec.proveedor); if (u) { r.precio = r2(u.costo * (r.factor || 1)); r.precio_sugerido = true; } }
  if (r.alicuota === null && a.iva !== null && a.iva !== undefined) r.alicuota = a.iva;
}

// ---------- proveedor ----------
function elegirProveedor() {
  ctx = { que: 'proveedor' };
  capa(`<div class="capa-cab"><h2>Proveedor</h2><button class="icono" data-acc="cerrar">✕</button></div>
    <input class="entrada grande" id="busca-prov" placeholder="Buscar por nombre, razón social o CUIT" data-in="busca-prov" autocomplete="off">
    <div id="lista-prov" class="lista"></div>`, 'alta');
  listarProveedores('');
}
function listarProveedores(t) {
  const q = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const sug = rec.proveedor_sugerido;
  const ps = cat.proveedores().filter((p) => !q || [p.proveedor, p.razon_social, p.cuit, ...(p.alias || []).map((a) => a.valor)].filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))
    .sort((a, b) => (b.proveedor === sug) - (a.proveedor === sug));
  $('#lista-prov').innerHTML = ps.map((p) => `<button class="item" data-acc="poner-proveedor" data-p="${esc(p.proveedor)}"><b>${esc(p.proveedor)}</b>${p.proveedor === sug ? ' <span class="chip alerta">parecido a lo leído</span>' : ''}
    <span class="suave">${esc([p.razon_social, p.cuit ? 'CUIT ' + p.cuit : null].filter(Boolean).join(' · '))}</span></button>`).join('')
    || '<p class="suave">No hay ninguno con ese nombre. Un proveedor nuevo se da de alta en Sabores_Gestion (Compras › Proveedores) y llega con el próximo catálogo.</p>';
}

// ---------- renglón ----------
function abrirRenglon(linea) {
  const r = rec.renglones.find((x) => x.linea === linea); if (!r) return;
  ctx = { que: 'renglon', r, antes: JSON.stringify(r) };
  pintarRenglon();
}
function pintarRenglon() {
  const r = ctx.r, a = r.item_id ? cat.articulo(r.item_id) : null, plata = ses.veCostos();
  const u = a ? cat.ultimoCosto(a.item_id, rec.proveedor) : null;
  const vs = lista.filter((v) => v.linea === r.linea && (plata || v.ambito === 'fisico'));
  const html = `<div class="capa-cab"><h2>Renglón ${r.linea}</h2><button class="icono" data-acc="cerrar-renglon">✕</button></div>
    ${vs.map((v) => `<p class="caja ${v.nivel === 'bloqueo' ? 'mal' : v.nivel === 'aviso' ? 'alerta' : ''}">${esc(v.detalle)}</p>`).join('')}
    <button class="selector ${r.destino && !r.nose && (r.destino !== 'articulo' || a || r.nuevo) ? '' : 'falta'}" data-acc="asociar"><small>Va a</small><b>${r.nose ? 'No sé (lo resuelve un dueño)' : r.destino === 'articulo' ? (a ? esc(a.nombre) : r.nuevo ? 'Producto nuevo' : 'Elegir artículo') : r.destino ? R.DESTINOS[r.destino] : 'Asociar a un artículo o destino'}</b>
      ${a ? `<span class="suave">${esc([a.categoria, a.unidad, a.codigo_bistrosoft ? 'Bistrosoft ' + a.codigo_bistrosoft : 'sin código de Bistrosoft'].filter(Boolean).join(' · '))}${r.regla_tipo && !r.editado_asoc ? ' · por ' + (r.regla_tipo === 'barras' ? 'código de barras' : 'regla guardada') : ''}</span>` : ''}</button>
    <div class="grilla">
      <label class="doble">Lo que dice el proveedor<input class="entrada" data-in="r" data-k="descripcion" value="${esc(r.descripcion || '')}"></label>
      <label>Código del proveedor<input class="entrada" data-in="r" data-k="codigo_prov" value="${esc(r.codigo_prov || '')}"></label>
      <label>Unidad<input class="entrada" data-in="r" data-k="unidad" value="${esc(r.unidad || '')}" placeholder="${esc(a?.unidad || 'U, Kg, caja…')}"></label>
      <label>Facturado<input class="entrada der grande" inputmode="decimal" data-in="r" data-k="cant_facturada" value="${campo(r.cant_facturada)}"></label>
      <label>Recibido<input class="entrada der grande" inputmode="decimal" data-in="r" data-k="cant_recibida" value="${campo(r.cant_recibida)}"></label>
      <label class="doble">1 ${esc(r.unidad || 'unidad del proveedor')} son… ${esc(a?.unidad || 'unidades')} de stock<input class="entrada der" inputmode="decimal" data-in="r" data-k="factor" value="${campo(r.factor)}"></label>
      ${plata ? `<label>Precio unitario<input class="entrada der grande" inputmode="decimal" data-in="r" data-k="precio" value="${campo(r.precio)}"></label>
      <label>Bonif. %<input class="entrada der" inputmode="decimal" data-in="r" data-k="bonif" value="${campo(r.bonif || 0)}"></label>
      <label>IVA %<input class="entrada der" inputmode="decimal" data-in="r" data-k="alicuota" value="${campo(r.alicuota)}"></label>
      <div class="calculo"><small>Importe</small><b id="r-importe">${R.importe(r) === null ? '—' : pesos(R.importe(r))}</b></div>` : ''}
      <label>Vence<input class="entrada" type="date" data-in="r" data-k="vence" value="${esc(r.vence || '')}"></label>
      <label>Lote<input class="entrada" data-in="r" data-k="lote" value="${esc(r.lote || '')}"></label>
      <label class="doble">Nota del renglón<input class="entrada" data-in="r" data-k="nota" value="${esc(r.nota || '')}" placeholder="Por ejemplo: llegó golpeado, muestra del proveedor"></label>
    </div>
    ${plata && u ? `<p class="suave" id="r-costo">Costo por ${esc(a.unidad)}: <b>${R.costoStock(r) === null ? '—' : pesos(R.costoStock(r))}</b> · anterior ${pesos(u.costo)} (${u.de ? 'último de ' + esc(u.de) : 'maestro'}${u.fecha ? ', ' + fechaCorta(u.fecha) : ''})${r.precio_sugerido ? ' · <b>el precio se completó con el último costo: revisalo</b>' : ''}</p>` : ''}
    ${r.leido ? `<p class="suave">Leído: ${esc(r.leido.descripcion || '')} · ${cant(r.leido.cantidad)} ${esc(r.leido.unidad || '')}${plata ? ' × ' + (r.leido.precio === null ? '—' : pesos(r.leido.precio)) : ''}${r.confianza !== null ? ` · confianza ${Math.round(r.confianza * 100)}%` : ''}</p>` : ''}
    ${r.cant_escaneada !== null ? `<p class="suave">Escaneado: ${cant(r.cant_escaneada)} ${esc(a?.unidad || '')}</p>` : ''}
    <div class="fila-botones"><button class="boton peligro" data-acc="borrar-renglon">Borrar</button><button class="boton" data-acc="partir-renglon">Partir</button><button class="boton fuerte" data-acc="guardar-renglon">Listo</button></div>`;
  const vieja = capas.querySelector('.capa.renglon');
  if (vieja) $('.hoja', vieja).innerHTML = html; else capa(html, 'alta renglon');
}
function cambioRenglon(k, v) {
  const r = ctx.r;
  if (['cant_facturada', 'cant_recibida', 'precio', 'bonif', 'alicuota', 'factor'].includes(k)) {
    let n = num(v);
    if (k === 'factor' && !(n > 0)) n = 1;
    if (k === 'bonif' && n === null) n = 0;
    r[k] = n;
    if (k === 'cant_facturada' && (r.cant_recibida === null || r.recibido_auto !== false) && r.cant_escaneada === null) { r.cant_recibida = n; const i = capas.querySelector('[data-k="cant_recibida"]'); if (i) i.value = campo(n); }
    if (k === 'cant_recibida') { r.recibido_auto = false; r.fact_auto = false; }
    if (k === 'cant_facturada') r.fact_auto = false;
    if (k === 'precio') r.precio_sugerido = false;
    if (k === 'factor' && r.cant_escaneada !== null) { r.cant_recibida = r3(r.cant_escaneada / r.factor); if (r.fact_auto) r.cant_facturada = r.cant_recibida; }
  } else r[k] = String(v).trim() || null;
  const i = $('#r-importe'); if (i) i.textContent = R.importe(r) === null ? '—' : pesos(R.importe(r));
}
async function guardarRenglon(cerrar = true) {
  const r = ctx.r;
  const antes = JSON.parse(ctx.antes);
  r.revisado = true;
  const cambio = ['descripcion', 'codigo_prov', 'cant_facturada', 'unidad', 'precio', 'bonif', 'alicuota', 'destino', 'item_id', 'factor'].some((k) => (antes[k] ?? null) !== (r[k] ?? null));
  if (cambio && (r.leido || r.regla_tipo)) { r.editado_por = yo().usuario_id; r.editado_en = ahoraISO(); }
  await guardarRec(); await revalidar();
  if (cerrar) { cerrarCapa(capas.querySelector('.capa.renglon')); pantallaRecepcionOPrevia(); }
}
const pantallaRecepcionOPrevia = () => (location.hash.startsWith('#/p/') ? pantallaPrevia() : pantallaRecepcion());

// ---------- asociar ----------
function abrirAsociar() {
  const r = ctx.r;
  ctx.asoc = { guardar: true, tipo: 'siempre', teniaRegla: !!r.regla_tipo && r.regla_tipo !== 'barras' };
  const sug = cat.sugerir(rec.proveedor, r.codigo_prov, r.descripcion);
  const regla = cat.buscarRegla(rec.proveedor, r.codigo_prov, r.descripcion);
  capa(`<div class="capa-cab"><h2>Asociar renglón</h2><button class="icono" data-acc="cerrar">✕</button></div>
    <p class="caja"><small>El proveedor dice</small><br><b>${r.codigo_prov ? '[' + esc(r.codigo_prov) + '] ' : ''}${esc(r.descripcion || '(sin descripción)')}</b>${r.unidad ? ' · ' + esc(r.unidad) : ''}${ses.veCostos() && r.precio !== null ? ' · ' + pesos(r.precio) : ''}</p>
    ${regla && regla.tipo_regla === 'preguntar' ? `<p class="caja alerta">Hay una regla "preguntar cada vez": la última vez fue a <b>${regla.destino === 'articulo' ? esc(nombreItem(regla.item_id)) : R.DESTINOS[regla.destino]}</b>.</p>` : ''}
    <input class="entrada grande" id="busca-art" placeholder="Buscar en el catálogo: nombre, código, marca…" data-in="busca-art" autocomplete="off">
    <div id="lista-art" class="lista">${sug.length ? '<p class="suave">Parecidos (sólo sugerencias: elegí vos)</p>' + sug.map((s) => itemArticulo(s.a, `${Math.round(s.puntaje * 100)}%${s.suyo ? ' · de este proveedor' : ''}`)).join('') : '<p class="suave">Escribí para buscar en el catálogo.</p>'}</div>
    <h3>O no es stock</h3>
    <div class="destinos">${ses.esDuenio() ? '<button class="boton gisela" data-acc="poner-destino" data-d="gisela">Para Gisela</button>' : ''}
      <button class="boton" data-acc="poner-destino" data-d="gasto">Gasto del local</button><button class="boton" data-acc="poner-destino" data-d="flete">Flete o cargo</button>
      <button class="boton" data-acc="poner-destino" data-d="nuevo">Producto nuevo</button>${ses.esDuenio() ? '' : '<button class="boton" data-acc="poner-destino" data-d="nose">No sé</button>'}</div>
    <label class="casilla"><input type="checkbox" checked data-in="asoc-guardar"> ${ctx.asoc.teniaRegla ? 'Corregir la regla (si no, vale sólo esta vez)' : 'Guardar como regla para este proveedor'}</label>
    <select class="entrada" data-in="asoc-tipo"><option value="siempre">Siempre: se aplica sola</option><option value="siempre_aviso">Siempre, pero avisame</option><option value="preguntar">Preguntar cada vez</option></select>`, 'alta asociar');
}
const itemArticulo = (a, extra = '') => `<button class="item" data-acc="poner-articulo" data-id="${esc(a.item_id)}"><b>${esc(a.nombre)}</b>${extra ? ` <span class="chip">${esc(extra)}</span>` : ''}
  <span class="suave">${esc([a.categoria, a.fabricante, a.unidad, a.codigo_bistrosoft].filter(Boolean).join(' · '))}</span></button>`;
async function ponerAsociacion(destino, item_id = null) {
  const r = ctx.r, a = ctx.asoc;
  r.nose = destino === 'nose'; r.nuevo = destino === 'nuevo';
  r.destino = destino === 'nose' ? null : destino === 'nuevo' ? 'articulo' : destino;
  r.item_id = destino === 'articulo' ? item_id : null;
  r.equivalencia_id = null; r.regla_tipo = null; r.editado_asoc = true;
  r.editado_por = yo().usuario_id; r.editado_en = ahoraISO();
  if (ctx.codigoAVincular && destino === 'articulo') { await cat.vincularCodigo(ctx.codigoAVincular, item_id); ctx.codigoAVincular = null; }
  completarDesdeArticulo(r);
  if (a.guardar && r.destino && !r.nuevo && (r.descripcion || r.codigo_prov) && rec.proveedor && (destino !== 'gisela' || ses.esDuenio()))
    await cat.guardarRegla({ proveedor: rec.proveedor, codigo_prov: r.codigo_prov, descripcion: r.descripcion, destino: r.destino, item_id: r.item_id, tipo_regla: a.tipo, factor: r.factor, creada_por: yo().usuario_id });
  cerrarCapa(capas.querySelector('.capa.asociar'));
  await guardarRec(); await revalidar();
  pintarRenglon();
}

// ---------- escanear ----------
function abrirEscaner() {
  ctx = { que: 'escaner', por: 1 };
  const d = capa(`<div class="capa-cab"><h2>Escanear productos</h2><button class="icono" data-acc="cerrar-escaner">✕</button></div>
    <div class="visor"><video id="video" playsinline muted></video><div class="mira"></div></div>
    <p id="esc-ultimo" class="caja">Apuntá al código de barras. Cada lectura suma 1.</p>
    <div class="grilla"><label>Sumar de a<input class="entrada der grande" inputmode="decimal" id="esc-por" value="1" data-in="esc-por"></label>
      <label>O tipeá el código<input class="entrada grande" inputmode="numeric" id="esc-codigo" autocomplete="off"></label></div>
    <div class="fila-botones"><button class="boton" data-acc="esc-tipeado">Sumar el código tipeado</button><button class="boton fuerte" data-acc="cerrar-escaner">Listo</button></div>`, 'alta escaner');
  esc_.abrir($('#video', d), (codigo) => leido(codigo)).catch((e) => { $('.visor', d).innerHTML = `<p class="caja alerta">${esc(e.message || 'No se pudo abrir la cámara.')}</p>`; });
}
async function leido(codigo) {
  const q = L.leerQRArca(codigo);
  if (q) { aplicarQR(q); await guardarRec(); return mostrarEscaneo('QR de ARCA leído: se completó el encabezado.'); }
  const x = cat.interpretarCodigo(codigo);
  let suma = ctx.por || 1;
  if (x.clase === 'desconocido' || !/^\d{6,14}$/.test(x.codigo)) return codigoDesconocido(x.codigo || codigo);
  if (x.clase === 'balanza') {
    const kg = await pedir(`Etiqueta de balanza (PLU ${x.plu}). ¿Cuántos kilos?`, { valor: campo(x.valor / 1000), modo: 'decimal', ayuda: 'Las etiquetas de balanza llevan peso o precio, no unidades. Después elegí el artículo en el renglón.' });
    if (kg === null || num(kg) === null) return;
    const r = R.renglonNuevo(rec, { cant_facturada: num(kg), cant_recibida: num(kg), cant_escaneada: num(kg), unidad: 'Kg', origen: 'escaneo', fact_auto: true, nota: `Etiqueta de balanza ${x.codigo}` });
    rec.escaneos.push({ codigo: x.codigo, hora: ahoraISO(), item_id: null, que: 'etiqueta de balanza', suma: num(kg) });
    await guardarRec(); cerrarEscaner(false); return abrirRenglon(r.linea);
  }
  if (x.clase === 'bulto') {
    const a = cat.articulo(x.item_id), def = (a.proveedores || []).find((p) => p.proveedor === rec.proveedor)?.cantidad || 1;
    const n = await pedir(`Código de bulto de ${a.nombre}. ¿Cuántas unidades trae la caja?`, { valor: campo(def), modo: 'decimal' });
    if (n === null || !(num(n) > 0)) return;
    suma = suma * num(n);
  }
  sumarEscaneo(x.item_id, x.codigo, suma);
  await guardarRec();
}
function sumarEscaneo(item_id, codigo, suma) {
  const a = cat.articulo(item_id);
  let r = rec.renglones.find((y) => y.destino === 'articulo' && y.item_id === item_id);
  if (!r) {
    r = R.renglonNuevo(rec, { destino: 'articulo', item_id, cant_escaneada: 0, cant_recibida: 0, cant_facturada: 0, unidad: a.unidad, origen: 'escaneo', regla_tipo: 'barras', fact_auto: true, codigo_prov: codigo });
    completarDesdeArticulo(r);
  }
  r.cant_escaneada = r3((r.cant_escaneada || 0) + suma);
  r.cant_recibida = r3(r.cant_escaneada / (r.factor || 1)); r.recibido_auto = false;
  if (r.fact_auto) r.cant_facturada = r.cant_recibida;
  rec.escaneos.push({ codigo, hora: ahoraISO(), item_id, suma });
  mostrarEscaneo(`${a.nombre}: van ${cant(r.cant_escaneada)} ${a.unidad}${r.fact_auto ? '' : ` de ${cant(r.cant_facturada * (r.factor || 1))} facturados`}`, 'bien');
}
function mostrarEscaneo(t, clase = '') { const p = $('#esc-ultimo'); if (p) { p.className = 'caja ' + clase; p.textContent = t; } else aviso(t, clase); }
function cerrarEscaner(repintar = true) { esc_.cerrar(); cerrarCapa(capas.querySelector('.capa.escaner')); if (repintar) revalidar().then(pantallaRecepcion); }
async function codigoDesconocido(codigo) {
  esc_.cerrar();
  const d = capa(`<p class="pregunta">El código <b>${esc(codigo)}</b> no está en el catálogo.</p><p class="suave">Puede ser un producto que el catálogo tiene sin código de barras, uno nuevo, una muestra del proveedor o algo para Gisela.</p>
    <div class="columna"><button class="boton fuerte" data-r="vincular">Es un artículo del catálogo: buscarlo</button><button class="boton" data-r="nuevo">Producto nuevo</button>
    <button class="boton" data-r="muestra">Muestra del proveedor</button>${ses.esDuenio() ? '<button class="boton gisela" data-r="gisela">Para Gisela</button>' : '<button class="boton" data-r="nose">No sé</button>'}<button class="boton" data-r="nada">No sumar</button></div>`, 'chica');
  const que = await new Promise((ok) => d.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { cerrarCapa(d); ok(b.dataset.r); } }));
  if (que === 'nada') return cerrarEscaner();
  const r = R.renglonNuevo(rec, { codigo_prov: codigo, cant_facturada: ctx.por || 1, cant_recibida: ctx.por || 1, cant_escaneada: ctx.por || 1, origen: 'escaneo', fact_auto: true });
  rec.escaneos.push({ codigo, hora: ahoraISO(), item_id: null, que: que, suma: ctx.por || 1 });
  if (que === 'nuevo') { r.destino = 'articulo'; r.nuevo = true; r.nota = `Código de barras ${codigo}`; }
  if (que === 'muestra') { r.destino = 'gasto'; r.nota = `Muestra del proveedor · código ${codigo}`; r.precio = 0; r.cant_facturada = 0; r.fact_auto = false; }
  if (que === 'gisela') r.destino = 'gisela';
  if (que === 'nose') r.nose = true;
  await guardarRec(); await revalidar();
  cerrarCapa(capas.querySelector('.capa.escaner'));
  abrirRenglon(r.linea);
  if (que === 'vincular') { ctx.codigoAVincular = codigo; abrirAsociar(); ctx.asoc.guardar = false; }
}

// ---------- vista previa y aprobación ----------
function previaTabla() {
  const plata = ses.veCostos();
  const filas = rec.renglones.map((r) => {
    const a = r.item_id ? cat.articulo(r.item_id) : null, u = a ? cat.ultimoCosto(a.item_id, rec.proveedor) : null, cs = R.costoStock(r);
    const pct = u && u.costo > 0 && cs !== null ? r2((cs - u.costo) / u.costo * 100) : null;
    const vs = lista.filter((v) => v.linea === r.linea && (plata || v.ambito === 'fisico'));
    const est = vs.some((v) => v.nivel === 'bloqueo') ? 'rojo' : vs.some((v) => v.nivel === 'aviso' && !rec.aceptados[v.clave]) ? 'amarillo' : 'verde';
    return `<tr class="${est}" data-acc="renglon" data-l="${r.linea}"><td>${r.destino === 'articulo' ? esc(a?.nombre || (r.nuevo ? 'Producto nuevo' : 'Sin artículo')) : esc(R.DESTINOS[r.destino] || 'Sin asociar')}${r.editado_por ? ' <i class="punto azul"></i>' : ''}<br><small>${esc(r.descripcion || '')}</small></td>
      <td class="n">${cant(r.cant_facturada)}</td><td class="n">${cant(r.cant_recibida)}</td><td class="n">${r.cant_escaneada === null ? '' : cant(r.cant_escaneada)}</td><td>${esc(r.unidad || '')}</td>
      ${plata ? `<td class="n">${R.costoUnit(r) === null ? '—' : pesos(R.costoUnit(r))}</td><td class="n">${u ? pesos(r2(u.costo * (r.factor || 1))) : ''}</td><td class="n ${pct !== null && Math.abs(pct) > R.UMBRAL_PRECIO ? 'mal' : ''}">${pct === null ? '' : (pct > 0 ? '+' : '') + String(pct).replace('.', ',') + '%'}</td><td class="n">${R.importe(r) === null ? '—' : pesos(R.importe(r))}</td>` : ''}
      <td>${r.vence ? fechaCorta(r.vence) : ''}</td><td>${est === 'rojo' ? '✕' : est === 'amarillo' ? '!' : '✓'}</td></tr>`;
  }).join('');
  return `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Artículo</th><th>Fact.</th><th>Recib.</th><th>Escan.</th><th>Un.</th>${plata ? '<th>Costo unit.</th><th>Anterior</th><th>Cambio</th><th>Subtotal</th>' : ''}<th>Vence</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
}
function pantallaPrevia() {
  const plata = ses.veCostos(), c = rec.comp, t = R.totales(rec);
  const visibles = lista.filter((v) => plata || v.ambito === 'fisico');
  const bloq = visibles.filter((v) => v.nivel === 'bloqueo'), avisos = visibles.filter((v) => v.nivel === 'aviso'), infos = visibles.filter((v) => v.nivel === 'info');
  const sinAceptar = avisos.filter((v) => !rec.aceptados[v.clave]);
  const b = R.filasBistrosoft(rec, cfg);
  const pest = ctx.pest || 'pdf';
  const linea = (v) => (v.linea ? `<button class="enlace" data-acc="renglon" data-l="${v.linea}">Renglón ${v.linea}</button> ` : '');
  const puede = ses.puedeAprobar();
  const listo = !bloq.length && !sinAceptar.length;
  app.innerHTML = `${cabecera('Vista previa', '/r/' + rec.uuid)}
  <main class="con-pie">
    <section class="bloque"><h2>${esc(rec.proveedor || 'Sin proveedor')}</h2>
      <p>${R.TIPOS[c.tipo]} ${esc(c.numero ? R.numeroLargo(c) : 's/n')} · ${fechaCorta(c.fecha)}${plata ? ' · <b>' + pesos(c.total) + '</b>' : ''}<br><span class="suave">Recibió ${esc(ses.nombreDe(rec.firmas.recibido_por))} · ${fechaHora(rec.firmas.recibido_en)}${rec.estado === 'controlada' ? ' · control físico terminado' : ''}</span></p></section>
    ${bloq.length ? `<section class="bloque"><h2 class="mal">No se puede aprobar <small>${bloq.length}</small></h2>${bloq.map((v) => `<p class="caja mal">${linea(v)}${esc(v.detalle)}</p>`).join('')}</section>` : ''}
    ${avisos.length ? `<section class="bloque"><h2 class="alerta">Avisos <small>${sinAceptar.length} sin aceptar</small></h2>
      ${avisos.map((v) => { const ac = rec.aceptados[v.clave]; return `<div class="caja ${ac ? '' : 'alerta'}">${linea(v)}${esc(v.detalle)}
        ${ac ? `<br><span class="suave">Aceptado por ${esc(ses.nombreDe(ac.por))}: ${esc(ac.motivo)}</span> <button class="enlace" data-acc="desaceptar" data-c="${esc(v.clave)}">deshacer</button>` : `<br><button class="boton chico" data-acc="aceptar" data-c="${esc(v.clave)}">Aceptar con un motivo</button>`}</div>`; }).join('')}
      ${sinAceptar.length > 1 ? `<button class="boton ancho" data-acc="aceptar-todos">Aceptar los ${sinAceptar.length} con el mismo motivo</button>` : ''}</section>` : ''}
    ${infos.length ? `<section class="bloque"><h2>Para saber</h2>${infos.map((v) => `<p class="caja">${linea(v)}${esc(v.detalle)}</p>`).join('')}</section>` : ''}
    <section class="bloque"><h2>Renglones <small>${rec.renglones.length}</small></h2>${previaTabla()}
      ${plata ? `<div class="totales"><span>Suman los renglones</span><b>${pesos(t.suma)}</b>${t.esperado !== null ? `<span>Contra el comprobante</span><b>${pesos(t.esperado)}</b><span>Diferencia</span><b class="${Math.abs(t.diferencia) > R.TOLERANCIA ? 'mal' : 'bien'}">${pesos(t.diferencia)}</b>` : ''}
        ${t.gisela ? `<span>Para Gisela (sin impuestos)</span><b>${pesos(t.gisela)}</b>` : ''}<span>Total del comprobante</span><b>${pesos(c.total)}</b></div>` : ''}</section>
    ${plata ? `<section class="bloque"><h2>Lo que va a salir</h2>
      <div class="pestanas">${[['pdf', 'PDF'], ['bistrosoft', 'Bistrosoft'], ['gestion', 'Gestión']].map(([k, n]) => `<button class="${pest === k ? 'activa' : ''}" data-acc="pest" data-p="${k}">${n}</button>`).join('')}</div>
      ${pest === 'pdf' ? `<p><b>${esc(rec.proveedor ? R.nombreControl(rec) : 'control.pdf')}</b></p><p class="suave">1) El original completo: ${rec.adjuntos.length ? rec.adjuntos.length + ' archivo(s), una página cada foto' : 'no hay foto ni PDF adjunto'}. 2) La tabla de arriba con lo que leyó el sistema, lo corregido a mano y los avisos aceptados${t.gisela ? ', y el bloque "Para Gisela" con su subtotal' : ''}. 3) El resumen: totales, ${R.calidad(rec).leidos} campos leídos, ${R.calidad(rec).corregidos} corregidos, quién recibió y quién aprobó. Lleva la marca "Control interno — no válido como comprobante".</p>`
      : pest === 'bistrosoft' ? `${b.filas.length ? `<div class="tabla-scroll"><table class="tabla"><thead><tr>${b.columnas.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${b.filas.map((f) => `<tr>${f.map((x) => `<td class="${typeof x === 'number' ? 'n' : ''}">${esc(typeof x === 'number' ? String(x).replace('.', ',') : x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="suave">Ningún renglón va a Bistrosoft: no se genera el Excel.</p>'}
        ${b.afuera.length ? `<p class="suave"><b>No van al Excel:</b></p>${b.afuera.map((x) => `<p class="suave">· ${esc(x.que)}: ${esc(x.motivo)}</p>`).join('')}` : ''}<p class="suave">Columnas provisorias, hasta tener la plantilla del importador de stock de Bistroweb.</p>`
      : `<pre class="json">${esc(JSON.stringify(R.aRecepcionV1({ ...rec, firmas: { ...rec.firmas, aprobado_por: yo().usuario_id, aprobado_en: ahoraISO() } }, cfg, lista), null, 1))}</pre>`}</section>` : ''}
  </main>
  <footer class="pie-acciones"><button class="boton" data-acc="ir" data-a="/r/${rec.uuid}">Corregir</button>
    ${puede ? `<button class="boton fuerte" data-acc="aprobar" ${listo ? '' : 'disabled'}>Aprobar y generar</button>` : `<button class="boton fuerte" data-acc="controlada" ${listo && rec.estado !== 'controlada' ? '' : 'disabled'}>${rec.estado === 'controlada' ? 'Esperando a un dueño' : 'Control terminado'}</button>`}</footer>`;
}
async function aceptar(claves) {
  const m = await pedir(claves.length > 1 ? `Motivo para aceptar los ${claves.length} avisos` : 'Motivo para aceptar el aviso', { ayuda: 'Queda guardado con tu nombre. Por ejemplo: "aumento avisado por el proveedor", "se reclama el faltante".' });
  if (m === null) return; if (!m.trim()) return aviso('Hace falta un motivo corto.', 'mal');
  for (const c of claves) rec.aceptados[c] = { motivo: m.trim(), por: yo().usuario_id, fecha: ahoraISO() };
  await guardarRec(); pantallaPrevia();
}
async function aprobar() {
  await revalidar();
  const p = R.pendientes(rec, lista);
  if (p.bloqueos.length || p.avisos.length) return pantallaPrevia();
  const na = lista.filter((v) => v.nivel === 'aviso').length;
  if (!(await confirmar(`¿Aprobar ${tituloRec(rec)} por ${pesos(rec.comp.total)}?${na ? ` Tiene ${na} aviso(s) aceptado(s).` : ''} Después no se puede cambiar.`, 'Aprobar', 'Todavía no'))) return;
  const o = ocupado('Generando el PDF, el Excel y el archivo para Gestión…');
  const copia = JSON.stringify(rec);
  try {
    rec.firmas.aprobado_por = yo().usuario_id; rec.firmas.aprobado_en = ahoraISO(); rec.estado = 'aprobada';
    await S.generar(rec, cfg, lista);
    await guardarRec();
    cerrarCapa(o); ir('/a/' + rec.uuid);
  } catch (e) { rec = JSON.parse(copia); await guardarRec(); cerrarCapa(o); console.error(e); aviso('No se pudo generar: ' + e.message, 'mal'); }
}

// ---------- aprobada ----------
function pantallaAprobada() {
  const c = rec.comp, icono = { pdf: '📄', bistrosoft: '📊', gestion: '🗂', original: '🖼' }, nombre = { pdf: 'PDF de control', bistrosoft: 'Excel para Bistrosoft', gestion: 'Archivo para Sabores_Gestion', original: 'Original' };
  app.innerHTML = `${cabecera('Recepción aprobada', '/')}
  <main><section class="bloque"><h2>${esc(rec.proveedor)}</h2>
    <p>${R.TIPOS[c.tipo]} ${R.numeroLargo(c)} · ${fechaCorta(c.fecha)}${ses.veCostos() ? ' · <b>' + pesos(c.total) + '</b>' : ''}<br>
    <span class="suave">Recibió ${esc(ses.nombreDe(rec.firmas.recibido_por))} · ${fechaHora(rec.firmas.recibido_en)}<br>Aprobó ${esc(ses.nombreDe(rec.firmas.aprobado_por))} · ${fechaHora(rec.firmas.aprobado_en)}</span></p></section>
  <section class="bloque"><h2>Enviar</h2>
    <button class="boton fuerte ancho" data-acc="compartir" data-q="gestion">Mandar a Sabores_Gestion${rec.enviado_gestion ? ' ✓' : ''}</button>
    <p class="suave">Comparte <code>recepcion_….json</code>. Guardalo en Drive, carpeta <b>${esc(R.carpetaDrive(rec))}</b>, o pasalo a <code>datos/entrada</code> de la PC. Después, en Gestión: Importar todo.</p>
    <button class="boton ancho" data-acc="compartir" data-q="pdf">Compartir el PDF de control (WhatsApp o mail)${rec.enviado_pdf ? ' ✓' : ''}</button>
    <button class="boton ancho" data-acc="compartir" data-q="todo">Compartir todos los archivos</button></section>
  <section class="bloque"><h2>Archivos</h2>${rec.salidas.map((s, i) => `<button class="item" data-acc="bajar" data-i="${i}"><b>${icono[s.tipo]} ${nombre[s.tipo]}</b><span class="suave">${esc(S.nombreDeSalida(rec, s))}${s.bytes ? ' · ' + Math.max(1, Math.round(s.bytes / 1024)) + ' KB' : ''} · tocá para bajarlo</span></button>`).join('')}</section>
  </main>`;
}
async function compartirSalidas(que) {
  const elegidas = rec.salidas.filter((s) => que === 'todo' || s.tipo === que);
  const archivos = (await Promise.all(elegidas.map((s) => S.archivoDe(rec, s)))).filter(Boolean);
  if (!archivos.length) return aviso('No hay archivos para compartir.', 'mal');
  const r = await S.compartir(archivos, que === 'gestion' ? `Recepción ${tituloRec(rec)} para Sabores_Gestion` : S.textoMensaje(rec, lista));
  if (r === null) return;
  if (r === false) { archivos.forEach(S.descargar); aviso('Este teléfono no puede compartir archivos desde el navegador: se bajaron a Descargas.'); }
  const t = ahoraISO();
  for (const s of elegidas) { s.canal = r ? 'compartir' : 'descarga'; s.resultado = r ? 'compartido' : 'descargado'; s.enviado = t; }
  if (que !== 'pdf') rec.enviado_gestion = t; if (que !== 'gestion') rec.enviado_pdf = t;
  await guardarRec(); pantallaAprobada();
}

// ---------- configuración ----------
async function pantallaConfig() {
  const c = cat.actual(), g = await L.gastoDelMes(), duenio = ses.esDuenio(), reglas = cat.reglasAprendidas();
  const persistente = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  app.innerHTML = `${cabecera('Configuración', '/')}
  <main>
    <section class="bloque"><h2>Catálogo</h2><p>Generado el ${fechaHora(c.generado)} · ${c.articulos.length} artículos (${c.articulos.filter((a) => (a.codigos_barras || []).length).length} con código de barras) · ${c.proveedores.length} proveedores · ${(c.equivalencias || []).length} equivalencias · ${c.usuarios.length} usuarios.</p>
      <label class="boton ancho">Cargar un catálogo nuevo<input type="file" accept=".json,application/json" data-in="catalogo" hidden></label></section>
    <section class="bloque"><h2>Este celular</h2><div class="grilla">
      <label>Nombre del celular<input class="entrada" data-in="cfg" data-k="dispositivo" value="${esc(cfg.dispositivo)}"></label>
      <label>Cerrar sesión a los (min)<input class="entrada der" inputmode="numeric" data-in="cfg" data-k="bloqueo_min" value="${cfg.bloqueo_min}"></label>
      <label class="doble">Sucursal para el Excel de Bistrosoft<input class="entrada" data-in="cfg" data-k="sucursal" value="${esc(cfg.sucursal)}" placeholder="${esc(c.comercio || '')}"></label></div>
      <button class="boton ancho" data-acc="cambiar-pin">Cambiar mi PIN</button>
      ${duenio ? `<button class="boton ancho" data-acc="borrar-pin">Borrar el PIN de otra persona</button>` : ''}
      <p class="suave">${persistente ? 'El teléfono guarda los datos de forma permanente.' : 'Ojo: el navegador puede borrar los datos si falta espacio. Instalá la app en la pantalla de inicio y mandá cada recepción a Gestión apenas se aprueba.'}</p></section>
    ${duenio ? `<section class="bloque"><h2>Lectura con IA</h2>
      <p class="suave">Clave propia de la prueba, guardada sólo en este teléfono. Se usa para leer fotos y PDF cuando el QR de ARCA no alcanza.</p><div class="grilla">
      <label class="doble">Clave de la API de Anthropic<input class="entrada" type="password" data-in="cfg" data-k="api_clave" value="${esc(cfg.api_clave)}" autocomplete="off" placeholder="sk-ant-…"></label>
      <label class="doble">Modelo<input class="entrada" data-in="cfg" data-k="modelo" value="${esc(cfg.modelo)}" placeholder="Vacío: el Haiku más nuevo de la cuenta"></label>
      <label>Tope por mes (US$)<input class="entrada der" inputmode="decimal" data-in="cfg" data-k="tope_usd" value="${campo(cfg.tope_usd)}"></label>
      <div class="calculo"><small>Gastado este mes</small><b>US$ ${g.usd.toFixed(3)}</b><small>${g.llamadas} lecturas</small></div>
      <label>US$ por millón, entrada<input class="entrada der" inputmode="decimal" data-in="cfg" data-k="precio_entrada" value="${campo(cfg.precio_entrada)}"></label>
      <label>US$ por millón, salida<input class="entrada der" inputmode="decimal" data-in="cfg" data-k="precio_salida" value="${campo(cfg.precio_salida)}"></label></div>
      <button class="boton ancho" data-acc="buscar-modelos">Probar la clave y ver los modelos</button><div id="modelos"></div>
      <p class="suave">El gasto es una estimación con esos precios: ajustalos a la lista de precios vigente. El tope corta las lecturas del mes cuando se llega.</p></section>` : ''}
    <section class="bloque"><h2>Equivalencias aprendidas en este celular <small>${reglas.length}</small></h2>
      ${reglas.length ? reglas.map((e) => `<p class="suave">· ${esc(e.proveedor)}: ${esc(e.descripcion || e.codigo_prov)} → <b>${e.destino === 'articulo' ? esc(nombreItem(e.item_id)) : R.DESTINOS[e.destino]}</b> (${e.tipo_regla.replace('_', ' con ')})</p>`).join('') : '<p class="suave">Ninguna todavía.</p>'}
      <p class="suave">Viajan a Gestión dentro de cada recepción. Cuando vuelven en el catálogo, se borran de acá.</p></section>
    <section class="bloque"><h2>Respaldo</h2><button class="boton ancho" data-acc="respaldo">Bajar un respaldo de las recepciones (JSON)</button>
      <p class="suave">SpC Depósito ${VERSION} · normalizador v${cat.actual().version_normalizador}</p></section>
  </main>`;
}

// ---------- acciones ----------
const acciones = {
  ir: (b) => ir(b.dataset.a),
  demo: async () => { await cat.importar(JSON.stringify(globalThis.SPC_DEMO)); aviso('Catálogo de ejemplo cargado: son datos inventados.', 'bien'); pintar(); },
  cerrar: () => cerrarCapa(),
  'elegir-usuario': (b) => elegirUsuario(b.dataset.id),
  'cambiar-usuario': async () => { if (await confirmar(`¿Cerrar la sesión de ${yo().nombre}?`, 'Cambiar de usuario', 'Seguir')) { ses.salir(); pintar(); } },
  nueva: async () => { rec = R.nueva(yo()); await guardarRec(); ir('/r/' + rec.uuid); },
  'borrar-rec': async () => {
    if (!(await confirmar('¿Descartar esta recepción? Se borra de este celular con sus fotos.', 'Descartar', 'No'))) return;
    for (const a of rec.adjuntos) await db.borrar('archivos', a.id);
    await db.borrar('recepciones', rec.uuid); ir('/');
  },
  'ver-adjunto': async (b) => {
    const a = rec.adjuntos[Number(b.dataset.i)], blob = await db.leer('archivos', a.id), u = URL.createObjectURL(blob);
    const d = capa(`<div class="capa-cab"><h2>${esc(a.nombre || 'Original')}</h2><button class="icono" data-acc="cerrar">✕</button></div>
      ${a.tipo === 'application/pdf' ? `<a class="boton ancho" href="${u}" target="_blank" rel="noopener">Abrir el PDF</a>` : `<div class="foto"><img src="${u}" alt=""></div>`}
      <button class="boton peligro ancho" data-acc="quitar-adjunto" data-i="${b.dataset.i}">Quitar</button>`, 'alta');
    d.dataset.url = u;
  },
  'quitar-adjunto': async (b) => { const [a] = rec.adjuntos.splice(Number(b.dataset.i), 1); await db.borrar('archivos', a.id); urls.delete(a.id); await guardarRec(); pintar(); },
  leer: leerComprobante,
  'elegir-proveedor': elegirProveedor,
  'poner-proveedor': async (b) => {
    rec.proveedor = b.dataset.p; rec.proveedor_leido = null; rec.proveedor_sugerido = null;
    for (const r of rec.renglones) if (!r.destino && !r.nose) { R.asociarSolo(rec, r); completarDesdeArticulo(r); }
    await guardarRec(); cerrarCapa(); await revalidar(); pantallaRecepcion();
  },
  'usar-suma': async () => { const t = R.totales(rec); rec.comp.total = t.suma; if (rec.comp.neto === null) rec.comp.neto = null; await guardarRec(); await revalidar(); pantallaRecepcion(); },
  renglon: (b) => abrirRenglon(Number(b.dataset.l)),
  'renglon-nuevo': async () => { const r = R.renglonNuevo(rec, { origen: 'manual' }); await guardarRec(); abrirRenglon(r.linea); ctx.nuevo = true; abrirAsociar(); },
  'cerrar-renglon': async () => {
    const r = ctx.r;
    if (ctx.nuevo && !r.destino && !r.nose && !r.descripcion && r.cant_recibida === null) rec.renglones = rec.renglones.filter((x) => x !== r);   // se abrió y no se cargó nada
    await guardarRenglon();
  },
  'guardar-renglon': () => guardarRenglon(),
  'borrar-renglon': async () => {
    if (!(await confirmar('¿Borrar este renglón?', 'Borrar', 'No'))) return;
    rec.renglones = rec.renglones.filter((x) => x !== ctx.r); rec.renglones.forEach((x, i) => { x.linea = i + 1; });
    await guardarRec(); await revalidar(); cerrarCapa(capas.querySelector('.capa.renglon')); pantallaRecepcionOPrevia();
  },
  'partir-renglon': async () => {
    const r = ctx.r, n = await pedir('¿Cuánto pasa al renglón nuevo?', { modo: 'decimal', ayuda: `Sirve para separar una parte con otro vencimiento o destino. Facturado ahora: ${cant(r.cant_facturada)}.` });
    const q = num(n); if (n === null || !(q > 0) || q >= (r.cant_facturada || 0)) return q ? aviso('Tiene que ser menos que lo facturado.', 'mal') : null;
    const { linea, ...copia } = JSON.parse(JSON.stringify(r));
    r.cant_facturada = r3(r.cant_facturada - q); r.cant_recibida = r.cant_facturada;
    R.renglonNuevo(rec, { ...copia, cant_facturada: q, cant_recibida: q, cant_escaneada: null, leido: null, confianza: null, nota: `Partido del renglón ${r.linea}`, editado_por: yo().usuario_id, editado_en: ahoraISO() });
    r.editado_por = yo().usuario_id; r.editado_en = ahoraISO();
    await guardarRenglon();
  },
  asociar: abrirAsociar,
  'poner-articulo': (b) => ponerAsociacion('articulo', b.dataset.id),
  'poner-destino': (b) => ponerAsociacion(b.dataset.d),
  escanear: abrirEscaner,
  'cerrar-escaner': () => cerrarEscaner(),
  'esc-tipeado': () => { const i = $('#esc-codigo'); if (i.value.trim()) { leido(i.value.trim()); i.value = ''; } },
  pest: (b) => { ctx.pest = b.dataset.p; pantallaPrevia(); },
  aceptar: (b) => aceptar([b.dataset.c]),
  'aceptar-todos': () => aceptar(lista.filter((v) => v.nivel === 'aviso' && !rec.aceptados[v.clave] && (ses.veCostos() || v.ambito === 'fisico')).map((v) => v.clave)),
  desaceptar: async (b) => { delete rec.aceptados[b.dataset.c]; await guardarRec(); pantallaPrevia(); },
  aprobar,
  controlada: async () => { rec.estado = 'controlada'; rec.controlado_en = ahoraISO(); await guardarRec(); aviso('Listo. Falta que un dueño o encargado revise los precios y apruebe.', 'bien'); ir('/'); },
  compartir: (b) => compartirSalidas(b.dataset.q),
  bajar: async (b) => { const f = await S.archivoDe(rec, rec.salidas[Number(b.dataset.i)]); if (f) S.descargar(f); },
  'cambiar-pin': async () => {
    const p1 = await pedir('PIN nuevo (4 a 6 números)', { tipo: 'password', modo: 'numeric' }); if (p1 === null) return;
    const p2 = await pedir('Repetí el PIN nuevo', { tipo: 'password', modo: 'numeric' }); if (p2 === null) return;
    if (p1 !== p2) return aviso('Los dos PIN no coinciden.', 'mal');
    try { await ses.crearPin(yo().usuario_id, p1); aviso('PIN cambiado.', 'bien'); } catch (e) { aviso(e.message, 'mal'); }
  },
  'borrar-pin': async () => {
    const us = cat.usuarios().filter((u) => u.usuario_id !== yo().usuario_id);
    const d = capa(`<p class="pregunta">¿De quién? La próxima vez que entre va a elegir un PIN nuevo.</p><div class="columna">${us.map((u) => `<button class="boton" data-r="${esc(u.usuario_id)}">${esc(u.nombre)}</button>`).join('')}<button class="boton" data-r="">Cancelar</button></div>`, 'chica');
    d.addEventListener('click', async (e) => { const b = e.target.closest('[data-r]'); if (!b) return; cerrarCapa(d); if (b.dataset.r) { await ses.borrarPin(b.dataset.r); aviso('PIN borrado.', 'bien'); } });
  },
  'buscar-modelos': async () => {
    const z = $('#modelos'); z.innerHTML = '<p class="suave">Consultando…</p>';
    try {
      const ms = await L.modelosHaiku(cfg.api_clave);
      z.innerHTML = ms.length ? '<p class="suave">La clave funciona. Tocá un modelo para usarlo:</p>' + ms.map((m) => `<button class="item" data-acc="poner-modelo" data-m="${esc(m.id)}"><b>${esc(m.nombre)}</b><span class="suave">${esc(m.id)}</span></button>`).join('') : '<p class="caja alerta">La clave funciona, pero la cuenta no lista modelos Haiku.</p>';
    } catch (e) { z.innerHTML = `<p class="caja mal">${esc(e.message === 'Failed to fetch' ? 'No se pudo conectar. Revisá la señal.' : e.message)}</p>`; }
  },
  'poner-modelo': async (b) => { cfg.modelo = b.dataset.m; await guardarCfg(); pantallaConfig(); },
  respaldo: async () => {
    const todo = { formato: 'spc-deposito.respaldo.v1', generado: ahoraISO(), recepciones: await db.todos('recepciones'), reglas: cat.reglasAprendidas() };
    S.descargar(new File([JSON.stringify(todo)], `spc-deposito-respaldo-${hoy()}.json`, { type: 'application/json' }));
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc]'); if (!b || b.disabled) return;
  const f = acciones[b.dataset.acc]; if (f) Promise.resolve(f(b, e)).catch((err) => { console.error(err); aviso(err.message || 'Algo falló.', 'mal'); });
});

// ---------- entradas ----------
const entradas = {
  catalogo: async (i) => {
    const f = i.files[0]; if (!f) return;
    try { const r = await cat.importar(await f.text()); aviso(`Catálogo cargado: ${r.resumen.articulos ?? '?'} artículos.`, 'bien'); r.avisos.forEach((a) => aviso(a, 'mal')); }
    catch (e) { aviso(e.message, 'mal'); }
    if (yo() && !cat.usuarios().some((u) => u.usuario_id === yo().usuario_id)) ses.salir();
    pintar();
  },
  adjuntar: (i) => { const fs = [...i.files]; i.value = ''; if (fs.length) adjuntar(fs); },
  comp: async (i) => {
    const k = i.dataset.k, c = rec.comp;
    c[k] = ['neto', 'iva', 'percepciones', 'otros', 'total'].includes(k) ? num(i.value) : i.value.trim();
    if (k === 'tipo' && (c.tipo === 'RTO' || c.tipo === 'NC')) c.reemplaza = null;
    await guardarRec(); await revalidar(); pantallaRecepcion();
  },
  reemplaza: async (i) => { const n = i.value.replace(/\D/g, ''); rec.comp.reemplaza = n ? { tipo: 'RTO', punto_venta: '', numero: n } : null; await guardarRec(); },
  nota: async (i) => { rec.nota = i.value.trim(); await guardarRec(); },
  r: (i) => cambioRenglon(i.dataset.k, i.value),
  'asoc-guardar': (i) => { ctx.asoc.guardar = i.checked; },
  'asoc-tipo': (i) => { ctx.asoc.tipo = i.value; },
  'esc-por': (i) => { ctx.por = num(i.value) > 0 ? num(i.value) : 1; },
  cfg: async (i) => {
    const k = i.dataset.k;
    cfg[k] = ['bloqueo_min', 'tope_usd', 'precio_entrada', 'precio_salida'].includes(k) ? (num(i.value) ?? cfg[k]) : i.value.trim();
    if (k === 'bloqueo_min') cfg.bloqueo_min = Math.max(1, Math.round(cfg.bloqueo_min));
    await guardarCfg();
  },
};
document.addEventListener('change', (e) => { const i = e.target.closest('[data-in]'); if (i && entradas[i.dataset.in]) Promise.resolve(entradas[i.dataset.in](i)).catch((err) => { console.error(err); aviso(err.message, 'mal'); }); });
document.addEventListener('input', (e) => {
  const i = e.target;
  if (i.dataset.in === 'busca-prov') listarProveedores(i.value);
  if (i.dataset.in === 'busca-art') { const t = i.value.trim(); $('#lista-art').innerHTML = t.length < 2 ? '<p class="suave">Escribí al menos 2 letras.</p>' : cat.buscar(t, rec.proveedor).map((a) => itemArticulo(a, (a.proveedores || []).some((p) => p.proveedor === rec.proveedor) ? 'de este proveedor' : '')).join('') || '<p class="suave">Nada con ese nombre. Si es para el local y no existe, usá "Producto nuevo".</p>'; }
  if (i.dataset.in === 'r') cambioRenglon(i.dataset.k, i.value);
});

// ---------- arranque ----------
async function arrancar() {
  cfg = { ...cfg, ...((await db.leer('kv', 'config')) || {}) };
  await cat.cargar();
  db.persistir();
  ses.vigilar(cfg.bloqueo_min, () => { aviso('La sesión se cerró por falta de uso.'); pintar(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  pintar();
}
arrancar().catch((e) => { app.innerHTML = `<div class="centro"><p class="caja mal">No se pudo abrir la app: ${esc(e.message)}</p></div>`; });
