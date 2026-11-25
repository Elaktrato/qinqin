// The reminder plan (#137): GET /api/reminders/plan, a thin tolerant parser. The computation is the server's
// (docs/contracts/reminders/README.md "The plan"); the client only shows or schedules the slots it is given.

import { api } from '../api/client';
import type { MessageKey } from '$lib/i18n';
import type { ReminderKind } from './settings';

export interface PlanSlot {
	id: number;
	kind: ReminderKind;
	/** An RFC 3339 instant. */
	at: string;
	/** The local wall time in the learner's zone, "YYYY-MM-DDTHH:MM". */
	local: string;
	/** The learner day, "YYYY-MM-DD". */
	day: string;
	/** Due cards (due), streak days (streak), null (goal). */
	count: number | null;
}

export interface ReminderPlan {
	generatedAt: string;
	zone: string;
	enabled: boolean;
	channels: { email: boolean; push: boolean; device: boolean };
	available: { email: boolean; push: boolean };
	slots: PlanSlot[];
}

const KINDS: readonly string[] = ['due', 'goal', 'streak'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSlot(raw: unknown): PlanSlot | null {
	if (!isRecord(raw)) return null;
	const { id, kind, at, local, day, count } = raw;
	if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
	if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
	if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
	if (typeof local !== 'string' || typeof day !== 'string') return null;
	if (count !== null && !(typeof count === 'number' && Number.isInteger(count) && count >= 0)) return null;
	return { id, kind: kind as ReminderKind, at, local, day, count };
}

const flag = (o: unknown, k: string): boolean => isRecord(o) && o[k] === true;

/** parsePlan reads the answer; unknown fields are ignored, a slot that is off shape (or of a newer kind) is dropped. */
export function parsePlan(raw: unknown): ReminderPlan | null {
	if (!isRecord(raw)) return null;
	return {
		generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
		zone: typeof raw.zone === 'string' ? raw.zone : '',
		enabled: raw.enabled === true,
		channels: { email: flag(raw.channels, 'email'), push: flag(raw.channels, 'push'), device: flag(raw.channels, 'device') },
		available: { email: flag(raw.available, 'email'), push: flag(raw.available, 'push') },
		slots: (Array.isArray(raw.slots) ? raw.slots : []).flatMap((s) => {
			const slot = parseSlot(s);
			return slot === null ? [] : [slot];
		})
	};
}

/** fetchPlan loads the plan for the next `days` (1..14) days. Errors reject. */
export async function fetchPlan(days: number): Promise<ReminderPlan> {
	const n = Math.min(14, Math.max(1, Math.trunc(days)));
	const plan = parsePlan(await api<unknown>(`/api/reminders/plan?days=${n}`));
	if (plan === null) throw new Error('reminders: the plan answer is not an object');
	return plan;
}

export interface SlotText {
	titleKey: MessageKey;
	bodyKey: MessageKey;
	count: number;
}

const TEXT: Record<ReminderKind, { titleKey: MessageKey; bodyKey: MessageKey }> = {
	due: { titleKey: 'settings.reminders.notify.due.title', bodyKey: 'settings.reminders.notify.due.body' },
	goal: { titleKey: 'settings.reminders.notify.goal.title', bodyKey: 'settings.reminders.notify.goal.body' },
	streak: { titleKey: 'settings.reminders.notify.streak.title', bodyKey: 'settings.reminders.notify.streak.body' }
};

/** slotText: the catalogue keys of a slot's notification and the count they take (0 for a goal slot). */
export function slotText(slot: Pick<PlanSlot, 'kind' | 'count'>): SlotText {
	return { ...TEXT[slot.kind], count: slot.count ?? 0 };
}
