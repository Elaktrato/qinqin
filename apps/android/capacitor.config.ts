import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapacitorConfig } from '@capacitor/cli';

// appId and appName: identity.json, the single place (a PLACEHOLDER the owner confirms).
const identity = JSON.parse(readFileSync(join(__dirname, 'identity.json'), 'utf8')) as { appId: string; appName: string };

// No `server.url`: the server is the person's own and is entered at run time (MainActivity builds the
// config from the saved address). webDir holds only the first-run screen (npm run build:web).
const config: CapacitorConfig = {
	appId: identity.appId,
	appName: identity.appName,
	webDir: 'www',
	android: {
		allowMixedContent: false
	}
};

export default config;
