# Spare Hours — an open agentic website

Spare Hours answers one question for people with a job or classes: does this fit my week?
Put in the free hours you have on each weekday, add what you want to finish and when it is
due, and the page lays the work out, earliest due date first, and says what fits, how many
hours are to spare and what will not be done in time.

The page has an embedded assistant built with the
[agentify-website skill](https://github.com/cognizant-ai-labs/agentic-web) of the
Worldwide Agentic Web MVP spec. It runs in your browser, with no key needed (the site pays for a
small daily allowance; your own key works too), answers only
from the page's data, and acts through the same functions as the page's forms.

Spare Hours knows nothing about contests. For that it asks another agentic website,
[Deadline Desk](https://deadline-desk-agent.pages.dev/), after you agree on a consent
card, and then tests what Deadline Desk listed against your own week. Neither site holds
the other's data: the deadlines stay on Deadline Desk, and your hours stay in your browser.

- Live site: https://spare-hours-agent.pages.dev/
- Network URL (what another agent site puts in its `tools`): https://spare-hours-agent.pages.dev/spare_hours
  (manifest: `agent-manifest.json`, network: `spare_hours.network.json`)

## What the assistant can do

| Action | Effect | Wraps |
| --- | --- | --- |
| `website_get_week_state` | read | `Week.getState()` — today, free hours per weekday, commitments with fit, typical hours by kind, the partner's link |
| `website_set_weekly_hours` | write | `Week.setWeeklyHours()` — half-hour steps, 0 to 16 a day |
| `website_add_commitment` | write | `Week.addCommitment()` — refuses past due dates, duplicates and a full list |
| `website_remove_commitment` | write | `Week.removeCommitment()` |
| `website_check_fit` | read | `Week.checkFit()` — the commitments, and up to 8 candidates each tested on top of them, without saving |
| `website_estimate_effort` | read | `Week.estimate()` — typical hours by kind and the latest start day at a number of hours a week |

It declines what the site cannot do: listing contests of its own, entering or submitting,
writing entries, calendar apps, reminders and email. Nothing here is irreversible, so no
action needs a confirmation dialog.

## Linked site: Deadline Desk

- Partner network: `https://deadline-desk-agent.pages.dev/deadline_desk`.
- Before anything is fetched from Deadline Desk, the chat shows a consent card with its
  name, its host and the first 140 characters of the request. **Always allow** skips the
  card for that host until the page is reloaded.
- A request holds the kind of call, language, AI rule and dates you asked about. The
  assistant is told never to put names, emails, phone numbers or booking codes in it. The
  runtime does not filter it, so check it on the card.
- Deadline Desk's network runs in your browser on this chat's model route, with only the three public
  reads its action bridge shares (the board's date, the search and the back-plan). A call
  costs more than the card's token estimate. Your hours and commitments are never sent to
  Deadline Desk: the fit is worked out on this page afterwards.

## What another agent site gets

The spec runs a called site's network in the *caller's* browser, where this page does not
exist. `bridge/bridge-actions.js` shares one read with every site, `estimate_effort`, with
the name and input of the page's own action. It takes everything as input (kind or hours,
hours a week, due date) and returns arithmetic on it with this site's typical hours. A
visitor's hours and commitments belong to that visitor, so the bridge shares neither, and
no write is shared.

To call Spare Hours from your agent site:

1. Put `"https://spare-hours-agent.pages.dev/spare_hours"` in the calling agent's `tools`.
2. Put `"https://spare-hours-agent.pages.dev"` in your manifest's `allowed_peers`.
3. Label it in your `.hocon`: `"link_labels": {"https://spare-hours-agent.pages.dev/spare_hours": "Spare Hours"}`.
4. Tell your agent when to ask, for example: "To learn how long an entry takes, ask
   spare_hours with the kind of entry, the hours a week and the due date."

```shell
node skills/agentify-website/scripts/check_partner.mjs https://spare-hours-agent.pages.dev/spare_hours --origin <your origin>
```

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `assistant.css` | The page |
| `js/effort-data.js` | Typical hours by kind of entry, and the partner's link |
| `js/week.js` | The page's one `Week` object: hours, commitments, the fit and the calculator |
| `js/action-schemas.js` | Input schemas shared by the page's actions and the bridge |
| `site-actions.js` | The assistant's actions, each wrapping a `Week` method |
| `bridge/bridge-actions.js` | The read shared with other agent sites |
| `bridge/action-bridge.html`, `bridge/agent-manifest.json` | Written by the build; other sites load them |
| `spare_hours.hocon` | The agent network's source |
| `spare_hours.network.json`, `agent-mcp.json`, `.well-known/` | Written by the build |
| `agent-manifest.json`, `links.json` | The public bundle files |
| `site.js` | Mounts the assistant in the page |
| `runtime/` | The spec's browser runtime, copied unchanged (Apache-2.0, see `runtime/LICENSE.txt`) |
| `tests/` | Node tests with a DOM stand-in and a scripted model |

## Run and test

Node.js 22 or newer. From a checkout of the
[agentic-web](https://github.com/cognizant-ai-labs/agentic-web) repository, with this
folder next to it:

```shell
node agentic-web/skills/agentify-website/scripts/build_network.mjs spare-hours/spare_hours.hocon --manifest spare-hours/agent-manifest.json --check
node --test "spare-hours/tests/*.test.mjs"
node agentic-web/skills/agentify-website/scripts/serve_site.mjs spare-hours --port 8090
```

Open the printed URL, add your key under **AI model settings** (a local copy cannot use
the hosted site's free route, which serves the site's own pages only; with a key, the
router is hosted Otari, and any OpenAI-compatible router that allows CORS works) and try:

- "I have 11 free hours a week. Could I finish a hackathon project that is due in six weeks?"
- "Ask Deadline Desk which hackathons that allow generative AI close in the next eight weeks, and tell me which ones fit my week."
- "Make my Saturdays 5 hours and my Wednesdays 0."
- "Add an essay prize entry due in four weeks, and tell me if everything still fits."
- "Can you put these in my Google Calendar and remind me?" (it declines)

The 22 tests cover the network's rules, every action, the bridge, the page's own forms,
the consent card's focus and the default model route. They use the real runtime with a scripted model and call no LLM.

## Hosting

Static files only, on Cloudflare Pages. `_headers` sends `Access-Control-Allow-Origin: *` on the manifest,
the network file, `links.json`, `agent-mcp.json` and `.well-known/`, and a restrictive
Content-Security-Policy on `runtime/sandbox-worker.js`.

## Limits

- Hours by kind are rough guides for a first entry, not measurements.
- The fit serves the earliest due date first and plans work to end the day before each due
  date. It does not know about holidays or days you are away.
- A candidate is tested alone on top of your commitments. Two candidates that both fit may
  not fit together until one is added.
- `write` actions run without a dialog, and each can be undone on the page.
- Each call to Deadline Desk runs after you agree, at most once per message, on the same
  model route as the rest of the chat: this site's free allowance, or your key if you added
  one.
- On the hosted site no key is needed. The default model route is the site's own, `/llm/v1`
  (`llm_router.publisher_funded`, `js/funded-route.js`): one model, 250 calls a day for
  everyone, 80 a day for one visitor, 5,000 in total, no messages stored. With your own
  key the browser talks straight to the provider.

MIT license. The runtime in `runtime/` is Apache-2.0.
