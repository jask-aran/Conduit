# Fade streamed text instead of typing it

> **Status (2026-09-22): sketch.** Nothing here is built. The typewriter is still
> the Incremark display path. This records why that path cannot look right on a
> real provider, what the fade-in systems actually do, and the shape of the
> replacement, so the next attempt does not start by tuning the character budget
> again.

**Decision: remove the typewriter.** Smooth per-character typing needs a fixed,
slow character rate, but keeping up with a fast provider needs many characters
to appear each frame. The first option creates lag; the second reveals batches
and no longer looks like smooth typing. Use immediate word reveal with a short
opacity fade, and pace only unusually large bursts. Keep a typewriter only when
simulated human typing matters more than showing the answer promptly.

## Why the typewriter has to go

The typewriter is not an animation. `BufferedIncremarkTypewriter` withholds
text. Each frame it slices the parsed AST with `sliceAst` and reveals a budget
of characters. The DOM is a prefix of what the provider has already sent.
Pacing only changes the budget:

- Fixed is 32 characters a frame.
- Buffered starts at 32 and doubles only while a frame costs under half of its
  budget. Over the budget, it halves. The cost of the slice feeds back into
  the rate.
- Adaptive tries to match the observed source rate and chew a backlog in 250ms.

That looks good on the test profile, and only there. The test profile is not a
firehose of characters. Each tick is one word plus a space, emitted against the
wall clock (`paced-60` is the "about a real model" control; the default is 250
tokens/s). The input is already the animation: even, complete words, no pauses,
no dumps. A character caret staying near that frontier reads as smooth typing.
The profile exists so a slow frame and a slow provider cannot be confused. It
cannot show the failure below, and it will flatter any even reveal.

A real turn is not that. Pi over RPC does not stream characters or words. A
`text_delta` is whatever chunk the provider just sent, forwarded unchanged.
Anthropic and OpenAI pass their own delta straight through; Conduit's
normalizer does the same. A delta might be `"lo"`, `" world"`, or a clause, and
the gap before the next one is the provider's, not a clock. Socket delivery
then merges whatever arrives inside one paint frame and sends anything slower
out immediately. The client therefore sees either a small fragment or a
concatenated burst.

The character queue cannot do both of the things a reader needs:

- A steady stream faster than the budget builds a backlog. The caret chews old
  text while the provider has moved on. That is the original complaint: the
  animation is too slow for how fast most providers send.
- A pause, then a paragraph, stalls the caret and then types the paragraph out
  one character at a time. Slow enough to pace that paragraph, the queue falls
  behind a steady stream. Fast enough to keep up, the paragraph pops.

Variable size is not what breaks it. A slow character budget is. Tuning the
step, or adding a fourth pacing mode, keeps the same failure. The pacing
dropdown (adaptive / fixed / buffered) is that tuning. It goes away with the
scheduler. Do not add a fade mode beside it.

## What fade fixes, and what it does not

Three clocks shape what the reader sees:

1. The provider decides when each delta exists.
2. Socket delivery merges deltas that arrive inside one display frame.
3. The renderer decides when received text enters the DOM and how that entry
   looks.

The current typewriter makes the third clock a second source stream. It reveals
character groups on animation frames, without a visual transition between the
groups. A character can only be absent or present. Faster pacing makes larger
groups pop in; slower pacing makes the display lag behind the provider. A
perfectly even per-character typewriter is possible only by holding all input
behind a fixed character clock. That can look smooth, but it must lag whenever
the provider is faster than that clock.

A word fade changes the visual problem. The renderer inserts a word, then CSS
interpolates its opacity for about 200ms. Several words can enter on one frame
and still appear continuous because their opacity changes between frames. This
does not make provider delivery more even. It masks frame-sized arrival steps
without forcing normal traffic through a slow disclosure clock.

The fade is therefore smoother only if the reveal queue stays short. Fading
words on top of the current character scheduler would keep the late caret and
add decoration to it. The replacement must commit ordinary deltas at their
arrival rate and pace only the excess part of an unusually large delivery.

## What has to stay true

Pacing does not go away. A fat delta still has to come out in order. Immediate
commit of a paragraph is a pop, and a fade applied to the whole paragraph at
once is the same pop with opacity on it.

The replacement has two jobs, and they are not the same job:

