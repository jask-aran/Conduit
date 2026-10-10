/*
 * The gallery's entry. The canvas is one page; each phone frame on it is an
 * iframe of this page with ?frame=<id>, which must pass for a phone before
 * any app module asks: the app's phone layout needs a narrow, touch-only
 * screen, and a desktop browser's frame is only narrow.
 */
import { emulatePhone } from "./phone-emulation";
import { fakeMicrophone } from "./fake-mic";
import { fakeSockets } from "./fake-socket";
import { fakeFetch } from "./fake-fetch";

const frame = new URLSearchParams(location.search).get("frame");
fakeMicrophone();
fakeSockets();
fakeFetch();
if (frame) emulatePhone();
void import("./canvas").then((module) => module.mount(frame));
