import { createSignal, For, Show } from "solid-js";
import { CodeBlock } from "@/components/ui/code";
import api, { type ApiComponent } from "virtual:gallery-api";

/* A page's sections around its examples, in shadcn's order: Usage (an import and a short snippet, written with the
   page) before the examples, then API (each component's props, generated from its TypeScript and doc comments by
   scripts/gallery-api.mjs, so it never drifts) and Used in (where the app imports it, generated too). */

/** Usage: the import and a short snippet, copyable. */
export function PageUsage(props: { code: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = () => { void navigator.clipboard?.writeText(props.code); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  return <section class="g-page-section">
    <h3 class="g-heading">Usage</h3>
    <CodeBlock lang="tsx" code={props.code} copied={copied()} onCopy={copy} />
  </section>;
}

const missing = (name: string): ApiComponent => ({ name, file: "", line: 0, doc: "Not found in components/ui: is it exported?", props: [], usedIn: [] });

/** API: per component, its doc comment, what it extends, and a props table. */
export function PageApi(props: { names: string[] }) {
  const entries = () => props.names.map((name) => api.components[name] ?? missing(name));
  return <section class="g-page-section">
    <h3 class="g-heading">API <small>generated from the source</small></h3>
    <For each={entries()}>{(entry) => <article class="g-api">
      <h4><code>{entry.name}</code><Show when={entry.file}><small>{entry.file}:{entry.line}</small></Show></h4>
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
