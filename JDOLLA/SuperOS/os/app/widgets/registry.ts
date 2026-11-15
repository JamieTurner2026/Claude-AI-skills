// Every widget the dashboard can show. Add new ones here.
import type { Widget } from "./_template.ts";
import { clock } from "./clock.ts";
import { departments } from "./departments.ts";
import { directives } from "./directives.ts";
import { routines } from "./routines.ts";

export const registry: Record<string, Widget> = { directives, departments, routines, clock };
