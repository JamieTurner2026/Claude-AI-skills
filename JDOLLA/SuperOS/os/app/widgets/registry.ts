// Every widget the dashboard can show. Add new ones here.
import type { Widget } from "./_template.ts";
import { calendar } from "./calendar.ts";
import { clock } from "./clock.ts";
import { departments } from "./departments.ts";
import { directives } from "./directives.ts";
import { proposals } from "./proposals.ts";
import { routines } from "./routines.ts";
import { runs } from "./runs.ts";
import { setup } from "./setup.ts";
import { skills } from "./skills.ts";

export const registry: Record<string, Widget> = { directives, departments, routines, skills, clock, runs, proposals, setup, calendar };
