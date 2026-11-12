// Usuarios y firma (C-25). Los usuarios vienen del catálogo; cada uno entra con su PIN en este celular.
// En el MVP no hay nube: el PIN se crea la primera vez que la persona entra en este teléfono y queda guardado acá
// (derivado con PBKDF2, no en claro). La sesión se cierra sola después de un rato sin uso.
import * as db from './db.js';
import * as cat from './catalogo.js';

let usuario = null, ultimo = Date.now(), alBloquear = null, minutos = 10;
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function derivar(pin, sal) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(sal), iterations: 120000 }, k, 256));
}
export const actual = () => usuario;
export const esDuenio = () => usuario?.rol === 'dueño';
export const veCostos = () => !!usuario && usuario.rol !== 'personal';
export const puedeAprobar = () => !!usuario && usuario.rol !== 'personal';
export const nombreDe = (id) => cat.usuarios().find((u) => u.usuario_id === id)?.nombre || id || '—';

export async function tienePin(id) { return !!(await db.leer('kv', 'pin:' + id)); }
export async function crearPin(id, pin) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN tiene que tener de 4 a 6 números.');
  const sal = id + ':' + crypto.getRandomValues(new Uint32Array(2)).join('');
  await db.guardar('kv', 'pin:' + id, { sal, clave: await derivar(pin, sal), creado: new Date().toISOString() });
}
export async function borrarPin(id) { await db.borrar('kv', 'pin:' + id); }
export async function entrar(id, pin) {
  const u = cat.usuarios().find((x) => x.usuario_id === id);
  if (!u) throw new Error('Ese usuario no está en el catálogo.');
  const g = await db.leer('kv', 'pin:' + id);
  if (!g) throw new Error('Ese usuario todavía no tiene PIN en este celular.');
  if ((await derivar(pin, g.sal)) !== g.clave) throw new Error('PIN incorrecto.');
  usuario = { ...u }; ultimo = Date.now();
  return usuario;
}
export function salir() { usuario = null; }

/** Cierra la sesión sola después de `min` minutos sin tocar la pantalla. */
export function vigilar(min, fn) {
  minutos = min || 10; alBloquear = fn;
  for (const e of ['pointerdown', 'keydown', 'input']) addEventListener(e, () => { ultimo = Date.now(); }, { passive: true, capture: true });
  setInterval(() => { if (usuario && Date.now() - ultimo > minutos * 60000) { usuario = null; alBloquear && alBloquear(); } }, 15000);
}
export const cambiarMinutos = (m) => { minutos = m || 10; };
