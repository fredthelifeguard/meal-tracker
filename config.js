// App configuration. Nothing in this file is secret.
// - lookupUrl: address of the Cloudflare Worker that does food lookups. The API keys live there,
//   and it only answers requests that carry the passphrase you enter under Settings.
// - googleClientId: Google OAuth client ID for Drive sync. It only works from the web addresses
//   you authorise for it in Google Cloud.
window.APP_CONFIG = {
  lookupUrl: 'https://meal-tracker-lookup.fredthelifeguard.workers.dev',
  googleClientId: '272531305095-l64v43aagds6opm663ccss08fdkibbns.apps.googleusercontent.com'
};
