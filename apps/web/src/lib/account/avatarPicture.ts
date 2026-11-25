// Draws the chosen square of a picture into the PNG that is uploaded
// (#189). The browser has already applied the photo's EXIF orientation when
// it decoded the picture; the server decodes and re-encodes the PNG again.

import type { sourceRect } from './avatarCrop';

/** The side of the uploaded square: room for the server's 256 px file at any crop. */
export const OUTPUT_PX = 512;

/** cropToBlob draws `rect` of `picture` at OUTPUT_PX × OUTPUT_PX and encodes it as PNG. */
export function cropToBlob(picture: CanvasImageSource, rect: ReturnType<typeof sourceRect>, doc: Document = document): Promise<Blob> {
	const canvas = doc.createElement('canvas');
	canvas.width = canvas.height = OUTPUT_PX;
	const ctx = canvas.getContext('2d');
	if (!ctx) return Promise.reject(new Error('avatar: no 2d canvas'));
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(picture, rect.sx, rect.sy, rect.size, rect.size, 0, 0, OUTPUT_PX, OUTPUT_PX);
	return new Promise((resolve, reject) =>
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('avatar: the canvas gave no picture'))), 'image/png')
	);
}
