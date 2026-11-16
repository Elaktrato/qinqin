// The SvelteKit service worker entry: thin on purpose. Every decision lives
// in the tested modules under src/lib/pwa/sw/ (see worker.ts).
import { build, files, version } from '$service-worker';
import { startWorker, type SwScope } from '$lib/pwa/sw/worker';

startWorker(self as unknown as SwScope, { version, build, files });