1. **Reveal.** A word queue, not a character queue. A one-word delta is shown
   as it lands. A paragraph is split into words and released in reading order,
   done in a fraction of a second. Ordinary traffic must leave at least as fast
   as it arrives. Only words above the normal per-frame allowance enter the
   burst backlog. If that backlog would take longer than the window, release
   more words each frame until the window holds. The queue must not age without
   bound. That unbounded chew is the typewriter failure, and a word queue can
   have it too.
2. **Fade.** Each released word starts transparent and finishes opaque. The
   fade does not gate disclosure. Overlapping fades are what reads as words
   arriving. A stagger on top of the drain is a second queue. Do not add one.

Opacity only, at first. No blur, no translate. Layout height is final when the
word is inserted, not when the fade ends, so scroll and settlement are not
waiting on a CSS animation. `prefers-reduced-motion` flushes any burst backlog
and commits later text immediately: no fade, and no artificial drain.

A trailing partial word (`wor` → `world`) stays in one span and grows in place.
Restarting the animation on every token is the flicker.

## What other systems actually do

Two schools. One fades whatever just mounted and does not pace. The other
withholds and drips, which is the typewriter in a different unit. Neither is
the whole of what we want. We did not read the Claude or ChatGPT bundles; the
attributions below are what those libraries claim, not an inspection.

**Streamdown** (Vercel, the markdown renderer behind AI Elements) is the
fade-on-mount school, and the one LibreChat says Claude.ai uses. A rehype pass
walks text nodes, splits them into word spans, and runs a CSS animation as the
span mounts. Its defaults and skip list have changed between releases: version
2.5.0 added a 40ms default stagger, and inline-code handling changed around
issue 594. Pin a version or commit before copying an exact value. The stable
mechanism is what matters here: new text receives word spans, layout-sensitive
subtrees such as `pre`, `svg`, and math do not, and settled text should lose the
wrappers. Character splitting exists and is discouraged: it creates more DOM
and becomes a typewriter again. There is no drain. A paragraph that arrives in
one commit fades as one batch. That is the pop a fat delta must not be, covered
with effects rather than ordering.

**LibreChat** (PR 14757) looked at FlowToken, Streamdown, llm-ui, and the AI
SDK's `smoothStream`, and took Streamdown's architecture with four corrections
that matter here:

- Fade state is a document-order character offset, not a React node key.
  FlowToken's per-node identity flickers when a reparse moves text between
  elements (`**bold` completing into `<strong>`). A word already shown must not
  animate again just because the AST object changed.
- A word still inside its animation window is given the same props again, so
  the fade is not cut short. Streamdown sets the duration to 0 mid-flight.
- A growing head (`hel` → `hello`) keeps fading instead of restarting.
- When the stream ends, the spans are gone.

They use 250ms opacity and a stagger capped at 25ms, and `Intl.Segmenter` for
CJK. They looked at a client-side rAF drain (the llm-ui approach) and left it
out on purpose: rate control stayed on their server. That is the opposite of
our constraint. We do not sit in front of the provider, and Pi will not emit
even words because we ask it to.

**`smoothStream`** (Vercel AI SDK) is a server-side `TransformStream`. It
buffers until a word boundary (`/\S+\s+/`) and releases with a fixed delay,
10ms by default. Tool calls pass through. An incomplete trailing word is held
until the space, or flushed at the end. CJK needs `Intl.Segmenter`; whitespace
splitting does not segment it. This rewrites a bursty provider into the test
profile's even word ticks, which is why it looks smooth, and why it is the
wrong layer here. A fixed 10ms a word is 100 words a second. A 250 token/s
stream falls behind for the rest of the turn. An 80-word paragraph takes 800ms.
The delay does not catch up. Conduit is not that server. Paint is already
merged to the reader's frame before it reaches the renderer.

**FlowToken** is the animation catalogue (fade, blur, drop, a typewriter mode)
on word or character splits, with animation turned off once a message is done.
LibreChat rejected it for the remount flicker above. Do not take the package.
The lesson is the failure.

**llm-ui** and **use-smooth-text** are the withhold school done in the browser.
use-smooth-text reveals a slice of the accumulated string, a grapheme or a word
at a time, at 60 characters a second by default, and speeds up after a burst so
it does not lag forever. It uses `Intl.Segmenter`, and reduced motion shows
everything. 60 characters a second is slower than the typewriter's fixed step.
The catch-up is the useful idea. The default rate, and the decision to withhold
a steady stream, are the thing we are leaving.

