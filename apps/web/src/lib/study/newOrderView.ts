// What the study setup and the deck settings offer for the order of new
// cards (#75), and the notes a session shows when an order cannot run.
// The frequency choice exists only when a frequency pack of the workspace
// language is installed; no data is bundled, so the hint points to the
// administrator's Settings, Data page and the licence page — never to a
// download. Components stay thin: every decision is here.

import type { FrequencyPack, Scheme } from '$lib/api/types';
import { languageLabel } from '$lib/languages';
import { parseNewOrder, type NewOrder, type SessionNewOrder } from './newOrder';

export interface OrderChoice {
	value: string;
	label: string;
}

export const MIXED_NOTE = 'Your decks use different orders: in the order added.';
export const OFFLINE_NOTE = 'Frequency order needs a connection; using the order added.';
export const MISSING_LEVELS_NOTE =
	'The level list of this order is not installed; using the order added.';

/** encodeOrder turns an order into a select value. */
export function encodeOrder(order: SessionNewOrder): string {
	if (order === 'deck') return 'deck';
	return order.by === 'level' ? `level:${order.packId}` : order.by;
}

/** decodeOrder reads a select value; anything unknown is 'deck'. */
export function decodeOrder(value: string): SessionNewOrder {
	if (value.startsWith('level:')) {
		return parseNewOrder({ by: 'level', packId: value.slice('level:'.length) }) ?? 'deck';
	}
	return parseNewOrder({ by: value }) ?? 'deck';
}

/** rankingPack is the language's first installed pack (the server lists them by priority). */
export function rankingPack(
	packs: readonly FrequencyPack[],
	language: string
): FrequencyPack | null {
	const code = language.toLowerCase();
	return packs.find((pack) => pack.language.toLowerCase() === code) ?? null;
}

export function noPackHint(language: string): string {
	return `No frequency list is installed for ${languageLabel(language)}. An administrator can add one in Settings, Data; see Data and licences.`;
}

function frequencyChoice(pack: FrequencyPack): OrderChoice {
	return { value: 'frequency', label: `Most frequent first (${pack.name})` };
}

function levelChoices(schemes: readonly Scheme[], language: string): OrderChoice[] {
	const code = language.toLowerCase();
	return schemes
		.filter((scheme) => scheme.language.toLowerCase() === code && scheme.packId)
		.map((scheme) => ({ value: `level:${scheme.packId}`, label: `By level: ${scheme.name}` }));
}

export interface OrderEnv {
	language: string;
	packs: readonly FrequencyPack[];
	schemes: readonly Scheme[];
}

/**
 * sessionOrderChoices: the setup's choices. A deck session may follow the
 * decks, the order added, frequency or a level list; a level session keeps
 * level order or, for a word scheme, most frequent first (word frequency
 * does not rank characters).
 */
export function sessionOrderChoices(
	env: OrderEnv & { mode: 'decks' | 'levels'; levelScheme?: Scheme | null }
): { choices: OrderChoice[]; hint: string | null } {
	const pack = rankingPack(env.packs, env.language);
	const hint = pack === null ? noPackHint(env.language) : null;
	if (env.mode === 'levels') {
		const choices: OrderChoice[] = [{ value: 'deck', label: 'Level order' }];
		if (pack !== null && env.levelScheme?.unit === 'word') choices.push(frequencyChoice(pack));
		return { choices, hint };
	}
	const choices: OrderChoice[] = [
		{ value: 'deck', label: 'As each deck is set' },
		{ value: 'added', label: 'In the order added' }
	];
	if (pack !== null) choices.push(frequencyChoice(pack));
	choices.push(...levelChoices(env.schemes, env.language));
	return { choices, hint };
}

/** deckOrderChoices: the deck settings' choices. */
export function deckOrderChoices(env: OrderEnv): { choices: OrderChoice[]; hint: string | null } {
	const pack = rankingPack(env.packs, env.language);
	const choices: OrderChoice[] = [{ value: 'added', label: 'In the order added' }];
	if (pack !== null) choices.push(frequencyChoice(pack));
	choices.push(...levelChoices(env.schemes, env.language));
	return { choices, hint: pack === null ? noPackHint(env.language) : null };
}

/**
 * resolveAvailableOrder: a stored order whose data is gone (the pack or
 * the scheme was uninstalled later) behaves as added and says so once.
 */
export function resolveAvailableOrder(
	order: NewOrder,
	env: OrderEnv
): { order: NewOrder; note: string | null } {
	if (order.by === 'frequency' && rankingPack(env.packs, env.language) === null) {
		return {
			order: { by: 'added' },
			note: `No frequency list is installed for ${languageLabel(env.language)}; using the order added.`
		};
	}
	if (order.by === 'level') {
		const code = env.language.toLowerCase();
		const found = env.schemes.some(
			(s) => s.packId === order.packId && s.language.toLowerCase() === code
		);
		if (!found) return { order: { by: 'added' }, note: MISSING_LEVELS_NOTE };
	}
	return { order, note: null };
}
