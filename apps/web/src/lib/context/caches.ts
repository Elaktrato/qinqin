// The session's caches of server answers (record 0009): one object per
// session, so a new session starts with every one empty and an answer that
// arrives after the end lands in the old object, which nothing reads. The
// classes hold data only; the functions that fill and read each one stay in
// its module (lib/api/audio.ts getEntryAudio(cache, id), ...), which imports
// the class as a type, so a test that mocks that module still gets a session.

import type { AudioResolution } from '../api/audio';
import type { CharacterList, Pending } from '../api/characters';
import type { ComponentIndex } from '../api/components';
import type { StarterEntry } from '../api/frequency';
import type { EntryBase } from '../api/types';
import type { Slot } from '../audio/source';
import type { JournalEntries } from '../plugins/journal/journalEntries.svelte';
import type { SchemeLevelMembers } from '../study/charGroups';
import type { LanguageRanks } from '../study/frequencyRanks';
import type { StrokeResult } from '../study/strokeData';

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

export class SessionCaches {
	readonly audio = new AudioCache();
	readonly characters = new CharacterCache();
	readonly components = new ComponentsCache();
	readonly entryBases = new EntryBasesCache();
	readonly schemes = new SchemeCache();
	readonly clips = new ClipCache();
	readonly starters = new StarterCache();
	readonly levelItems = new LevelItemsCache();
	readonly journalEntries = new JournalEntriesCache();
	readonly providerNames = new ProviderNamesCache();
	readonly written = new WrittenCache();
	readonly ranks = new RanksCache();
	readonly strokes = new StrokeCache();

	/** clear empties every cache (the session end; the clips' object URLs are revoked). */
	clear(): void {
		for (const cache of [
			this.audio,
			this.characters,
			this.components,
			this.entryBases,
			this.schemes,
			this.clips,
			this.starters,
			this.levelItems,
			this.journalEntries,
			this.providerNames,
			this.written,
			this.ranks,
			this.strokes
		]) {
			cache.clear();
		}
	}
}
