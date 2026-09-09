# Brand marks

Source artwork for the product marks Conduit shows next to each harness. The
files actually served live in `conduit-web/public/brand/`; this directory keeps
the originals and records where they came from.

Marks identify third-party products. Keep colours and proportions as supplied —
do not restyle them beyond the single-colour tinting described below.

| Product | Shipped file | Source |
| --- | --- | --- |
| ChatGPT Web | `public/brand/openai-blossom-mark.svg` | official OpenAI brand kit (`openai/SVGs/OAI_OpenAI-Blossom_Black.svg`) (`fill` swapped to `currentColor`) |
| Codex | `public/brand/codex-mark.svg` | Codex glyph via [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) (`static-svg/icons/codex-color.svg`, MIT), with the white app-icon backing plate removed so the gradient mark sits on a clear background |
| Claude Code | `public/brand/claude-code-mark.svg` | Claude glyph via [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) (`static-svg/icons/claude.svg`, MIT) |
| opencode | `public/brand/opencode-mark.svg` | opencode glyph via [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) (`static-svg/icons/opencode.svg`, MIT) |
| Pi | `public/brand/pi-mark.svg` | [earendil-works/pi-website](https://github.com/earendil-works/pi-website) `src/logo.svg` (`fill` swapped to `currentColor`) |

Claude Code, opencode and Pi are staged ahead of their adapters; `HarnessMark`
in `conduit-web/src/client/harness-brand.tsx` already resolves those ids.

Every mark's `viewBox` is cropped to the artwork's own bounds so each one fills
its chip identically; the supplied files carry app-icon padding that would
otherwise render them at 50-75% size.

Single-colour marks are rendered as a CSS mask filled with `currentColor`, so
they follow the theme. The Codex mark keeps its own gradient and is rendered as
an image — never tint or invert it.
