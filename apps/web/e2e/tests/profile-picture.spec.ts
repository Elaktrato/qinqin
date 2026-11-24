// The profile picture (#189): a learner uploads a photo in Settings →
// Account, crops it, saves it and sees it in the top bar; the server keeps
// a fresh square JPEG; removing it brings the letter back.

import { deflateSync } from 'node:zlib';
import { expect, test } from '../support/fixtures';

/** A w×h PNG: red on the left half, blue on the right (no dependencies). */
function png(w: number, h: number): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (b: Buffer) => {
		let c = 0xffffffff;
		for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	const rows = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const at = y * (w * 3 + 1) + 1 + x * 3;
			if (x < w / 2) rows[at] = 220;
			else rows[at + 2] = 220;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('tEXt', Buffer.from('Comment\0e2e secret text', 'latin1')),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

test('a learner uploads a profile picture and sees it in the top bar', async ({ page, learner, server }) => {
	await page.goto('/settings?tab=account');
	const accountMenu = page.getByRole('button', { name: 'Account menu' });
	await expect(accountMenu).toContainText(learner.username[0].toUpperCase());
	await expect(accountMenu.locator('img')).toHaveCount(0);

	await page.locator('input[type="file"][accept^="image/"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(300, 200) });
	const crop = page.getByRole('application', { name: 'Crop your picture' });
	await expect(crop).toBeFocused();
	await crop.press('+');
	await crop.press('ArrowLeft');
	await page.getByRole('button', { name: 'Save picture' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Profile picture saved.' })).toBeVisible();

	// The top bar shows the picture, decoded by the browser.
	const barPicture = accountMenu.locator('img');
	await expect(barPicture).toBeVisible();
	await expect.poll(() => barPicture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);

	// On the server: a fresh 256 px JPEG without the uploaded text chunk, for signed-in users only.
	const me = await learner.api.get<{ avatarUrl: string | null }>('/api/auth/me');
	expect(me.avatarUrl).toMatch(/^\/api\/avatars\/\d+\/[0-9a-f]{32}$/);
	const file = await fetch(server.url + me.avatarUrl, { headers: { authorization: `Bearer ${learner.api.token}` } });
	expect(file.status).toBe(200);
	expect(file.headers.get('content-type')).toBe('image/jpeg');
	expect(file.headers.get('cache-control')).toBe('private, no-cache');
	const bytes = Buffer.from(await file.arrayBuffer());
	expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
	expect(bytes.includes(Buffer.from('e2e secret text'))).toBe(false);
	expect((await fetch(server.url + me.avatarUrl)).status).toBe(401);

	// Remove: the letter comes back.
	await page.getByRole('button', { name: 'Remove picture' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Profile picture removed.' })).toBeVisible();
	await expect(accountMenu.locator('img')).toHaveCount(0);
	await expect(accountMenu).toContainText(learner.username[0].toUpperCase());
	expect((await learner.api.get<{ avatarUrl: string | null }>('/api/auth/me')).avatarUrl).toBeNull();
});
