// Named, deterministic browser probes. Keep source text here so the harness
// command line and the focused Playwright spec use the same fixture contract.

const rootContract = (requiredNodeCounts = {}) => ({
  type: "div",
  attributes: { class: ["chat-markdown"] },
  requiredNodeCounts,
});

export const BROWSER_FIXTURES = Object.freeze({
  "rich-markdown": {
    text: "# Rich answer\n\nA **bold** item with *emphasis*.\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 1, list: 1, table: 1, code: 0, math: 0, link: 0 }),
    expectedAssertions: {},
    expectedInteractions: {},
    requiresStructuralContract: true,
  },
  "incomplete-syntax": {
    text: "# Incomplete\n\n**bold",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 1, list: 0, table: 0, code: 0, math: 0, link: 0 }),
    expectedAssertions: {},
    expectedInteractions: {},
    requiresStructuralContract: true,
  },
  "incomplete-reference": {
    text: "[missing label][missing-reference]",
    expectedSemanticText: "[missing label][missing-reference]",
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 0, link: 0 }),
    expectedAssertions: {},
    expectedInteractions: {},
    requiresStructuralContract: true,
  },
  katex: {
    text: "Inline $x^2$ and a block:\n\n$$\ny = mx + b\n$$",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 2, link: 0 }),
    expectedAssertions: { katexRendered: true },
    expectedInteractions: {},
    requiresStructuralContract: true,
  },
  "incomplete-math-block": {
    text: "Before the formula.\n\n$$\n\\Delta x, \\Delta p \\ge 0\n$$\n\nAfter the formula.",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 1, link: 0 }),
    expectedAssertions: { katexRendered: true },
    expectedInteractions: {},
    streamingAssertion: { kind: "math-block", requireNoRawDelimiters: true, requirePendingNode: true },
    requiresStructuralContract: true,
  },
  "incomplete-math-inline": {
    text: "The answer is $E = mc^2$ and the units are consistent.",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 1, link: 0 }),
    expectedAssertions: { katexRendered: true },
    expectedInteractions: {},
    streamingAssertion: { kind: "math-inline", requireNoRawDelimiters: true, requirePendingNode: true },
    requiresStructuralContract: true,
  },
  "stopped-incomplete-math": {
    text: "The generation stopped here.\n\n$$\n\\frac{",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 0, link: 0 }),
    expectedAssertions: {},
    expectedInteractions: {},
    streamingAssertion: { kind: "math-block", requireNoRawDelimiters: true, requirePendingNode: true },
    requiresStructuralContract: true,
  },
  "incomplete-fence": {
    text: "Before the example.\n\n```javascript\nconst answer = 42;\n```\n\nAfter the example.",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 1, math: 0, link: 0 }),
    expectedAssertions: { fencedCodeCopyControls: true, artifactControlsPresent: true },
    expectedInteractions: { copyCode: true },
    streamingAssertion: { kind: "fence", requireNoRawDelimiters: true, requirePendingNode: true },
    requiresStructuralContract: true,
  },
  security: {
    text: "<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![removed](https://example.com/image.png)",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 0, link: 0 }),
    expectedAssertions: { unsafeElementsAbsent: true, unsafeProtocolsAbsent: true, imagesRemoved: true },
    expectedInteractions: {},
    requiresStructuralContract: true,
  },
  "code-copy": {
    text: "```js\nconsole.log(\"copy me\");\n```",
    expectedSemanticText: null,
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 1, math: 0, link: 0 }),
    expectedAssertions: { fencedCodeCopyControls: true, artifactControlsPresent: true },
    expectedInteractions: { copyCode: true },
    requiresStructuralContract: true,
  },
  "external-confirmation": {
    text: "[external](https://example.com/confirm)",
    expectedSemanticText: "external",
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 0, link: 1 }),
    expectedAssertions: { externalLinkConfirmation: true },
    expectedInteractions: { externalLinkConfirmation: true },
    requiresStructuralContract: true,
  },
  scroll: {
    text: Array.from({ length: 80 }, (_, index) => `line-${index + 1}`).join("\n"),
    expectedSemanticText: Array.from({ length: 80 }, (_, index) => `line-${index + 1}`).join("\n"),
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 0, link: 0 }),
    expectedAssertions: {},
    expectedInteractions: { scrollViewport: true },
    requiresStructuralContract: true,
    scrollProbe: true,
  },
  reconnect: {
    initialText: "Answer survives",
    recoveredDelta: " reconnects",
    expectedSemanticFingerprint: rootContract({ heading: 0, list: 0, table: 0, code: 0, math: 0, link: 0 }),
    expectedAssertions: {},
    expectedInteractions: {},
    requiresStructuralContract: true,
  },
});

export function getBrowserFixture(id) {
  const fixture = BROWSER_FIXTURES[id];
  if (!fixture) throw new Error(`Unknown browser fixture: ${id}. Available: ${Object.keys(BROWSER_FIXTURES).join(", ")}`);
  return { id, ...fixture };
}

export function listBrowserFixtures() {
  return Object.keys(BROWSER_FIXTURES);
}
