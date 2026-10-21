import { createSignal, For, Show, type JSX } from "solid-js";
import { InUse, On } from "./specs";
import { TokenTable } from "./foundations";
import type { Page, Row } from "./model";
import { CodeBlock } from "@/components/ui/code";
import api, { type ApiComponent } from "virtual:gallery-api";

/* A page's sections around its examples, in shadcn's order: Usage (an import and a short snippet, written with the
   page) before the examples, then API (each component's props, generated from its TypeScript and doc comments by
   scripts/gallery-api.mjs, so it never drifts) and Used in (where the app imports it, generated too). */

/** Usage: the import and a short snippet, copyable. */
export function PageUsage(props: { code: string; id?: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = () => { void navigator.clipboard?.writeText(props.code); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return <section class="g-page-section">
    <h3 class="g-heading" id={props.id}>Usage</h3>
    <CodeBlock lang="tsx" code={props.code} copied={copied()} onCopy={copy} />
  </section>;
}

const missing = (name: string): ApiComponent => ({ name, file: "", line: 0, doc: "Not found in components/ui: is it exported?", props: [], usedIn: [] });

/** API: per component, its doc comment, what it extends, and a props table. A name keyed "components/<file>#<Name>"
 *  is the behaviour adapter of that name, where a library piece shares it. */
export function PageApi(props: { names: string[] }) {
  const entries = () => props.names.map((name) => api.components[name] ?? missing(name));
  return <section class="g-page-section">
    <h3 class="g-heading">API <small>generated from the source</small></h3>
    <For each={entries()}>{(entry) => <article class="g-api">
      <h4><code>{entry.name}</code><Show when={entry.file}><small>{entry.file}:{entry.line}</small></Show>
        <Show when={entry.file && !entry.file.startsWith("components/ui/")}><small class="g-api-adapter">adapter: the behaviour (Kobalte, Sonner) around the library's pieces</small></Show></h4>
      <Show when={entry.doc}><p>{entry.doc}</p></Show>
      <Show when={entry.extends}><p class="g-api-extends">Also takes <code>{entry.extends}</code>.</p></Show>
      <Show when={entry.props.length} fallback={<Show when={!entry.extends}><p class="g-api-none">No props.</p></Show>}>
        <table>
          <thead><tr><th>Prop</th><th>Type</th><th>Description</th></tr></thead>
          <tbody><For each={entry.props}>{(prop) => <tr>
            <td><code>{prop.name}{prop.optional ? "?" : ""}</code></td>
            <td><code>{prop.type}</code></td>
            <td>{prop.doc}</td>
          </tr>}</For></tbody>
        </table>
      </Show>
    </article>}</For>
  </section>;
}

/** Used in: the app files that import any of the page's components. */
export function PageUsedIn(props: { names: string[] }) {
  const files = () => [...new Set(props.names.flatMap((name) => api.components[name]?.usedIn ?? []))].sort();
  return <section class="g-page-section">
    <h3 class="g-heading">Used in <small>{files().length ? `${files().length} files in the app` : "nowhere in the app yet"}</small></h3>
    <Show when={files().length}><ul class="g-used-in"><For each={files()}>{(file) => <li><code>{file}</code></li>}</For></ul></Show>
  </section>;
}

/* The template: one function draws every page, so every page has the same sections, in the same order, under the
   same headings, each in its one presentation. */

const SECTIONS = ["Preview", "Usage", "Anatomy", "Examples", "Motion", "Tokens", "API", "Used in"] as const;
type Section = typeof SECTIONS[number];
const anchor = (page: Page, section: Section) => `${page.title}-${section}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The sections a page has, in the template's order. */
const present = (page: Page): Section[] => SECTIONS.filter((section) => ({
  Preview: page.preview, Usage: page.usage, Anatomy: page.anatomy, Examples: page.examples?.length, Motion: page.motion?.length,
  Tokens: page.tokens?.length, API: page.api?.length, "Used in": page.api?.length,
})[section]);

function Heading(props: { page: Page; section: Section; note?: string }) {
  return <h3 class="g-heading" id={anchor(props.page, props.section)}>{props.section}{props.note && <small> {props.note}</small>}</h3>;
}

/** Examples and Motion: one table. Name and note down the side; across, Ground and Frost at the desktop's density
 *  (and Frame first where a row also sits on the sidebar's), and Phone where any row differs on a phone. A cell the row does not sit on shows a dash. */
function Rows(props: { rows: Row[] }) {
  const surfaces = (row: Row): ("frame" | "ground" | "frost")[] => row.surfaces ?? ["ground", "frost"];
  const columns = () => [
    ...(["frame", "ground", "frost"] as const).filter((where) => props.rows.some((row) => row.phone !== "only" && surfaces(row).includes(where))),
    ...(props.rows.some((row) => row.phone) ? ["phone" as const] : []),
  ];
  const grid = () => ({ "--g-columns": String(columns().length) });
  const cell = (row: Row, column: "frame" | "ground" | "frost" | "phone"): JSX.Element => column === "phone"
    ? row.phone ? <div class="g-form-density" data-density="phone"><On where={surfaces(row)[0]!}>{row.render()}</On></div> : <span class="g-dash">—</span>
    : row.phone !== "only" && surfaces(row).includes(column) ? <On where={column}>{row.render()}</On> : <span class="g-dash">—</span>;
  return <div class="g-scale g-forms g-rows" data-density="desktop">
    <div class="g-scale-head" style={grid()}><span /><For each={columns()}>{(column) => <span>{column[0]!.toUpperCase() + column.slice(1)}</span>}</For></div>
    <For each={props.rows}>{(row) => <div class="g-scale-row" style={grid()}>
      <div class="g-scale-name"><strong>{row.name}</strong><small>{row.note}</small>{row.code && <code class="g-form-code">{row.code}</code>}</div>
      <For each={columns()}>{(column) => cell(row, column)}</For>
    </div>}</For>
  </div>;
}

/** Token groups in runs of the same density, so each run is one table with one set of columns. */
const runs = <T extends { density?: boolean }>(groups: T[]) => groups.reduce<T[][]>((all, group) => {
  const last = all.at(-1);
  if (last && Boolean(last[0]!.density) === Boolean(group.density)) last.push(group); else all.push([group]);
  return all;
}, []);

/** A page, drawn to the template. */
export function PageView(props: { page: Page }) {
  const page = () => props.page;
  const has = (section: Section) => present(page()).includes(section);
  return <section class="g-family g-template">
    <h2 class="g-family-title">{page().title}</h2>
    <p class="g-page-summary">{page().summary}</p>
    <nav class="g-page-toc" aria-label="On this page"><span>On this page</span>
      <For each={present(page())}>{(section) => <a href={`#${anchor(page(), section)}`}>{section}</a>}</For>
    </nav>
    <Show when={page().preview}>{(preview) => <section class="g-page-section">
      <Heading page={page()} section="Preview" />
      <div class="g-preview" data-density="desktop"><On where="ground">{preview()()}</On></div>
    </section>}</Show>
    <Show when={page().usage}>{(code) => <PageUsage code={code()} id={anchor(page(), "Usage")} />}</Show>
    <Show when={page().anatomy}>{(anatomy) => <section class="g-page-section">
      <Heading page={page()} section="Anatomy" note="numbered on the page; what each part does and is made of" />
      <InUse density={false} scene={() => <div class="g-anatomy">{anatomy().scene()}</div>}
        marks={anatomy().parts.map((part) => ({ selector: part.selector, side: part.side, label: `${part.name}: ${part.does}`,
          read: (el: HTMLElement) => typeof part.from === "function" ? part.from(el) : part.from ?? "" }))} />
    </section>}</Show>
    <Show when={has("Examples")}><section class="g-page-section"><Heading page={page()} section="Examples" note="every variant, size and state" /><Rows rows={page().examples!} /></section></Show>
    <Show when={has("Motion")}><section class="g-page-section"><Heading page={page()} section="Motion" note="replay a move from its row" /><Rows rows={page().motion!} /></section></Show>
    <Show when={has("Tokens")}><section class="g-page-section"><Heading page={page()} section="Tokens" note="what it reads, as it computes" />
      <For each={runs(page().tokens!)}>{(run) => <TokenTable groups={run.map((group) => ({ title: group.title, rows: group.tokens }))} density={Boolean(run[0]!.density)} />}</For></section></Show>
    <Show when={has("API")}><div id={anchor(page(), "API")}><PageApi names={page().api!} /></div><div id={anchor(page(), "Used in")}><PageUsedIn names={page().api!} /></div></Show>
  </section>;
}
