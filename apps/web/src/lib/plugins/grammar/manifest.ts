// The grammar plugin's manifest: a page-only plugin at /p/grammar.
import grammar from '$builtin/grammar.json';
import type { ContractManifest } from '../contract';
import type { PluginManifest } from '../index';

export const grammarManifest: PluginManifest = grammar as unknown as ContractManifest;
