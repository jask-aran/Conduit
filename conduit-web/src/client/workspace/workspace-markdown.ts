import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  blockQuoteExtension,
  bulletListExtension,
  codeBlockDecorationsExtension,
  dashExtension,
  defaultHideExtensions,
  emojiExtension,
  fixedTabWidthExtension,
  foldExtension,
  horizonalRuleExtension,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownFormattingKeymapExtension,
  prosemarkMarkdownSyntaxExtensions,
  revealBlockOnArrowExtension,
  taskExtension,
} from "@prosemark/core";
import { workspaceLanguages } from "./workspace-languages";

export function workspaceMarkdownExtensions() {
  return [
    markdown({ codeLanguages: workspaceLanguages, extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
    defaultHideExtensions,
    blockQuoteExtension,
    bulletListExtension,
    taskExtension,
    emojiExtension,
    horizonalRuleExtension,
    dashExtension,
    foldExtension,
    revealBlockOnArrowExtension,
    fixedTabWidthExtension,
    codeBlockDecorationsExtension,
    prosemarkMarkdownFormattingKeymapExtension(),
    prosemarkBaseThemeSetup(),
  ];
}
