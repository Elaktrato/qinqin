// The items of the counter-readings drill (#179): every counter of the table × every number it asks, in table
// order, counter by counter (a counter's pattern is learned in one run); item `<counterId>:<number>`.

import type { DrillItem } from '../types';
import { readingItem } from './items';
import type { CounterReadings, NumberReadings } from './words';

export interface ReadingItemData {
	counter: CounterReadings;
	number: NumberReadings;
}

export function readingItems(counters: readonly CounterReadings[]): DrillItem<ReadingItemData>[] {
	return counters.flatMap((counter) => counter.numbers.map((number) => ({ key: readingItem(counter.id, number.number), data: { counter, number } })));
}
