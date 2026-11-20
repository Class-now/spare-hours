// Registers Spare Hours' operations with the agent runtime. Each action wraps a method of
// the page's one Week object, so the assistant and the page's own forms follow the same
// rules. Only names in agent-manifest.json actions.agentTools become model tools
// (website_<name>). The calculator that other agent sites may also use is registered a
// second time in bridge/bridge-actions.js, with the same name and input.
import { App, Week } from "./js/week.js";
import { ESTIMATE_EFFORT, ITEM_PROPERTIES } from "./js/action-schemas.js";

const DAY_HOURS = { type: "number", minimum: 0, maximum: 16 };

class SiteActions {
  static registerActions(actions) {
    actions.register({
      name: "get_week_state",
      description: "Read today's date, the visitor's free hours per weekday, their commitments with whether each fits, typical hours by kind of entry, and the partner site's name and link. Changes nothing. Call it first in each turn that needs any of these.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    });
    actions.register({
      name: "set_weekly_hours",
      description: "Call it only when the visitor asks. Sets the free hours of the weekdays given, in half-hour steps; other days keep theirs. Returns the updated state.",
      effect: "write",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: { mon: DAY_HOURS, tue: DAY_HOURS, wed: DAY_HOURS, thu: DAY_HOURS, fri: DAY_HOURS, sat: DAY_HOURS, sun: DAY_HOURS },
      },
      execute: args => App.page.setWeeklyHours(args),
    });
    actions.register({
      name: "add_commitment",
      description: "Call it only when the visitor asks. Adds one piece of work with a due date to the visitor's list on this page (kept in this browser). Give kind or hours. Refuses past due dates, a label already listed and a full list (12). Returns the updated state.",
      effect: "write",
      inputSchema: { type: "object", additionalProperties: false, required: ["label", "dueDate"], properties: ITEM_PROPERTIES },
      execute: args => App.page.addCommitment(args),
    });
    actions.register({
      name: "remove_commitment",
      description: "Call it only when the visitor asks. Removes one commitment by its id from website_get_week_state. Returns the updated state.",
      effect: "write",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["id"],
        properties: { id: { type: "string", maxLength: 8, description: "Commitment id, such as c3." } },
      },
      execute: args => App.page.removeCommitment(args.id),
    });
    actions.register({
      name: "check_fit",
      description: "Test whether work fits the visitor's free hours. Returns each commitment in due-date order with fits, spare or missing hours and start-by date. Each candidate (up to 8, not saved) is tested alone on top of the commitments: fitsWithCommitments, and wouldNotFit names what would miss its date. Changes nothing.",
      effect: "read",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          candidates: {
            type: "array", maxItems: 8, description: "Work the visitor is only considering, such as contests a partner site listed.",
            items: { type: "object", additionalProperties: false, required: ["label", "dueDate"], properties: ITEM_PROPERTIES },
          },
        },
      },
      execute: args => App.page.checkFit(args.candidates ?? []),
    });
    actions.register({
      ...ESTIMATE_EFFORT,
      effect: "read",
      execute: args => Week.estimate(args),
    });
  }
}

export const registerActions = SiteActions.registerActions;
