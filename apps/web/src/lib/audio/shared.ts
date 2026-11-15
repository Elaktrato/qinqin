import { createPlayer, type Player } from './player';
import { clipObjectUrl, readyClipUrl } from './source';

let shared: Player | null = null;

/** getPlayer is the one player of the app (created on first use, browser only). */
export function getPlayer(): Player {
	shared ??= createPlayer(undefined, undefined, clipObjectUrl, readyClipUrl);
	return shared;
}
