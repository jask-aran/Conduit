/** Shared responsive geometry for the chat shell and panel surfaces. */
export const MOBILE_LAYOUT_BREAKPOINT_PX = 760;

/** Phone chrome needs both a narrow viewport and a phone-like primary pointer. */
export const PHONE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px) and (hover: none) and (pointer: coarse)`;

/** The desktop shell is the complement used by Conduit's supported pointer types. */
export const NON_PHONE_LAYOUT_QUERY = `(min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX + 1}px), (hover: hover), (pointer: fine), (pointer: none)`;
