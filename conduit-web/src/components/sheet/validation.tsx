/*
 * The Data validation dialog, as Excel's three tabs (Settings, Input message, Error alert): it opens on the selection's first cell's rule and saves
 * Excel's own `dataValidation` attributes (sheet-valid.js), so an xlsx file keeps them as they are.
 */
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { Actions } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input, Segmented, Switch } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/menus";
import { rangeA1 } from "@/sheet-format.js";
import { dateText, optionsOf, readDate, type SheetValidation } from "@/sheet-types.js";
import { readTime, type SheetRuleKind, type SheetRuleOperator } from "@/sheet-valid.js";
import type { SheetRange } from "./host";

const KINDS: { value: SheetRuleKind | "any"; label: string }[] = [
  { value: "any", label: "Any value" }, { value: "whole", label: "Whole number" }, { value: "decimal", label: "Decimal" }, { value: "list", label: "List" },
  { value: "date", label: "Date" }, { value: "time", label: "Time" }, { value: "textLength", label: "Text length" }, { value: "custom", label: "Custom" },
];
const OPERATORS: { value: SheetRuleOperator; label: string }[] = [
  { value: "between", label: "between" }, { value: "notBetween", label: "not between" }, { value: "equal", label: "equal to" }, { value: "notEqual", label: "not equal to" },
  { value: "greaterThan", label: "greater than" }, { value: "lessThan", label: "less than" }, { value: "greaterThanOrEqual", label: "greater than or equal to" }, { value: "lessThanOrEqual", label: "less than or equal to" },
];
const STYLES = [{ value: "stop", label: "Stop" }, { value: "warning", label: "Warning" }, { value: "information", label: "Information" }] as const;
type Tab = "settings" | "input" | "error";
const on1 = (flag: unknown) => flag === "1" || flag === "true" || flag === true;
const pad = (n: number) => String(n).padStart(2, "0");

