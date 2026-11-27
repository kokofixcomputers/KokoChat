/** The one address whose front page is the landing page; everywhere else the app opens straight away. */
const LANDING_HOST = 'chat.kokodev.cc'

/** Only the root: shared chats and sign-in callbacks on the same address still work. `?app` opens the app there too. */
export const showsLanding = (loc: { hostname: string; pathname: string; search: string }) =>
  loc.hostname === LANDING_HOST && loc.pathname === '/' && !new URLSearchParams(loc.search).has('app')

/** The app lives on the `app.` subdomain of whatever address this is. */
export const appUrl = () => `https://app.${location.host}`
