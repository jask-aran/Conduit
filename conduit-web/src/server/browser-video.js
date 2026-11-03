import { spawn } from "node:child_process";

const QUIET_MS = 12;
const REPEAT_MS = 60;

/** One encoder per viewer. A blocked pipe drops input rather than retaining old pictures. */
export function browserVideo({ binary, codec, fps, send, fallback }) {
  let encoder = null;
  let size = null;
  let blocked = false;
  let stopped = false;
  let repeat = null;
  const stop = () => {
    const child = encoder;
    encoder = null;
    child?.stdin.destroy();
    child?.stdout.destroy();
    child?.kill();
  };
  const fail = () => {
    if (stopped) return;
    stopped = true;
    stop();
    fallback();
  };
  const start = (width, height) => {
    stop();
    size = { width, height };
    blocked = false;
    const hevc = codec === "h265";
    // Bound input probing and flush each output packet so quiet pages do not wait for an I/O buffer to fill.
    const child = spawn(binary, ["-probesize", "32", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-",
      "-an", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", hevc ? "libx265" : "libx264",
      "-preset", "ultrafast", "-tune", "zerolatency",
      ...(hevc ? ["-x265-params", `bframes=0:keyint=${2 * fps}:repeat-headers=1`] : ["-bf", "0", "-g", String(2 * fps)]),
      "-pix_fmt", "yuv420p", "-bsf:v", hevc ? "hevc_metadata=aud=insert" : "h264_metadata=aud=insert",
      "-flush_packets", "1", "-f", hevc ? "hevc" : "h264", "-"], { stdio: ["pipe", "pipe", "ignore"] });
    encoder = child;
    let bytes = Buffer.alloc(0);
    let scanned = 0;
    let aud = -1;
    let quiet = null;
    const emit = (unit) => {
      let key = false;
      for (let i = 0; i + 3 < unit.length; i++) {
        if (unit[i] || unit[i + 1] || unit[i + 2] !== 1) continue;
        const type = hevc ? (unit[i + 3] >> 1) & 63 : unit[i + 3] & 31;
        if (hevc ? type >= 16 && type <= 21 : type === 5) key = true;
      }
      const header = Buffer.alloc(5);
      header[0] = key ? 1 : 0;
      header.writeUInt16BE(width, 1);
      header.writeUInt16BE(height, 3);
      send(Buffer.concat([header, unit]));
    };
    const hasPicture = (unit) => {
      for (let i = 0; i + 3 < unit.length; i++) {
        if (unit[i] || unit[i + 1] || unit[i + 2] !== 1) continue;
        const type = hevc ? (unit[i + 3] >> 1) & 63 : unit[i + 3] & 31;
        if (hevc ? type <= 31 : type >= 1 && type <= 5) return true;
      }
      return false;
    };
    child.stdout.on("data", (data) => {
      if (encoder !== child) return;
      bytes = Buffer.concat([bytes, data]);
      // Leave a partial start code/header for the next read; chunks need not end at NAL boundaries.
      let i = scanned;
      while (i + 4 < bytes.length) {
        if (bytes[i] || bytes[i + 1]) { i++; continue; }
        const prefix = bytes[i + 2] === 1 ? 3 : bytes[i + 2] === 0 && bytes[i + 3] === 1 ? 4 : 0;
        if (!prefix) { i++; continue; }
        if (i + prefix >= bytes.length) break;
        const type = hevc ? (bytes[i + prefix] >> 1) & 63 : bytes[i + prefix] & 31;
        if (type === (hevc ? 35 : 9)) {
          // Headers before the first AUD belong to its picture; a complete picture before it stands alone.
          if (aud >= 0 || hasPicture(bytes.subarray(0, i))) {
            emit(bytes.subarray(0, i));
            bytes = bytes.subarray(i);
            i = 0;
          }
          aud = i;
        }
        i += prefix + 1;
      }
      scanned = i;
      if (bytes.length > 16 * 1024 * 1024) fail();
      // A unit is otherwise sent when the next one's AUD arrives; a page that stops changing sends no next one, so a
      // complete picture is sent after a moment's quiet (a packet's rest comes within it).
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (encoder !== child || !bytes.length || !hasPicture(bytes)) return;
        emit(bytes);
        bytes = Buffer.alloc(0);
        scanned = 0;
        aud = -1;
      }, QUIET_MS);
    });
    child.stdout.on("error", () => { if (encoder === child) fail(); });
    child.stdin.on("drain", () => { if (encoder === child) blocked = false; });
    child.stdin.on("error", () => { if (encoder === child) fail(); });
    child.on("error", () => { if (encoder === child) fail(); });
    child.on("exit", () => { if (encoder === child) fail(); });
  };
  const video = {
    write(event) {
      if (stopped) return;
      clearTimeout(repeat);
      // ffmpeg reads a picture only once the next begins, so the page's last picture (a still page sends no more) is
      // pushed through by sending it again; the repeat is held in its place, and encodes to almost nothing.
      if (!event.repeat) repeat = setTimeout(() => video.write({ ...event, repeat: true }), REPEAT_MS);
      const width = Number(event.metadata?.deviceWidth);
      const height = Number(event.metadata?.deviceHeight);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) { fail(); return; }
      if (!size || size.width !== width || size.height !== height) start(width, height);
      if (!blocked && encoder) blocked = !encoder.stdin.write(Buffer.from(event.data, "base64"));
    },
    close() { stopped = true; clearTimeout(repeat); stop(); },
  };
  return video;
}
