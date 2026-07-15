import React, { useMemo } from "react"

import { cn } from "@/lib/utils"

const METEOR_TRAVEL_DVH = 90

export const Meteors = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className
}) => {
  const meteorStyles = useMemo(() => {
    const horizontalTravel = Math.abs(Math.cos(angle * Math.PI / 180)) * METEOR_TRAVEL_DVH

    return [...new Array(number)].map(() => {
      const duration = Math.random() * (maxDuration - minDuration) + minDuration
      const delay = Math.random() * (maxDelay - minDelay) + minDelay
      const start = Math.random()

      return {
        "--angle": -angle + "deg",
        "--meteor-travel": `-${METEOR_TRAVEL_DVH}dvh`,
        top: "0%",
        left: `calc(${start * 100}% + ${start * horizontalTravel}dvh)`,
        animationDelay: delay - Math.random() * duration + "s",
        animationDuration: duration + "s",
      }
    })
  }, [number, minDelay, maxDelay, minDuration, maxDuration, angle])

  return (
    <>
      {[...meteorStyles].map((style, idx) => (
        // Meteor Head
        (<span
          key={idx}
          style={{ ...style }}
          className={cn(
            "animate-meteor pointer-events-none absolute size-0.5 rotate-(--angle) rounded-full bg-zinc-500 shadow-[0_0_0_1px_#ffffff10]",
            className
          )}>
          {/* Meteor Tail */}
          <div
            className="pointer-events-none absolute top-1/2 -z-10 h-px w-12.5 -translate-y-1/2 bg-linear-to-r from-zinc-500 to-transparent" />
        </span>)
      ))}
    </>
  );
}
