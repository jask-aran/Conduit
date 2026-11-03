import { createHash } from "node:crypto";

/** Serialize JSON data with recursively sorted object keys. */
export function canonicalJson(value) {
  const encode = (item) => {
    if (Array.isArray(item)) return `[${item.map((value) => encode(value) ?? "null").join(",")}]`;
    if (item !== null && typeof item === "object") {
      return `{${Object.keys(item).sort().flatMap((key) => {
        const encoded = encode(item[key]);
        return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
      }).join(",")}}`;
    }
    return JSON.stringify(item);
  };
  return encode(value);
}

/** Fingerprint only the tool, action and input. */
export function actionKey(held) {
  return createHash("sha256").update(canonicalJson({
    tool: held.tool, action: held.action, input: held.input,
  })).digest("hex");
}
