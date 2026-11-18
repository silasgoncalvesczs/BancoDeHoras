/**
 * Processamento de imagens opcionais dos lançamentos.
 * A foto é redimensionada e comprimida em JPEG (Blob) antes do upload
 * para o Supabase Storage.
 */
const MAX_SIDE = 960;
const JPEG_QUALITY = 0.68;
/** Limite do bucket entry-images (1 MiB). */
const MAX_BYTES = 1024 * 1024;
const ALLOWED_INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

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
      reject(new Error("Não foi possível ler a imagem. Use JPG, PNG ou WebP."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao processar a imagem."))),
      "image/jpeg",
      quality
    );
  });
}

/** Redimensiona e comprime para um Blob JPEG pronto para upload. */
export async function compressImage(file) {
  const type = String(file?.type || "").toLowerCase();
  if (!file || !ALLOWED_INPUT_TYPES.has(type)) {
    throw new Error("Selecione uma imagem JPG, PNG ou WebP.");
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
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > MAX_BYTES && quality > 0.35) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, quality);
  }

  if (blob.size > MAX_BYTES) {
    throw new Error("A imagem ficou grande demais. Tente uma foto com menor resolução.");
  }

  return blob;
}
