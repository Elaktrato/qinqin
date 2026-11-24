// Which file of a profile picture to draw (docs/contracts/auth/avatar.json):
// the 64 px square while it covers the drawn size in device pixels, else the
// 256 px one. Pure: the caller passes the device pixel ratio.

/** The drawn sizes in CSS pixels: the bar and lists (m), the menu header (l), the settings preview (xl). */
export const AVATAR_PX = { m: 28, l: 36, xl: 96 } as const;

export type AvatarSize = keyof typeof AVATAR_PX;

const SMALL = 64;

/** avatarSrc: the path of the file to fetch for `url` drawn at `cssPx` on a screen of `dpr`. */
export function avatarSrc(url: string, cssPx: number, dpr: number): string {
	const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
	return cssPx * ratio <= SMALL ? `${url}?size=${SMALL}` : url;
}
