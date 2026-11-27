// The session's caches of server answers (record 0009): one object per
// session, so a new session starts with every one empty and an answer that
// arrives after the end lands in the old object, which nothing reads. The
// classes hold data only; the functions that fill and read each one stay in
// its module (lib/api/audio.ts getEntryAudio(cache, id), ...), which imports
// the class as a type, so a test that mocks that module still gets a session.

import { PictureCache } from '../aids/pictures';
import type { AudioResolution } from '../api/audio';
import type { CharacterList, Pending } from '../api/characters';
import type { ComponentIndex } from '../api/components';
import type { StarterEntry } from '../api/frequency';
import type { EntryBase } from '../api/types';
import type { Slot } from '../audio/source';
import type { JournalEntries } from '../features/journal/journalEntries.svelte';
import type { SchemeLevelMembers } from '$lib/studycore/charGroups';
import type { LanguageRanks } from '$lib/features/flashcards/session/frequencyRanks';
import type { StrokeResult } from '$lib/writing/strokeData';
import type { SeenMilestone } from '../milestones/seen';
import type { Reached } from '../milestones/reached';
import type { Timelines } from '../weekly/replay';
import type { WeekPasses } from '../weekly/summary';
import type { WidgetOptions } from '../widgets/options';

/** AudioCache: a per-session cache (record 0009). */
export class AudioCache {
	readonly cache = new Map<number, AudioResolution>();
	readonly pending = new Map<number, Promise<AudioResolution>>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.cache.clear();
		this.pending.clear();
	}
}


/** CharacterCache: a per-session cache (record 0009). */
export class CharacterCache {
	readonly loaded = new Map<string, CharacterList>();
	readonly inFlight = new Map<string, Pending>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.loaded.clear();
		this.inFlight.clear();
	}
}


/** ComponentsCache: a per-session cache (record 0009). */
export class ComponentsCache {
	readonly loaded = new Map<string, ComponentIndex>();
	readonly inFlight = new Map<string, Promise<ComponentIndex>>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.loaded.clear();
		this.inFlight.clear();
	}
}


/** EntryBasesCache: a per-session cache (record 0009). */
export class EntryBasesCache {
	readonly cache = new Map<number, EntryBase>();
	readonly inflight = new Map<number, Promise<void>>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.cache.clear();
		this.inflight.clear();
	}
}


/** SchemeCache: a per-session cache (record 0009). */
export class SchemeCache {
	readonly loadedSchemes = new Map<number, SchemeLevelMembers[]>();
	readonly pendingSchemes = new Map<number, Promise<SchemeLevelMembers[]>>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.loadedSchemes.clear();
		this.pendingSchemes.clear();
	}
}


/** ClipCache: the session's fetched clips (record 0009); its end revokes their object URLs. */
export class ClipCache {
	readonly slots = new Map<string, Slot>();

	/** clear revokes and forgets every clip (the session end). */
	clear(): void {
		for (const slot of this.slots.values()) if (slot.url) URL.revokeObjectURL(slot.url);
		this.slots.clear();
	}
}


/** AvatarCache: the session's profile pictures by file path (record 0009); its end revokes their object URLs. */
export class AvatarCache {
	readonly slots = new Map<string, { promise: Promise<string>; url?: string }>();

	/** clear revokes and forgets every picture (the session end). */
	clear(): void {
		for (const slot of this.slots.values()) if (slot.url) URL.revokeObjectURL(slot.url);
		this.slots.clear();
	}
}


/** StarterCache: a per-session cache (record 0009). */
export class StarterCache {
	readonly cache = new Map<string, Promise<StarterEntry[]>>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.cache.clear();
	}
}


/** LevelItemsCache: the session's loaded levels and its request slots (record 0009). */
export class LevelItemsCache {
	readonly loaded = new Map<string, EntryBase[]>();
	readonly inflight = new Map<string, Promise<EntryBase[]>>();
	readonly waiting: (() => void)[] = [];
	running = 0;

	clear(): void {
		this.loaded.clear();
		this.inflight.clear();
	}
}


/** JournalEntriesCache: the session's column stores, one per workspace (record 0009). */
export class JournalEntriesCache {
	readonly stores = new Map<number, JournalEntries>();

	clear(): void {
		this.stores.clear();
	}
}


/** ProviderNamesCache: the session's one answer (record 0009). */
export class ProviderNamesCache {
	names: Promise<Map<string, string>> | null = null;

