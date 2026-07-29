import { For } from "solid-js";
import type { MeteorEvent } from "./types";
import "./meteor.css";

export interface MeteorShowerProps {
  elapsedSeconds?: number;
  events: MeteorEvent[];
  entryOffset?: number;
}

export function MeteorShower(props: MeteorShowerProps) {
  const top = () => `-${props.entryOffset ?? 12}px`;
  const elapsed = () => props.elapsedSeconds ?? 0;
  return (
    <For each={props.events}>
      {(event) => (
        <span
          class="meteor"
          onAnimationEnd={(e) => e.currentTarget.remove()}
          style={{
            "--angle": `${event.angle}deg`,
            "--meteor-travel": `-${event.travel}px`,
            "--meteor-duration": `${event.duration}s`,
            "animation-delay": `${event.startTime - elapsed()}s`,
            "animation-duration": `${event.duration}s`,
            left: `${event.left}px`,
            top: top(),
          }}
        >
          <span class="meteor__tail" />
        </span>
      )}
    </For>
  );
}
