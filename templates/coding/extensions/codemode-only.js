// Pi's codemode with every other tool reached only through scripts
// (codemode.mode "only"), for this profile alone rather than every Pi chat.
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";

export default createCodemodeExtension({ mode: "only" });
