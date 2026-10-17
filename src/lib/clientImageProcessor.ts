export type MediaType = "image" | "video";

export interface ProcessedPhoto {
  uid: string;
  file: File;
  thumbBlob: Blob;
  displayBlob: Blob;
  width: number;
  height: number;
  aspectRatio: number;
  previewUrl: string;
  originalName: string;
  timestamp: number;
  type: MediaType;
  duration?: number;
  metadata?: any;
}

/**
 * High-performance 3x3 convolution filter for micro-contrast restoration.
 * Restores crisp edge details lost during downsampling without haloing artifacts.
 */
function applySharpen(ctx: CanvasRenderingContext2D, width: number, height: number, amount = 0.16) {
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const buff = new Uint8ClampedArray(data);

    const kCenter = 1 + 4 * amount;
    const kEdge = -amount;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const res =
            buff[i + c] * kCenter +
            buff[i - 4 + c] * kEdge +
            buff[i + 4 + c] * kEdge +
            buff[i - width * 4 + c] * kEdge +
            buff[i + width * 4 + c] * kEdge;
          data[i + c] = res < 0 ? 0 : res > 255 ? 255 : res;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } catch {
    // Gracefully continue if browser memory/canvas security restricts getImageData
  }
}

/**
 * Shared dual-tier downsampler: renders Retina 3K display & 800px thumbnail blobs
 * from either an HTMLImageElement or HTMLVideoElement frame.
 */
async function renderRetinaAndThumbBlobs(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<{ displayBlob: Blob; thumbBlob: Blob }> {
  // 1. Calculate Retina 3K Display Dimensions (2880px max)
  const maxDisplay = 2880;
  let dWidth = width;
  let dHeight = height;
  if (dWidth > maxDisplay || dHeight > maxDisplay) {
    if (dWidth > dHeight) {
      dHeight = Math.round((dHeight * maxDisplay) / dWidth);
      dWidth = maxDisplay;
    } else {
      dWidth = Math.round((dWidth * maxDisplay) / dHeight);
      dHeight = maxDisplay;
    }
  }

  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = dWidth;
  displayCanvas.height = dHeight;
  const dCtx = displayCanvas.getContext("2d", { willReadFrequently: true });

  if (dCtx) {
    dCtx.imageSmoothingEnabled = true;
    dCtx.imageSmoothingQuality = "high";

    // Multi-step downsampling for high-res originals to prevent aliasing
    if (width > dWidth * 2) {
      const stepCanvas = document.createElement("canvas");
      stepCanvas.width = Math.round(width / 2);
      stepCanvas.height = Math.round(height / 2);
      const sCtx = stepCanvas.getContext("2d");
      if (sCtx) {
        sCtx.imageSmoothingEnabled = true;
        sCtx.imageSmoothingQuality = "high";
        sCtx.drawImage(source, 0, 0, stepCanvas.width, stepCanvas.height);
        dCtx.drawImage(stepCanvas, 0, 0, dWidth, dHeight);
      } else {
        dCtx.drawImage(source, 0, 0, dWidth, dHeight);
      }
    } else {
      dCtx.drawImage(source, 0, 0, dWidth, dHeight);
    }

    applySharpen(dCtx, dWidth, dHeight, 0.16);
  }

  const displayBlob = await new Promise<Blob>((res) =>
    displayCanvas.toBlob((b) => res(b!), "image/webp", 0.92)
  );

  // 2. Calculate Crisp Masonry Thumbnail Dimensions (800px max)
  const maxThumb = 800;
  let tWidth = width;
  let tHeight = height;
  if (tWidth > maxThumb || tHeight > maxThumb) {
    if (tWidth > tHeight) {
      tHeight = Math.round((tHeight * maxThumb) / tWidth);
      tWidth = maxThumb;
    } else {
      tWidth = Math.round((tWidth * maxThumb) / tHeight);
      tHeight = maxThumb;
    }
  }

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = tWidth;
  thumbCanvas.height = tHeight;
  const tCtx = thumbCanvas.getContext("2d", { willReadFrequently: true });

  if (tCtx) {
    tCtx.imageSmoothingEnabled = true;
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(displayCanvas, 0, 0, tWidth, tHeight);
    applySharpen(tCtx, tWidth, tHeight, 0.2);
  }

  const thumbBlob = await new Promise<Blob>((res) =>
    thumbCanvas.toBlob((b) => res(b!), "image/webp", 0.88)
  );

  return { displayBlob, thumbBlob };
}

/**
 * Extracts a crisp poster frame and video duration from video files (MP4, MOV, WebM).
 */
export async function processVideoInBrowser(file: File): Promise<ProcessedPhoto> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;

    video.onloadedmetadata = () => {
      const duration = video.duration || 0;
      // Seek 0.5s into the clip (or 50% if under 1s) to avoid black opening frames
      const targetTime = duration > 1 ? 0.5 : Math.max(0.1, duration / 2);
      video.currentTime = targetTime;
    };

    video.onseeked = async () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (!width || !height) {
          throw new Error("Unable to read video dimensions.");
        }

        const aspectRatio = Number((width / height).toFixed(4));
        const duration = Number(video.duration.toFixed(2));

        const { displayBlob, thumbBlob } = await renderRetinaAndThumbBlobs(video, width, height);

        resolve({
          uid: Math.random().toString(36).substring(2, 9),
          file,
          thumbBlob,
          displayBlob,
          width,
          height,
          aspectRatio,
          previewUrl: objectUrl,
          originalName: file.name,
          timestamp: file.lastModified || Date.now(),
          type: "video",
          duration,
          metadata: {
            lastModified: file.lastModified,
            duration,
            videoWidth: width,
            videoHeight: height,
          },
        });
      } catch (err) {
        reject(err);
      }
    };

    video.onerror = () => {
      reject(new Error(`Failed to decode video file "${file.name}". Format may be unsupported.`));
    };
  });
}

/**
 * Processes a raw camera image into Retina 3K display and high-density thumbnail tiers.
 * Automatically delegates to video processing if a video file is passed.
 */
export async function processImageInBrowser(file: File): Promise<ProcessedPhoto> {
  if (file.type.startsWith("video/")) {
    return processVideoInBrowser(file);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = async () => {
      try {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const aspectRatio = Number((width / height).toFixed(4));

        const { displayBlob, thumbBlob } = await renderRetinaAndThumbBlobs(img, width, height);

        resolve({
          uid: Math.random().toString(36).substring(2, 9),
          file,
          thumbBlob,
          displayBlob,
          width,
          height,
          aspectRatio,
          previewUrl: objectUrl,
          originalName: file.name,
          timestamp: file.lastModified || Date.now(),
          type: "image",
          metadata: {
            lastModified: file.lastModified,
          },
        });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error(`Failed to decode image file "${file.name}".`));
    };

    img.src = objectUrl;
  });
}

/**
 * Universal media processor for both photos and video clips.
 */
export async function processMediaInBrowser(file: File): Promise<ProcessedPhoto> {
  if (file.type.startsWith("video/")) {
    return processVideoInBrowser(file);
  }
  return processImageInBrowser(file);
}
