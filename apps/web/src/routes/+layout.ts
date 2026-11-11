// The whole app is a client-side SPA served by the Go binary: no server
// rendering, no prerendering, so every route is an entry into the router.
export const ssr = false;
export const prerender = false;