// An operand as the form shows it (a date's serial as its date, a time's as h:mm), and as kept (a typed date or time as its serial, else its formula, no `=`).
const shown = (kind: string, formula: unknown) => {
  const text = String(formula ?? ""), n = Number(text);
  if (text === "" || !Number.isFinite(n)) return text && !/^".*"$/.test(text) ? `=${text}` : text;
  if (kind === "date") return dateText(n);
  if (kind === "time") { const minutes = Math.round(n * 1440); return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`; }
  return text;
};
const kept = (kind: string, typed: string) => {
  const text = typed.trim();
  if (text.startsWith("=")) return text.slice(1);
  if (kind === "date") return String(readDate(text) ?? text);
  if (kind === "time") return String(readTime(text) ?? text);
  return text;
};

/** The rule for `range` (null: shut); `rule` what its first cell holds. `onSave(null)` takes the range's rules off. */
export function ValidationPrompt(props: { range: SheetRange | null; rule: SheetValidation | undefined; onSave(attributes: SheetValidation | null): void; onClose(): void }) {
  const [tab, setTab] = createSignal<Tab>("settings"), [kind, setKind] = createSignal<SheetRuleKind | "any">("any"), [operator, setOperator] = createSignal<SheetRuleOperator>("between");
  const [a, setA] = createSignal(""), [b, setB] = createSignal(""), [blank, setBlank] = createSignal(true);
  const [prompting, setPrompting] = createSignal(true), [promptTitle, setPromptTitle] = createSignal(""), [prompt, setPrompt] = createSignal("");
  const [alerting, setAlerting] = createSignal(true), [style, setStyle] = createSignal<"stop" | "warning" | "information">("stop"), [errorTitle, setErrorTitle] = createSignal(""), [error, setError] = createSignal("");
  createEffect(on(() => props.range, (range) => {
    if (!range) return;
    const rule = props.rule ?? {}, type = (KINDS.some((one) => one.value === rule.type) ? rule.type : "any") as SheetRuleKind | "any";
    setTab("settings"); setKind(type); setOperator((rule.operator as SheetRuleOperator) ?? "between");
    const options = type === "list" ? optionsOf(rule) : null;
    setA(options ? options.map((one) => one.value).join(", ") : shown(type, rule.formula1)); setB(shown(type, rule.formula2));
    setBlank(props.rule ? on1(rule.allowBlank) : true);
    setPrompting(props.rule ? on1(rule.showInputMessage) : true); setPromptTitle(String(rule.promptTitle ?? "")); setPrompt(String(rule.prompt ?? ""));
    setAlerting(props.rule ? on1(rule.showErrorMessage) : true); setStyle(rule.errorStyle === "warning" || rule.errorStyle === "information" ? rule.errorStyle : "stop");
    setErrorTitle(String(rule.errorTitle ?? "")); setError(String(rule.error ?? ""));
  }));
  const two = () => operator() === "between" || operator() === "notBetween";
  const compares = () => !["any", "list", "custom"].includes(kind());
  const ready = () => kind() === "any" || (a().trim() !== "" && (!compares() || !two() || b().trim() !== ""));
  const attributes = (): SheetValidation | null => {
    const type = kind();
    if (type === "any") return null;
    // A typed list is kept quoted, as Excel writes one (its inks kept for the values still listed); a range or name as its formula.
    const listed = type === "list" && !a().trim().startsWith("=");
    const values = listed ? a().split(",").map((one) => one.trim()).filter(Boolean) : [];
    const inks = listed && props.rule?.inks ? Object.fromEntries(Object.entries(props.rule.inks).filter(([value]) => values.includes(value))) : undefined;
    const set = (name: string, value: string | false) => value ? { [name]: value } : {};
    return {
      type, ...set("operator", compares() && operator() !== "between" && operator()), ...set("allowBlank", blank() && "1"), ...set("showDropDown", type === "list" && on1(props.rule?.showDropDown) && "1"),
      ...set("showInputMessage", prompting() && "1"), ...set("showErrorMessage", alerting() && "1"), ...set("errorStyle", style() !== "stop" && style()),
      ...set("errorTitle", errorTitle().trim()), ...set("error", error().trim()), ...set("promptTitle", promptTitle().trim()), ...set("prompt", prompt().trim()),
      formula1: listed ? `"${values.map((one) => one.replace(/"/g, '""')).join(",")}"` : kept(type, a()), ...set("formula2", compares() && two() && kept(type, b())),
      ...inks && Object.keys(inks).length ? { inks } : {},
    };
  };
  const save = (event: SubmitEvent) => { event.preventDefault(); if (ready()) props.onSave(attributes()); };
  return <Dialog open={props.range !== null} title="Data validation" description={props.range ? `Cells ${rangeA1(props.range)}` : undefined} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <CardForm onSubmit={save}>
      <Segmented label="Part" value={tab()} options={[{ value: "settings", label: "Settings" }, { value: "input", label: "Input message" }, { value: "error", label: "Error alert" }]} onChange={setTab} />
      <Show when={tab() === "settings"}>
        <Field label="Allow"><Select aria-label="Allow" value={kind()} onChange={(event) => setKind(event.currentTarget.value as SheetRuleKind | "any")}><For each={KINDS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
        <Show when={compares()}>
          <Field label="Data"><Select aria-label="Data" value={operator()} onChange={(event) => setOperator(event.currentTarget.value as SheetRuleOperator)}><For each={OPERATORS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
        </Show>
        <Show when={kind() !== "any"}>
          <Field label={kind() === "list" ? "Source: values, or =$F$2:$F$9 or a name" : kind() === "custom" ? "Formula" : two() ? (kind() === "textLength" ? "Minimum length" : "Minimum") : "Value"}>
            <Input aria-label="Source" value={a()} placeholder={kind() === "list" ? "Yes, No" : kind() === "custom" ? "=LEN(A1)<10" : kind() === "date" ? "1/1/2026" : kind() === "time" ? "9:00" : ""} onInput={(event) => setA(event.currentTarget.value)} />
          </Field>
          <Show when={compares() && two()}><Field label={kind() === "textLength" ? "Maximum length" : "Maximum"}><Input aria-label="Maximum" value={b()} onInput={(event) => setB(event.currentTarget.value)} /></Field></Show>
          <Field label="Ignore blank" inline plain><Switch label="Ignore blank" checked={blank()} onChange={setBlank} /></Field>
        </Show>
      </Show>
      <Show when={tab() === "input"}>
        <Field label="Show input message when the cell is selected" inline plain><Switch label="Show input message" checked={prompting()} onChange={setPrompting} /></Field>
        <Field label="Title"><Input aria-label="Input title" value={promptTitle()} onInput={(event) => setPromptTitle(event.currentTarget.value)} /></Field>
        <Field label="Input message"><Input aria-label="Input message" value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} /></Field>
      </Show>
      <Show when={tab() === "error"}>
        <Field label="Show error alert after invalid data is entered" inline plain><Switch label="Show error alert" checked={alerting()} onChange={setAlerting} /></Field>
        <Field label="Style"><Select aria-label="Style" value={style()} onChange={(event) => setStyle(event.currentTarget.value as "stop")}><For each={STYLES}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
        <Field label="Title"><Input aria-label="Error title" value={errorTitle()} onInput={(event) => setErrorTitle(event.currentTarget.value)} /></Field>
        <Field label="Error message"><Input aria-label="Error message" value={error()} onInput={(event) => setError(event.currentTarget.value)} /></Field>
      </Show>
      <Actions>
        <Show when={props.rule}><Button type="button" variant="ghost" outline onClick={() => props.onSave(null)}>Clear all</Button></Show>
        <Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit" disabled={!ready()}>Save</Button>
      </Actions>
    </CardForm>
  </Dialog>;
}
