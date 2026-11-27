// The setup's "Order of card types" select (#132): its choices and how a
// select value reads back. The rule itself is sessionMix.ts.

import { t } from '$lib/i18n';
import { TYPE_ORDERS, type TypeOrder } from './sessionMix';

/** The select's options, the default (mixed) first. */
export function typeOrderChoices(): { value: TypeOrder; label: string }[] {
	return TYPE_ORDERS.map((value) => ({
		value,
		label: value === 'grouped' ? t('study.typeOrder.grouped') : t('study.typeOrder.mixed')
	}));
}

/** parseTypeOrder reads a select value; anything unknown is the default, mixed. */
export function parseTypeOrder(value: string): TypeOrder {
	return value === 'grouped' ? 'grouped' : 'mixed';
}
