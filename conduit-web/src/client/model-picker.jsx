import { useEffect, useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { filterModels, groupModels, modelSearchValue } from "./model-options";

function ModelList({ models }) {
  const groups = groupModels(models);
  return <>
    <ComboboxEmpty>No matching models.</ComboboxEmpty>
    <ComboboxList className="model-scope-list">
      {groups.map((group, index) => <div key={group.provider}>
        {index > 0 && <ComboboxSeparator />}
        <ComboboxGroup items={group.items}>
          <ComboboxLabel>{group.provider}</ComboboxLabel>
          <ComboboxCollection>{(model) => <ComboboxItem key={model.spec} value={model}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{model.label}</span>
              <span className="truncate text-xs text-muted-foreground">{model.spec}</span>
            </span>
          </ComboboxItem>}</ComboboxCollection>
        </ComboboxGroup>
      </div>)}
    </ComboboxList>
  </>;
}

const comboboxProps = (models, visibleModels = models) => ({
  items: groupModels(models),
  filteredItems: groupModels(visibleModels),
  itemToStringValue: modelSearchValue,
  autoHighlight: true,
});

export function ModelScopeCombobox({
  models,
  enabled,
  onEnabledChange,
  open,
  onOpenChange,
  portalContainer,
  searchRef: suppliedSearchRef,
}) {
  const selected = models.filter((model) => enabled.includes(model.spec));
  const [query, setQuery] = useState("");
  const visibleModels = filterModels(models, query);
  const localSearchRef = useRef(null);
  const searchRef = suppliedSearchRef || localSearchRef;
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);
  return <Combobox
    {...comboboxProps(models, visibleModels)}
    multiple
    open={open}
    onOpenChange={(nextOpen, details) => {
      if (!nextOpen && details?.reason === "item-press") return;
      if (!nextOpen) setQuery("");
      onOpenChange(nextOpen);
    }}
    onInputValueChange={setQuery}
    value={selected}
    onValueChange={(next) => onEnabledChange(next.map((model) => model.spec))}
  >
    <ComboboxTrigger
      render={<Button variant="outline" />}
      className="w-full justify-between font-normal"
    >
      {enabled.length} {enabled.length === 1 ? "model" : "models"} enabled
    </ComboboxTrigger>
    <ComboboxContent container={portalContainer} className="min-w-80">
      <ComboboxInput
        ref={searchRef}
        showTrigger={false}
        placeholder="Search label, provider, or model spec…"
        aria-label="Search available models"
      />
      <ModelList models={visibleModels} />
    </ComboboxContent>
  </Combobox>;
}
