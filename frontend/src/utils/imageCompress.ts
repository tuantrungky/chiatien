export interface CompressedImageResult {
  base64: string;
  mimeType: string;
  sizeKB: number;
  previewUrl: string;
}

function loadImageElement(file: File): Promise<{ img: HTMLImageElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, objectUrl });
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không thể đọc tệp ảnh đã chọn.'));
    };
    img.src = objectUrl;
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality);
}

function estimateBase64Bytes(base64: string): number {
  return Math.ceil((base64.length * 3) / 4);
}

/**
 * Nén ảnh client-side bằng HTML5 Canvas:
 * - Max width = 1200px (giữ nguyên tỷ lệ)
 * - JPEG quality = 0.75 (tự hạ quality xuống 0.6 / 0.45 nếu vẫn vượt 480KB)
 */
export async function compressImageToBase64(
  file: File,
  maxWidth = 1200,
  quality = 0.75
): Promise<CompressedImageResult> {
  const { img, objectUrl } = await loadImageElement(file);

  try {
    let targetWidth = img.naturalWidth || img.width;
    let targetHeight = img.naturalHeight || img.height;

    if (targetWidth > maxWidth) {
      targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
      targetWidth = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ xử lý ảnh Canvas.');
    }
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const qualities = [quality, 0.6, 0.45];
    let dataUrl = '';
    let base64 = '';
    let bytes = 0;

    for (const q of qualities) {
      dataUrl = canvasToDataUrl(canvas, q);
      base64 = dataUrl.split(',')[1] || '';
      bytes = estimateBase64Bytes(base64);
      if (bytes <= 480 * 1024) break;
    }

    return {
      base64,
      mimeType: 'image/jpeg',
      sizeKB: Math.max(1, Math.round(bytes / 1024)),
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
