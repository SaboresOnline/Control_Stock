// Escáner con la cámara (BarcodeDetector de Chrome en Android). Lee códigos de barras de productos y el QR de ARCA.
// Si el teléfono no lo tiene, queda el campo para tipear el código.
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128', 'qr_code'];
let flujo = null, corriendo = false;

export const disponible = () => 'BarcodeDetector' in globalThis && !!navigator.mediaDevices?.getUserMedia;

/** Abre la cámara dentro de `video` y llama a `alLeer(codigo, formato)` por cada lectura (la misma no se repite en 1,5 s). */
export async function abrir(video, alLeer) {
  if (!disponible()) throw new Error('Este teléfono no tiene lector de códigos en el navegador. Tipeá el código.');
  const det = new BarcodeDetector({ formats: (await BarcodeDetector.getSupportedFormats()).filter((f) => FORMATOS.includes(f)) });
  flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  video.srcObject = flujo; await video.play();
  corriendo = true;
  let ultimo = '', cuando = 0;
  const paso = async () => {
    if (!corriendo) return;
    try {
      const cs = await det.detect(video);
      for (const c of cs) {
        const ahora = Date.now();
        if (c.rawValue === ultimo && ahora - cuando < 1500) continue;
        ultimo = c.rawValue; cuando = ahora;
        navigator.vibrate && navigator.vibrate(40);
        alLeer(c.rawValue, c.format);
      }
    } catch { }
    setTimeout(paso, 140);
  };
  paso();
}
export function cerrar() {
  corriendo = false;
  if (flujo) { for (const t of flujo.getTracks()) t.stop(); flujo = null; }
}
