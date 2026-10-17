/* The gallery registers no service worker: the live phone (live-chat.tsx) reaches pwa-update.ts through the runtime store. */
export const registerSW = () => () => Promise.resolve();
