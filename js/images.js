/**
 * Processamento de imagens opcionais dos lançamentos.
 * Imagens vão comprimidas (JPEG data URL) no Firestore — sem depender do Storage.
 */
const MAX_SIDE = 960;
const JPEG_QUALITY = 0.68;
/** Limite seguro abaixo de 1 MB do documento Firestore. */
const MAX_DATA_URL_CHARS = 750000;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem. Tente outro arquivo (JPG/PNG)."));
    };
    img.src = url;
  });
}

function canvasToDataUrl(canvas, quality) {
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Redimensiona e comprime para data URL JPEG (pronta para salvar no Firestore).
 */
export async function compressImageToDataUrl(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Selecione um arquivo de imagem.");
  }

  const img = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height || 1));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Falha ao processar a imagem.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = JPEG_QUALITY;
  let dataUrl = canvasToDataUrl(canvas, quality);

  while (dataUrl.length > MAX_DATA_URL_CHARS && quality > 0.35) {
    quality -= 0.08;
    dataUrl = canvasToDataUrl(canvas, quality);
  }

  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error("A imagem ficou grande demais. Tente uma foto com menor resolução.");
  }

  return dataUrl;
}

/** Converte data URL em Blob (preview local). */
export function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl).split(",");
  const mime = /data:([^;]+);base64/.exec(header)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
