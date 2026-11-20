// Spare Hours data: the hours a first-time entrant typically spends on one entry, by kind,
// and the one site this page sends visitors to. The page, the assistant's actions and the
// action bridge all read this file.

/** Typical working hours for one entry, start to submit. Rough guides, not promises. */
export const EFFORT = {
  "hackathon": 40,
  "data-science": 50,
  "film": 30,
  "essay-prize": 25,
  "writing": 20,
  "design": 18,
  "business-idea": 15,
  "poetry": 3,
};

export const KINDS = Object.keys(EFFORT);

/** Where the page sends a visitor who is looking for something to enter. */
export const PARTNER = {
  name: "Deadline Desk",
  url: "https://deadline-desk-agent.vercel.app/",
  offers: "open prize contests and hackathons, with deadlines, prizes and rules on AI",
};