Popular write-ups of "the ChatGPT typing effect" mostly describe a character
typewriter or a fake `ReadableStream` of words. The more careful ones say the
opposite: append tokens as they arrive, batch DOM writes to a frame, no
artificial per-character delay. That agrees with Streamdown on one point only.
Neither app, as far as these sources go, runs a character queue in front of the
provider. The fade, where it is implemented in the open, is opacity on words
that have already been committed. The ordered drain of a fat delta is the part
none of them quite do, and the part a real Pi turn requires.

## The shape of the replacement

Stop slicing the AST. Render the current block, the way a completed block is
already rendered. The typewriter's progress map, step budget, and `sliceAst`
loop have nothing left to do once they are not withholding characters. Delete
that scheduler. Do not fade on top of it.

In front of the paint, a word queue:

- Walk the parsed AST in document order and split visible text nodes on
  whitespace. Attach the space to the word, the way `smoothStream` does, so
  visible text round-trips. Do not split the raw Markdown suffix: syntax such
  as `**` has no visible position, and code and math are excluded.
- Store progress as a visible-text offset and word ordinal for each block. Raw
  source offsets can identify the block, but cannot decide which word is on
  screen.
- No whitespace in the new visible text (a CJK run, or a single token fragment)
  extends one span. `Intl.Segmenter` is the upgrade if a CJK turn looks like one
  block fading. Not before.
- Start with a normal allowance of eight new words per display frame. This is
  above the roughly four words per frame produced by the 250 token/s test
  profile at 60Hz, so that control does not build a queue. Treat only the
  excess as burst backlog. This value is a tuning constant, not a user setting.
- Drain the ordered backlog within 300ms. On each frame, release the normal
  allowance plus enough extra words to meet the oldest queued word's deadline.
  New arrivals join the same queue and cannot move ahead of older words.
- The released word is a span with a one-shot opacity animation, on the order
  of 200ms, ease-out. Tune by eye between Streamdown's 150ms and LibreChat's
  250ms. Do not ship blur or a stagger in the first cut. Blur is the thing to
  try only if a drained burst still reads as chunks.

Fade state lives on the block as a visible-text offset and word ordinal, not on
the identity of the text node. Incremark reparses as markdown closes, and a
text node becomes a child of `strong` or a link. Index-keyed inline children
survive a growing string; they do not survive that restructure. A visible
offset in document order does. A word already released does not animate again.

Skip fenced code and math. Code is highlighted `innerHTML`; word spans would
break it, and Streamdown skips `pre` for the same reason. Math is already one
visible unit. Inline code may fade with the prose. It is layout-neutral.

When the stream ends, settlement waits for the word queue to empty, which is at
most that 300ms window. It does not wait for the opacity animation. Then run one
scoped cleanup render that replaces animated word spans with ordinary text
nodes while preserving the mounted block elements. The current settlement path
deliberately causes no terminal render pulse, so freezing the source alone will
not remove the spans; this cleanup must be explicit. Verify that selection,
copy, and multi-word browser search work after cleanup. `displayBusy` today
means "the character queue has not caught up." It becomes "the burst backlog is
non-empty," and it is short.

Tail-follow stays for this change. A burst still grows height over the drain,
and the existing rule stands: follow the display, not every provider delta.
Whether the inertial spring still earns its keep, once growth is a few words a
frame rather than a character chew, is a question for after the fade is
visible. Do not rip it out in the same cut.

The 8ms figures are not this work. `DELIVERY_FLUSH_MS` is how long paint may be
held to merge with the next delta. It is a default. The browser measures its
own `requestAnimationFrame` gap and the server uses that, clamped to 4–50ms, so
a 144Hz panel (6.9ms) becomes 7ms. Anything slower than a frame is not held.
The typewriter's 8ms is a CPU ceiling on AST slicing, already cut to half the
measured frame on a fast panel. Neither number is a reason to keep the
character queue, and neither should be "fixed" while doing this.

## What this does not do

- No new markdown package. Streamdown, FlowToken, and llm-ui are React, and
  the Incremark adapter is the renderer. Take the mechanism.
- No server-side rewrite of Pi's deltas into even words. That is `smoothStream`,
  and it lags anything faster than its delay.
- No character animation. Streamdown ships it and tells you not to use it.
- No pacing control in the transcript. The three modes were the character
  budget.
- The test profile is not the proof. It will look fine and teach nothing about
  a dumped paragraph. The check is a real Pi turn, and a pause followed by a
  paragraph. A burst mode on the test profile is worth adding only if watching
  a provider is too noisy to judge the drain.
