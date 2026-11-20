// Input schemas and descriptions shared by the page's actions (site-actions.js) and the
// action bridge (bridge/bridge-actions.js), so an agent sees one tool with one meaning
// wherever it runs.
import { EFFORT, KINDS } from "./effort-data.js";

const TYPICAL = KINDS.map(kind => `${kind} ${EFFORT[kind]}`).join(", ");

export const KIND = { type: "string", enum: KINDS, description: `Kind of entry, for its typical hours (${TYPICAL}).` };
export const HOURS = { type: "number", minimum: 0.5, maximum: 400, description: "Hours the work needs. Overrides the kind's typical hours." };
export const DUE_DATE = { type: "string", format: "date", description: "Due day, YYYY-MM-DD. Must be after today." };

export const ITEM_PROPERTIES = {
  label: { type: "string", minLength: 1, maxLength: 80, description: "Short name of the work, such as a contest's title." },
  kind: KIND,
  hours: HOURS,
  dueDate: DUE_DATE,
};

export const ESTIMATE_EFFORT = {
  name: "estimate_effort",
  description: "Estimate one entry at an even pace: its hours (typical for the kind, or as given), the days and weeks needed at hoursPerWeek, the latest day to start before dueDate, and whether that day has passed. Reads no one's week and changes nothing. Give kind or hours.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["hoursPerWeek", "dueDate"],
    properties: {
      kind: KIND,
      hours: HOURS,
      hoursPerWeek: { type: "number", minimum: 0.5, maximum: 112, description: "Free hours a week." },
      dueDate: DUE_DATE,
    },
  },
};
