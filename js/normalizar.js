// C-10 · Normalizador de descripciones de proveedor. Lo usan Sabores_Gestion y la app del celular: tiene que dar
// exactamente lo mismo en los dos lados, así que no importa nada (ni node:, ni el resto del repo).
//   "Queso SARDO  Horma x 2250CC"  ->  "queso sardo horma x 2,25 l"
//   "Agua s/gas X6 500ML"         ->  "agua s/gas x6 500 ml"
// Si cambia, las equivalencias guardadas dejan de encontrarse: cambiar acá exige recalcular descripcion_norm.

const num = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const leer = (t) => Number(String(t).replace(',', '.'));

/** Una medida en su unidad grande cuando llega a 1: 2250 cc -> 2,25 l; 500 g -> 500 g; 1000 g -> 1 kg. */
function medida(valor, unidad) {
  const v = leer(valor);
  if (!Number.isFinite(v)) return `${valor} ${unidad}`;
  switch (unidad) {
    case 'cc': case 'ml': case 'cm3': return v >= 1000 ? `${num(v / 1000)} l` : `${num(v)} ml`;
    case 'cl': return v >= 100 ? `${num(v / 100)} l` : `${num(v * 10)} ml`;
    case 'l': case 'lt': case 'lts': case 'litro': case 'litros': return `${num(v)} l`;
    case 'g': case 'gr': case 'grs': case 'gramos': return v >= 1000 ? `${num(v / 1000)} kg` : `${num(v)} g`;
    case 'kg': case 'kgs': case 'kilo': case 'kilos': return `${num(v)} kg`;
    default: return `${num(v)} ${unidad}`;
  }
}

export const VERSION_NORMALIZADOR = 1;

export function normalizarDescripcion(texto) {
  let t = String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[ \t]/g, ' ').replace(/["'´`]/g, '');
  // packs: "X6", "x 6", "6x" -> "x6" (antes de las medidas, para no confundir "x 500 ml")
  t = t.replace(/(^|[\s(])x\s*(\d+)(?=\s|$|[),.;])/g, (_, a, n) => `${a}x${n}`);
  t = t.replace(/(^|[\s(])(\d+)\s*x(?=\s|$)/g, (_, a, n) => `${a}x${n}`);
  // medidas pegadas o separadas: 2250CC, 2250 cc, 1,5LT, 500GRS
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(cm3|cc|ml|cl|lts|lt|litros|litro|l|kgs|kg|kilos|kilo|grs|gramos|gr|g)(?![a-z])/g, (_, v, u) => ' ' + medida(v, u) + ' ');
  // signos sueltos y espacios
  t = t.replace(/[*_|;]+/g, ' ').replace(/\s*([/-])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  return t;
}

/** Parecido entre dos descripciones normalizadas (0 a 1), por palabras en común. Sólo para SUGERIR (regla 17). */
export function parecido(a, b) {
  const pa = new Set(normalizarDescripcion(a).split(' ').filter((x) => x.length > 1));
  const pb = new Set(normalizarDescripcion(b).split(' ').filter((x) => x.length > 1));
  if (!pa.size || !pb.size) return 0;
  let comunes = 0; for (const x of pa) if (pb.has(x)) comunes++;
  return (2 * comunes) / (pa.size + pb.size);
}
