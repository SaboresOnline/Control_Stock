# SpC Depósito — MVP de recepción de mercadería

App del celular para controlar lo que entregan los proveedores de Sabores para Compartir. Es una página estática
(HTML y JS puro, sin build ni servidor): corre en Chrome de Android, guarda todo en el teléfono y trabaja sin señal.
Al aprobar una recepción genera el PDF de control, el Excel para Bistrosoft y `recepcion_<uuid>.json`
(formato `recepcion.v1`, el contrato de `Sabores_Gestion/docs/RECEPCION-V1.md`).

Este repo tiene **sólo código**. El catálogo, las fotos, los costos y los nombres de los usuarios viven en el teléfono
y no se commitean (ver `.gitignore`).

## Publicar

Hace falta HTTPS para la cámara, el lector de códigos, instalar la app y trabajar sin señal.

- **GitHub Pages:** Settings › Pages › Deploy from a branch › `main` / raíz. Con plan gratis el repo tiene que ser público.
- **Cloudflare Pages:** conectar el repo, sin comando de build, carpeta de salida `/`. Sirve con repo privado.

En el teléfono: abrir la dirección en Chrome › menú › **Agregar a la pantalla principal**.
Al publicar una versión nueva, cambiar `VERSION` en `sw.js` (y en `js/app.js`) para que el teléfono la baje.

Para probar en la PC: `python -m http.server 8765` en esta carpeta y abrir `http://localhost:8765`.

## Primer uso

1. En Sabores_Gestion: dar de alta los usuarios (Sistema › Usuarios) y **Exportar para la app** (Sistema › Importaciones).
2. Pasar `datos/generados/catalogo_app.json` al teléfono y elegirlo en la app.
3. Cada persona toca su nombre y elige su PIN (4 a 6 números) la primera vez.
4. Un dueño carga en Configuración › Lectura con IA la clave de la API de Anthropic y el tope por mes.

## Flujo de una recepción

1. **Nueva recepción** › foto del remito o la factura, o el PDF. Si trae QR de ARCA, se completan tipo, número, fecha y total.
2. **Leer el comprobante**: manda el texto del PDF, o la imagen si es foto, a Claude Haiku y arma encabezado y renglones.
3. Cada renglón se asocia por código de barras o por una regla guardada. Lo que no tiene regla se elige a mano
   (las sugerencias por parecido nunca se aplican solas) y queda como regla para la próxima.
4. **Escanear** suma lo que entró de verdad; también se puede cargar todo a mano.
5. **Revisar**: bloqueos en rojo, avisos en amarillo (se aceptan con un motivo), y las pestañas PDF, Bistrosoft y Gestión
   muestran lo que va a salir.
6. **Aprobar y generar** › **Mandar a Sabores_Gestion**: compartir el JSON a Drive (`SpC Recepciones/...`) o pasarlo a
   `datos/entrada`. En Gestión, Importar todo.

Roles: el personal recibe y controla cantidades y vencimientos, no ve costos y no aprueba; deja la recepción
"lista para aprobar". Dueño y encargado ven costos y aprueban. "Para Gisela" sólo lo puede marcar un dueño.

## Archivos

| Archivo | Qué hace |
|---|---|
| `js/app.js` | Pantallas y flujo |
| `js/recepcion.js` | Borrador, validación, `recepcion.v1` y filas de Bistrosoft |
| `js/catalogo.js` | Catálogo en el teléfono, búsqueda, códigos de barras y equivalencias |
| `js/normalizar.js` | **Copia exacta** de `Sabores_Gestion/src/compras/normalizar.mjs`. No editar acá: si cambia allá, copiarlo de nuevo |
| `js/leer.js` | QR de ARCA, texto del PDF y lectura con Claude, con tope de gasto |
| `js/salidas.js` | PDF de control, Excel y JSON; compartir |
| `js/sesion.js` | Usuarios, PIN y cierre por inactividad |
| `js/escaner.js` | Cámara y lector de códigos |
| `js/xlsx.js`, `js/db.js`, `js/util.js` | Escritor de Excel, IndexedDB, utilidades |
| `vendor/` | jsPDF 2.5.2, jsPDF-AutoTable 3.8.4 y pdf.js 4.7.76 |

## Lo que este MVP todavía no hace

- Subir solo a Google Drive y mandar mail automático: se usa "compartir" del teléfono (Drive, WhatsApp, Gmail).
- Login con usuario y contraseña contra la nube: el PIN se crea en el teléfono la primera vez.
- Plantilla de lectura por proveedor, comparación con el pedido y "cantidad fuera de lo normal" (necesitan historial).
- Recibir un PDF con "compartir con" desde WhatsApp: hay que elegirlo desde "Foto o PDF".
- Stock, inventario, mermas, pedidos y alertas de precio para Gisela (módulos 2 a 4 de la especificación).
- Columnas definitivas del Excel de Bistrosoft: son provisorias hasta tener la plantilla de Bistroweb.
