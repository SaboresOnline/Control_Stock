// Todo queda en el teléfono (IndexedDB). Almacenes:
//   kv          configuración, catálogo, PIN de cada usuario, gasto del mes
//   recepciones borradores y aprobadas (clave: uuid)
//   archivos    fotos, PDF y salidas generadas (clave: id)
//   reglas      equivalencias aprendidas en el celular hasta que vuelvan en el catálogo (clave: id)
const NOMBRE = 'spc-deposito';
let base = null;

function abrir() {
  if (base) return Promise.resolve(base);
  return new Promise((ok, mal) => {
    const p = indexedDB.open(NOMBRE, 1);
    p.onupgradeneeded = () => {
      const d = p.result;
      for (const s of ['kv', 'recepciones', 'archivos', 'reglas']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    p.onsuccess = () => { base = p.result; ok(base); };
    p.onerror = () => mal(p.error);
  });
}
function tx(almacen, modo, fn) {
  return abrir().then((d) => new Promise((ok, mal) => {
    const t = d.transaction(almacen, modo);
    const r = fn(t.objectStore(almacen));
    t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined);
    t.onerror = () => mal(t.error);
    t.onabort = () => mal(t.error);
  }));
}
export const leer = (almacen, clave) => tx(almacen, 'readonly', (s) => s.get(clave));
export const guardar = (almacen, clave, valor) => tx(almacen, 'readwrite', (s) => s.put(valor, clave));
export const borrar = (almacen, clave) => tx(almacen, 'readwrite', (s) => s.delete(clave));
export const todos = (almacen) => tx(almacen, 'readonly', (s) => s.getAll());
export const claves = (almacen) => tx(almacen, 'readonly', (s) => s.getAllKeys());

/** Pide al navegador que no borre los datos si falta espacio. */
export async function persistir() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
