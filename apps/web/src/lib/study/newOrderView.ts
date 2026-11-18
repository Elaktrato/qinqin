// What the study setup and the deck settings offer for the order of new
// cards (#75), and the notes a session shows when an order cannot run.
// The frequency choice exists only when a frequency pack of the workspace
// language is installed; no data is bundled, so the hint points to the
// administrator's Settings, Data page and the licence page — never to a
// download. Components stay thin: every decision is here.

import type { FrequencyPack, Scheme } from '$lib/api/types';
import { t } from '$lib/i18n';
import { languageLabel } from '$lib/languages';
import { ADDED, parseNewOrder, type NewOrder, type SessionNewOrder } from './newOrder';

export interface OrderChoice {
	value: string;
	label: string;
}

export function mixedNote(): string {
	return t('study.order.mixed');
}
export function offlineNote(): string {
	return t('study.order.offline');
}
export function missingLevelsNote(): string {
	return t('study.order.missingLevels');
}

/** encodeOrder turns an order into a select value. */
export function encodeOrder(order: SessionNewOrder): string {
	if (order === 'deck' || order === 'random') return order;
	return order.by === 'level' ? `level:${order.packId}` : order.by;
}

/** decodeOrder reads a select value; anything unknown is 'deck'. */
export function decodeOrder(value: string): SessionNewOrder {
	if (value.startsWith('level:')) {
		return parseNewOrder({ by: 'level', packId: value.slice('level:'.length) }) ?? 'deck';
	}
	if (value === 'random') return 'random';
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
	return t('study.order.noPack', { language: languageLabel(language) });
}

function frequencyChoice(pack: FrequencyPack): OrderChoice {
	return { value: 'frequency', label: t('study.order.frequencyPack', { pack: pack.name }) };
}

function levelChoices(schemes: readonly Scheme[], language: string): OrderChoice[] {
	const code = language.toLowerCase();
	return schemes
		.filter((scheme) => scheme.language.toLowerCase() === code && scheme.packId)
		.map((scheme) => ({ value: `level:${scheme.packId}`, label: t('study.order.byLevel', { scheme: scheme.name }) }));
}

export interface OrderEnv {
	language: string;
	packs: readonly FrequencyPack[];
	schemes: readonly Scheme[];
}

/**
 * sessionOrderChoices: the setup's choices. A deck session may follow the
 * decks, random (the default), the order added, frequency or a level list; a level session keeps
 * level order or, for a word scheme, most frequent first (word frequency
 * does not rank characters).
 */
export function sessionOrderChoices(
	env: OrderEnv & { mode: 'decks' | 'levels'; levelScheme?: Scheme | null }
): { choices: OrderChoice[]; hint: string | null } {
	const pack = rankingPack(env.packs, env.language);
	const hint = pack === null ? noPackHint(env.language) : null;
	if (env.mode === 'levels') {
		const choices: OrderChoice[] = [
			{ value: 'random', label: t('study.order.randomLevel') },
			{ value: 'deck', label: t('study.order.levelOrder') }
		];
		if (pack !== null && env.levelScheme?.unit === 'word') choices.push(frequencyChoice(pack));
		return { choices, hint };
	}
	const choices: OrderChoice[] = [
		{ value: 'random', label: t('study.order.random') },
		{ value: 'deck', label: t('study.order.asDeck') },
		{ value: 'added', label: t('study.order.added') }
	];
	if (pack !== null) choices.push(frequencyChoice(pack));
	choices.push(...levelChoices(env.schemes, env.language));
	return { choices, hint };
}

/** deckOrderChoices: the deck settings' choices. */
export function deckOrderChoices(env: OrderEnv): { choices: OrderChoice[]; hint: string | null } {
	const pack = rankingPack(env.packs, env.language);
	const choices: OrderChoice[] = [{ value: 'added', label: t('study.order.added') }];
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
			note: t('study.order.noPackFallback', { language: languageLabel(env.language) })
		};
	}
	if (order.by === 'level') {
		const code = env.language.toLowerCase();
		const found = env.schemes.some(
			(s) => s.packId === order.packId && s.language.toLowerCase() === code
		);
		if (!found) return { order: { by: 'added' }, note: missingLevelsNote() };
	}
	return { order, note: null };
}

export interface ControlChoice extends OrderChoice {
	disabled?: boolean;
}

function orderLabel(order: NewOrder): string {
	if (order.by === 'frequency') return t('study.order.frequency');
	if (order.by === 'level') return t('study.order.byLevel', { scheme: order.packId });
	return t('study.order.added');
}

/**
 * deckOrderControl: the deck settings' select. While the pack and scheme
 * lists load (env null) or after one failed, the select is disabled and
 * shows the stored order, so touching it can never overwrite the setting
 * with "added". A stored order this server cannot run stays selected as a
 * disabled "(not available)" choice until the learner picks another.
 */
export function deckOrderControl(input: {
	stored: NewOrder | null;
	env: OrderEnv | null;
	failed: boolean;
}): { choices: ControlChoice[]; value: string; disabled: boolean; hint: string | null } {
	const stored = input.stored ?? ADDED;
	const value = encodeOrder(stored);
	if (input.env === null || input.failed) {
		return {
			choices: [{ value, label: orderLabel(stored), disabled: true }],
			value,
			disabled: true,
			hint: input.failed ? t('study.order.loadFailed') : null
		};
	}
	const { choices, hint } = deckOrderChoices(input.env);
	const out: ControlChoice[] = [...choices];
	if (!choices.some((c) => c.value === value)) {
		out.push({ value, label: t('study.order.notAvailable', { order: orderLabel(stored) }), disabled: true });
	}
	return { choices: out, value, disabled: false, hint };
}
