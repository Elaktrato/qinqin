// Decks a plugin ships (starter decks, #75, will be the first). A separate
// module so nothing under decks/ imports lib/plugins/index.ts, which imports
// the page. No plugin ships one in v0.3.0.

import type { SystemDeckDef } from './systemDecks';

export interface PluginDeckProvider {
	pluginId: string;
	load(): Promise<SystemDeckDef[]>;
}

export const pluginDeckProviders: PluginDeckProvider[] = [];