	clear(): void {
		this.names = null;
	}
}


/** WrittenCache: a per-session cache (record 0009). */
export class WrittenCache {
	readonly writtenByEntry = new Map<number, string | null>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.writtenByEntry.clear();
	}
}


/** RanksCache: a per-session cache (record 0009). */
export class RanksCache {
	readonly byLanguage = new Map<string, LanguageRanks>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.byLanguage.clear();
	}
}


/** StrokeCache: a per-session cache (record 0009). */
export class StrokeCache {
	readonly cache = new Map<string, Promise<StrokeResult>>();

	/** clear forgets everything (the session end). */
	clear(): void {
		this.cache.clear();
	}
}

/**
 * MilestoneFlushes: the session's flush throttle of seen milestones and the
 * last load's place (its user, workspace and live rows: an `online` flush never
 * rewrites a live row), and whether its `online` listener is installed.
 */
export class MilestoneFlushes {
	readonly last = new Map<string, number>();
	place: { user: number; workspaceId: number; live: ReadonlyMap<string, SeenMilestone>; tombstones: ReadonlyMap<string, string> } | null = null;
	hooked = false;

	clear(): void {
		this.last.clear();
		this.place = null;
	}
}

/** HomeCache: Home's own setup, held for the session (widgets/homeData.ts, #290). */
export class HomeCache {
	/** The stored layout (ids, or null for the default), once read. */
	layout: { ids: string[] | null } | null = null;
	options: WidgetOptions | null = null;

	clear(): void {
		this.layout = null;
		this.options = null;
	}
}

/** HeldValues: the last value each widget showed, by widget and workspace (widgets/widgetLoad.svelte.ts, #290). */
export class HeldValues {
	readonly values = new Map<string, unknown>();

	clear(): void {
		this.values.clear();
	}
}

export class SessionCaches {
	/** Weekly replay timelines by log content (weekly/replay.ts timelinesFor). */
	readonly timelines = new Map<string, Timelines>();
	/** The week summary's log passes (weekly/summary.ts). */
	readonly weekPasses: WeekPasses = new Map();
	/** Reached milestones by log content (milestones/reached.ts reachedFromLog). */
	readonly reached = new Map<string, Reached[]>();
	/** The day of the last `journal` event per entry (one per entry per day; the journal's EntryEditor). */
	readonly journalSent = new Map<string, string>();
	/** Seen-milestone flushes (milestones/loadMilestones.ts). */
	readonly milestones = new MilestoneFlushes();
	/** Goal loads in flight, by workspace, day and force (goals/loadGoal.ts). */
	readonly goals = new Map<string, Promise<unknown>>();
	readonly audio = new AudioCache();
	readonly characters = new CharacterCache();
	readonly components = new ComponentsCache();
	readonly entryBases = new EntryBasesCache();
	readonly schemes = new SchemeCache();
	readonly clips = new ClipCache();
	/** Profile pictures (api/avatar.ts avatarObjectUrl). */
	readonly avatars = new AvatarCache();
	readonly starters = new StarterCache();
	readonly levelItems = new LevelItemsCache();
	readonly journalEntries = new JournalEntriesCache();
	readonly providerNames = new ProviderNamesCache();
	readonly written = new WrittenCache();
	readonly ranks = new RanksCache();
	readonly strokes = new StrokeCache();
	/** The pictures of entries for the visual aids (aids/pictures.ts). */
	readonly pictures = new PictureCache();
	/** Home's layout and widget options (widgets/homeData.ts). */
	readonly home = new HomeCache();
	/** The widgets' last values (widgets/widgetLoad.svelte.ts). */
	readonly held = new HeldValues();

	/** clear empties every cache (the session end; the clips' object URLs are revoked). */
	clear(): void {
		this.goals.clear();
		this.journalSent.clear();
		this.timelines.clear();
		this.weekPasses.clear();
		this.reached.clear();
		this.milestones.clear();
		for (const cache of [
			this.audio,
			this.characters,
			this.components,
			this.entryBases,
			this.schemes,
			this.clips,
			this.avatars,
			this.starters,
			this.levelItems,
			this.journalEntries,
			this.providerNames,
			this.written,
			this.ranks,
			this.strokes,
			this.pictures,
			this.home,
			this.held
		]) {
			cache.clear();
		}
	}
}
