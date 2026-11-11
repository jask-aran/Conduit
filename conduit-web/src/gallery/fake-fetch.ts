// Every request answers empty, so a component that loads its own data mounts blank instead of bouncing to sign-in.
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
