// Quitar el fondo de una foto de producto, adentro del celular, y ponerle el fondo crema
// que tienen las fotos de Carmesí. Usa U²-Net "p" (modelo liviano, licencia Apache-2.0,
// del proyecto rembg) con onnxruntime-web (MIT). Se carga solo cuando alguien lo usa.
(() => {
  'use strict';

  const ORT_VERSION = '1.20.1';
  const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const MODEL_URL = '/assets/models/u2netp.onnx';
  const SIZE = 320; // tamaño de entrada del modelo
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];
  const FONDO = '#ebe4d5'; // el crema de las fotos de producto de Carmesí

  let sessionPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo descargar la herramienta. Revisá la conexión.'));
      document.head.appendChild(s);
    });
  }

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        if (!window.ort) await loadScript(`${ORT_BASE}ort.wasm.min.js`);
        window.ort.env.wasm.wasmPaths = ORT_BASE;
        window.ort.env.wasm.numThreads = 1;
        return window.ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
      })().catch((err) => { sessionPromise = null; throw err; });
    }
    return sessionPromise;
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Máscara del producto (0..1) en 320x320.
  async function predictMask(source) {
    const session = await getSession();
    const c = canvas(SIZE, SIZE);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const n = SIZE * SIZE;
    const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (data[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
    }
    const feeds = { [session.inputNames[0]]: new window.ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) };
    const out = await session.run(feeds);
    const pred = out[session.outputNames[0]].data;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { if (pred[i] < min) min = pred[i]; if (pred[i] > max) max = pred[i]; }
    const mask = new Float32Array(n);
    const range = max - min || 1;
    for (let i = 0; i < n; i++) mask[i] = (pred[i] - min) / range;
    return mask;
  }

  // Devuelve un canvas 4:5 (como las fotos de la tienda) con el producto sobre el fondo crema.
  async function quitarFondo(source) {
    const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
    const mask = await predictMask(source);

    // Máscara como imagen con transparencia, con borde suave.
    const mc = canvas(SIZE, SIZE);
    const mctx = mc.getContext('2d');
    const mimg = mctx.createImageData(SIZE, SIZE);
    let minX = SIZE, minY = SIZE, maxX = -1, maxY = -1;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const a = Math.min(1, Math.max(0, (mask[i] - 0.15) / 0.6));
      mimg.data[i * 4 + 3] = Math.round(a * 255);
      if (a > 0.5) {
        const x = i % SIZE, y = (i / SIZE) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0 || (maxX - minX) * (maxY - minY) < SIZE * SIZE * 0.01) {
      throw new Error('No encontré bien el producto en la foto. Probá con la cartera más cerca y de frente.');
    }
    mctx.putImageData(mimg, 0, 0);

    // Producto recortado en tamaño real.
    const cut = canvas(sw, sh);
    const cctx = cut.getContext('2d');
    cctx.drawImage(source, 0, 0, sw, sh);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(mc, 0, 0, sw, sh);

    // Recuadro del producto (con un poco de margen) en la foto original.
    const pad = 4;
    const bx = Math.max(0, (minX - pad) / SIZE * sw);
    const by = Math.max(0, (minY - pad) / SIZE * sh);
    const bw = Math.min(sw, (maxX + pad + 1) / SIZE * sw) - bx;
    const bh = Math.min(sh, (maxY + pad + 1) / SIZE * sh) - by;

    // Centrado sobre el crema, con una sombra suave abajo (como foto de estudio).
    const W = 1024, H = 1280;
    const out = canvas(W, H);
    const octx = out.getContext('2d');
    octx.fillStyle = FONDO;
    octx.fillRect(0, 0, W, H);
    const scale = Math.min((W * 0.8) / bw, (H * 0.74) / bh);
    const dw = bw * scale, dh = bh * scale;
    const x = (W - dw) / 2, y = (H - dh) / 2 + H * 0.02;
    const sombra = octx.createRadialGradient(W / 2, y + dh, 0, W / 2, y + dh, dw * 0.55);
    sombra.addColorStop(0, 'rgba(60, 40, 30, 0.22)');
    sombra.addColorStop(1, 'rgba(60, 40, 30, 0)');
    octx.save();
    octx.translate(0, (y + dh) * (1 - 0.18));
    octx.scale(1, 0.18);
    octx.fillStyle = sombra;
    octx.fillRect(0, 0, W, H * 2);
    octx.restore();
    octx.shadowColor = 'rgba(60, 40, 30, 0.18)';
    octx.shadowBlur = 24;
    octx.shadowOffsetY = 10;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cut, bx, by, bw, bh, x, y, dw, dh);
    return out;
  }

  window.CarmesiFondo = { quitarFondo, preparar: getSession };
})();
