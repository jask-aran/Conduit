/*
 * Nothing in the gallery talks to a server: every request to the app's API
 * answers empty, so a component that loads its own data (the sidebar's
 * server list, settings) mounts blank instead of bouncing to the sign-in page.
 */
export function fakeFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin === location.origin && /^\/(v0|api|auth)\b/.test(url.pathname)) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return real(input, init);
  };
}
