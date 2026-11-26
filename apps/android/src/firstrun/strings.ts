// Every string of the first-run screen, in one object so it can be translated later (English only for now;
// the web app's own catalogue, apps/web/src/lib/i18n, is not reachable from a bundle that ships in the APK).

export const S = {
	title: 'Connect to your server',
	intro: 'qinqin runs on your own server. Enter its address to continue.',
	addressLabel: 'Server address',
	addressHint: 'For example https://qinqin.example.org',
	connect: 'Connect',
	checking: 'Checking the server…',
	open: 'Open qinqin',
	retry: 'Try again',
	changeServer: 'Change server',
	useAddress: (address: string) => `Use ${address}`,
	connected: (version: string) => `Found qinqin ${version}.`,
	cleartextWarning:
		'This address uses plain http. Anyone on your network could read what you send, including your password. Use it only on a network you trust, or put the server behind https.',
	droppedPath: (address: string) => `Only the server's address is used: ${address}.`,
	problem: {
		empty: 'Enter the address of your qinqin server.',
		invalid: 'That is not a valid address.',
		scheme: 'Only https addresses work (or http on your own network).',
		credentials: 'Leave the user name and password out of the address.',
		insecurePublic: 'A server on the internet must use https. Plain http works only for addresses on your own network.'
	},
	failure: {
		unreachable: 'Could not reach the server. Check the address and your connection.',
		timeout: 'The server did not answer in time.',
		tls: "The server's certificate is not trusted by this phone. Check the address, or install the certificate authority that signed it (Settings, Security, Encryption and credentials, Install a certificate, CA certificate).",
		notQinqin: 'That address answers, but it is not a qinqin server (or it runs a version older than 0.7).',
		redirect: (target: string) => `The address redirects to ${target}.`
	},
	savedFailure: {
		unreachable: (address: string) => `Could not reach ${address}. Check your connection or the server.`,
		timeout: (address: string) => `${address} did not answer in time.`,
		tls: (address: string) => `The certificate of ${address} is not trusted by this phone.`,
		notQinqin: (address: string) => `${address} answers, but not like a qinqin server (an error page, a login or parked page). Try again, or change the server.`,
		webview: (address: string) => `Android System WebView on this phone is too old to open ${address} safely. Update Android System WebView (Play Store), then try again.`
	},
	compat: {
		shellOutdated: 'This app is older than the server expects. Some features may not work until you update the app.',
		serverOutdated: 'This server is older than this app. Everything should work, but the server may lack newer features.',
		missing: (features: string) => `Missing in this app: ${features}.`
	}
} as const;
