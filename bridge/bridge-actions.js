// The one read Spare Hours shares with other agent sites, through its action bridge.
// The build names this file in bridge/agent-manifest.json. When another site's assistant
// calls this site's network, the bridge loads it in a hidden frame on this site's origin,
// which has no page. The action has the name and input of the page's own action
// (site-actions.js), so the network's instructions fit both.
import { Week } from "../js/week.js";
import { ESTIMATE_EFFORT } from "../js/action-schemas.js";

/**
 * Shares the effort calculator: typical hours by kind of entry, and the latest start day
 * at a given number of hours a week.
 *
 * A partner's agent calls it from the partner's page, and the call runs here with the
 * site's own numbers. It takes everything it needs as input. A visitor's free hours and
 * commitments belong to that visitor and stay on their page: nothing here reads them.
 */
class BridgeActions {
  /**
   * Every site may call the calculator. It returns only arithmetic on the caller's own
   * input and the typical hours the public page already shows to everyone.
   */
  static CALLERS = ["*"];

  /**
   * Register the shared read with the bridge's registry.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register({
      ...ESTIMATE_EFFORT,
      effect: "read",
      availability: "bridge",
      callerOrigins: BridgeActions.CALLERS,
      execute: args => Week.estimate(args),
    });
  }
}

// The bridge calls the module's registerActions export.
export const registerActions = BridgeActions.registerActions;
