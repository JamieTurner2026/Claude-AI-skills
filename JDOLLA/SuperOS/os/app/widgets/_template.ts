// Widget template. To add a widget:
//   1. Copy this file to app/widgets/<name>.ts and change id, title and render().
//   2. Register it in app/widgets/registry.ts.
//   3. Add { "widget": "<name>", "span": 1 } to "layout" in config/os.config.json.
// Rules: build the DOM with h() (text only, never innerHTML); return a cleanup function from
// render() if you start a timer or listener.
import type { OsState } from "../../shared/types.ts";
import type { Api } from "../api.ts";
import { h } from "../dom.ts";

export type WidgetContext = {
  state: OsState;
  api: Api;
  /** Reload state from the bridge and redraw every widget. */
  refresh: () => Promise<void>;
  toast: (message: string) => void;
  /** Department chosen from the command bar, if any. */
  selectedDept: string | null;
};

export type Widget = {
  id: string;
  title: string;
  /** Fill `body`. May return a cleanup function, called before the next redraw. */
  render: (body: HTMLElement, ctx: WidgetContext) => void | (() => void);
};

export const template: Widget = {
  id: "template",
  title: "Template",
  render(body, ctx) {
    body.append(h("p", { class: "empty" }, `Hello, ${ctx.state.owner}.`));
  },
};
