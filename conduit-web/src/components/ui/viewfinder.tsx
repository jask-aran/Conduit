import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { haptic } from "./haptics";
import * as Icons from "./icons";
import { PillButton } from "./pill";

/**
 * Viewfinder: the camera in a card over the page's foot (picture in picture), not the whole screen: what it sees,
 * Close at its start, the shutter in its middle, Flip (front and back) at its end, and Full camera in its top corner,
 * which hands over to the platform's own camera (onFull). The shutter takes the frame as a JPEG (onCapture) and the
 * card leaves; Close leaves the way it came. A camera it cannot open says so and offers the platform's instead.
 */
export function Viewfinder(props: { onCapture: (file: File) => void; onFull: () => void; onClose: () => void }) {
  let video!: HTMLVideoElement;
  let stream: MediaStream | null = null;
  const [facing, setFacing] = createSignal<"environment" | "user">("environment");
  const [live, setLive] = createSignal(false);
  const [failed, setFailed] = createSignal("");
  const [leaving, setLeaving] = createSignal(false);
  const [flash, setFlash] = createSignal(false);
  let stopped = false;

  const stop = () => { stream?.getTracks().forEach((track) => track.stop()); stream = null; };
  const start = async () => {
    stop(); setLive(false);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing(), width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (stopped) return next.getTracks().forEach((track) => track.stop());
      stream = next;
      video.srcObject = next;
      await video.play();
      setFailed(""); setLive(true);
    } catch (cause) {
      if (!stopped) setFailed(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Conduit can't use the camera." : "The camera didn't open.");
    }
  };
  onMount(() => { void start(); });
  onCleanup(() => { stopped = true; stop(); });

  // Leaves the way it came (styles/viewfinder.css), then tells its owner.
  const leave = (then?: () => void) => {
    if (leaving()) return;
    setLeaving(true);
    stop();
    window.setTimeout(() => { then?.(); props.onClose(); }, 160);
  };
  const capture = () => {
    if (!live() || leaving() || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    // The front camera shows mirrored, as a mirror does; the photo is taken as others see it.
    context.drawImage(video, 0, 0);
    haptic("press");
    setFlash(true);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const file = new File([blob], `photo-${stamp}.jpg`, { type: "image/jpeg" });
      leave(() => props.onCapture(file));
    }, "image/jpeg", .92);
  };
  const flip = () => { setFacing(facing() === "environment" ? "user" : "environment"); void start(); };

  return <Portal>
    <div class="ui-viewfinder" role="dialog" aria-label="Camera" data-leaving={leaving() ? "" : undefined} data-facing={facing()}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); leave(); } }}>
      <video ref={video} playsinline muted aria-hidden="true" data-live={live() ? "" : undefined} />
      <span class="ui-viewfinder-flash" data-on={flash() ? "" : undefined} aria-hidden="true" />
      <Show when={failed()}>
        <div class="ui-viewfinder-note" role="status">
          <p>{failed()}</p>
          <button type="button" class="ui-viewfinder-open" onClick={() => leave(props.onFull)}>Open the camera app</button>
        </div>
      </Show>
      <div class="ui-viewfinder-corner"><PillButton label="Full camera" icon={<Icons.Maximize />} button={{ title: "Full camera", onClick: () => leave(props.onFull) }} /></div>
      <div class="ui-viewfinder-controls">
        <PillButton label="Close" icon={<Icons.ChevronLeft />} button={{ title: "Close", onClick: () => leave() }} />
        <button type="button" class="ui-viewfinder-shutter" aria-label="Take the photo" disabled={!live()} onClick={capture}><span /></button>
        <PillButton label="Flip camera" icon={<Icons.SwitchCamera />} button={{ title: "Flip camera", disabled: !!failed(), onClick: flip }} />
      </div>
    </div>
  </Portal>;
}
