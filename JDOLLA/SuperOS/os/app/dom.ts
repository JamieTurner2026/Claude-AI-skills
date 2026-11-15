// Tiny DOM helper. Text always goes in as text nodes, never as HTML: vault content is untrusted.
type Attrs = Record<string, string | boolean | ((ev: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k, v);
    else if (typeof v === "boolean") { if (v) el.setAttribute(k, ""); }
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}
