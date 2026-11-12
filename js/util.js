// Utilidades sin estado.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** "1.234,50" o "1234.5" -> 1234.5 ; vacío -> null */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).trim().replace(/[$\s]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export const pesos = (n) => (n === null || n === undefined || n === '' ? '—' : '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const cant = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 }));
export const campo = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

const dos = (n) => String(n).padStart(2, '0');
/** Fecha y hora local con su diferencia horaria: 2026-11-12T10:00:00-03:00 */
export function ahoraISO(d = new Date()) {
  const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-', a = Math.abs(o);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}${s}${dos(Math.floor(a / 60))}:${dos(a % 60)}`;
}
export const hoy = () => ahoraISO().slice(0, 10);
export const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const fechaHora = (iso) => (iso ? `${fechaCorta(iso)} ${iso.slice(11, 16)}` : '—');
export const dias = (desde, hasta) => Math.round((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 864e5);

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16);
})).toLowerCase();

export async function sha1(datos) {
  const buf = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos instanceof Blob ? await datos.arrayBuffer() : datos;
  const h = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const ceros = (v, n) => { const t = String(v ?? '').trim(); return /^\d+$/.test(t) ? t.padStart(n, '0') : t; };
export const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
/** Nombre apto para archivo o carpeta. */
export const limpio = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');

export function blobABase64(blob) {
  return new Promise((ok, mal) => { const l = new FileReader(); l.onload = () => ok(String(l.result).split(',')[1]); l.onerror = () => mal(l.error); l.readAsDataURL(blob); });
}
export function blobADataURL(blob) {
  return new Promise((ok, mal) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.onerror = () => mal(l.error); l.readAsDataURL(blob); });
}
/** Achica una imagen para que su lado mayor no pase de `lado`. Devuelve un JPEG. */
export async function achicar(blob, lado = 1568, calidad = 0.85) {
  const bmp = await createImageBitmap(blob);
  const f = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return new Promise((ok) => c.toBlob((b) => ok({ blob: b, ancho: c.width, alto: c.height }), 'image/jpeg', calidad));
}
