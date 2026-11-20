// Spare Hours page logic. One Week object runs the page; the page's own forms and the
// assistant's actions call the same methods, so both follow one set of rules.
import { EFFORT, KINDS, PARTNER } from "./effort-data.js";

const DAY = 86400000;
const STORE_KEY = "spare-hours-week";
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_COMMITMENTS = 12;
const MAX_CANDIDATES = 8;
const MAX_DAY_HOURS = 16;
const MAX_HOURS = 400;
// The furthest due date the page plans for.
const MAX_DAYS_AHEAD = 730;

/** Calendar-day helpers. A day is "YYYY-MM-DD"; arithmetic runs on UTC midnights. */
export class Day {
  /** :return: The UTC midnight of a "YYYY-MM-DD" day in ms, or NaN for anything else. */
  static parse(text) {
    if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
    const ms = Date.parse(`${text}T00:00:00Z`);
    // Date.parse rolls "2027-02-31" over to March; refuse it.
    return Number.isNaN(ms) || Day.iso(ms) !== text ? NaN : ms;
  }

  /** :return: "YYYY-MM-DD" of a UTC midnight. */
  static iso(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  /** :return: "Tue, Dec 1, 2026". */
  static label(ms) {
    const d = new Date(ms);
    return `${WEEKDAY_LABELS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  /** :return: "sun" to "sat". */
  static weekday(ms) {
    return WEEKDAYS[new Date(ms).getUTCDay()];
  }
}

export class Week {
  /** Today's calendar day where the visitor is; tests replace it. */
  static today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  constructor() {
    this.version = 0;
    const saved = Week.load();
    this.hours = saved.hours;
    this.commitments = saved.commitments;
    this.nextId = saved.commitments.reduce((top, c) => Math.max(top, Number(c.id.slice(1)) || 0), 0) + 1;
  }

  /** An evening hour on weekdays and three hours on each weekend day. */
  static defaultHours() {
    return { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 3, sun: 3 };
  }

  /** :return: What this browser saved, with anything malformed dropped. */
  static load() {
    const fresh = { hours: Week.defaultHours(), commitments: [] };
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) || "null");
      if (!saved) return fresh;
      const hours = Week.checkHours(saved.hours || {});
      const commitments = [];
      for (const c of Array.isArray(saved.commitments) ? saved.commitments.slice(0, MAX_COMMITMENTS) : []) {
        const ok = typeof c?.id === "string" && typeof c.label === "string" && Number.isFinite(c.hours) && !Number.isNaN(Day.parse(c.dueDate));
        if (ok) commitments.push({ id: c.id, label: c.label, kind: KINDS.includes(c.kind) ? c.kind : "custom", hours: c.hours, dueDate: c.dueDate });
      }
      return { hours: hours.ok ? { ...Week.defaultHours(), ...hours.hours } : Week.defaultHours(), commitments };
    } catch {
      return fresh;
    }
  }

  save() {
    try {
      globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify({ hours: this.hours, commitments: this.commitments }));
    } catch {
      // Private browsing may refuse storage; the week still works for this visit.
    }
  }

  static hoursPerWeek(hours) {
    return WEEKDAYS.reduce((sum, d) => sum + hours[d], 0);
  }

  /**
   * Check hours given for some weekdays.
   *
   * :param input: An object of weekday ("mon" to "sun") to hours.
   * :return: {ok: true, hours} with the given days only, or {ok: false, reason}.
   */
  static checkHours(input) {
    const hours = {};
    if (!input || typeof input !== "object") return { ok: false, reason: "Give hours for at least one weekday." };
    for (const [day, value] of Object.entries(input)) {
      if (!WEEKDAYS.includes(day)) return { ok: false, reason: `"${day}" is not a weekday. Use mon, tue, wed, thu, fri, sat or sun.` };
      if (!Number.isFinite(value) || value < 0 || value > MAX_DAY_HOURS) return { ok: false, reason: `Hours for ${day} must be between 0 and ${MAX_DAY_HOURS}.` };
      if (Math.round(value * 2) !== value * 2) return { ok: false, reason: `Hours for ${day} must be in half-hour steps.` };
      hours[day] = value;
    }
    if (Object.keys(hours).length === 0) return { ok: false, reason: "Give hours for at least one weekday." };
    return { ok: true, hours };
  }

  /** Set the free hours of the given weekdays; the other days keep theirs. */
  setWeeklyHours(input) {
    const checked = Week.checkHours(input);
    if (!checked.ok) return checked;
    this.hours = { ...this.hours, ...checked.hours };
    this.afterChange();
    return { ok: true, ...this.getState() };
  }

  /**
   * Check one piece of work: a label, hours (given, or typical for its kind) and a due day.
   *
   * :param input: {label, kind, hours, dueDate}.
   * :param today: Today as "YYYY-MM-DD".
   * :return: {ok: true, item} or {ok: false, reason}.
   */
  static checkItem(input, today) {
    const label = String(input?.label ?? "").trim();
    if (!label || label.length > 80) return { ok: false, reason: "Give a label of 1 to 80 characters." };
    const kind = input.kind === undefined || input.kind === "" ? "custom" : input.kind;
    if (kind !== "custom" && !KINDS.includes(kind)) return { ok: false, reason: `"${kind}" is not a kind this site knows. Use one of: ${KINDS.join(", ")}, or give hours.` };
    let hours = input.hours;
    if (hours === undefined || hours === null || hours === "") {
      if (kind === "custom") return { ok: false, reason: `Give the hours "${label}" needs, or a kind with typical hours: ${KINDS.join(", ")}.` };
      hours = EFFORT[kind];
    }
    if (!Number.isFinite(hours) || hours < 0.5 || hours > MAX_HOURS) return { ok: false, reason: `Hours must be between 0.5 and ${MAX_HOURS}.` };
    const due = Day.parse(input.dueDate);
    const start = Day.parse(today);
    if (Number.isNaN(due)) return { ok: false, reason: "Give the due date as YYYY-MM-DD." };
    if (due <= start) return { ok: false, reason: `The due date must be after today (${today}).` };
    if (due - start > MAX_DAYS_AHEAD * DAY) return { ok: false, reason: "The due date must be within two years." };
    return { ok: true, item: { label, kind, hours, dueDate: input.dueDate } };
  }

  addCommitment(input) {
    const checked = Week.checkItem(input, Week.today());
    if (!checked.ok) return checked;
    if (this.commitments.length >= MAX_COMMITMENTS) return { ok: false, reason: `The list is full (${MAX_COMMITMENTS}). Remove one first.` };
    const same = this.commitments.find(c => c.label.toLowerCase() === checked.item.label.toLowerCase());
    if (same) return { ok: false, reason: `"${same.label}" is already on the list.` };
    const added = { id: `c${this.nextId}`, ...checked.item };
    this.nextId += 1;
    this.commitments.push(added);
    this.afterChange();
    return { ok: true, added: added.id, ...this.getState() };
  }

  removeCommitment(id) {
    const index = this.commitments.findIndex(c => c.id === id);
    if (index < 0) return { ok: false, reason: `No commitment "${id}" is on the list. Read the list again for the ids.` };
    this.commitments.splice(index, 1);
    this.afterChange();
    return { ok: true, removed: id, ...this.getState() };
  }

  afterChange() {
    this.version += 1;
    this.save();
    this.render();
  }

  /** :return: Free hours from fromMs up to, not including, toMs. Work stops the day before a due date. */
  static capacity(hours, fromMs, toMs) {
    let sum = 0;
    for (let ms = fromMs; ms < toMs; ms += DAY) sum += hours[Day.weekday(ms)];
    return sum;
  }

  /** :return: The latest day to start `need` hours and finish before dueMs, or null when even today is too late. */
  static latestStart(hours, todayMs, dueMs, need) {
    let sum = 0;
    for (let ms = dueMs - DAY; ms >= todayMs; ms -= DAY) {
      sum += hours[Day.weekday(ms)];
      if (sum >= need) return ms;
    }
    return null;
  }

  /**
   * Lay the items out in due-date order against the week's free hours.
   *
   * Each item is done before its due day, and earlier due dates are served first. An item
   * fits when the hours of everything due by its date fit in the free hours before it.
   *
   * :return: One row per item, in due-date order.
   */
  static schedule(hours, today, items) {
    const todayMs = Day.parse(today);
    const ordered = [...items].sort((a, b) => Day.parse(a.dueDate) - Day.parse(b.dueDate));
    let demand = 0;
    return ordered.map(item => {
      const dueMs = Day.parse(item.dueDate);
      const free = Week.capacity(hours, todayMs, dueMs);
      demand += item.hours;
      const spare = free - demand;
      const alone = Week.latestStart(hours, todayMs, dueMs, item.hours);
      return {
        ...item,
        dueLabel: Day.label(dueMs),
        daysLeft: Math.round((dueMs - todayMs) / DAY),
        freeHoursBeforeDue: free,
        fits: spare >= 0,
        // Hours left over before this due date once it and everything due earlier is done.
        spareHours: spare >= 0 ? spare : 0,
        shortByHours: spare >= 0 ? 0 : -spare,
        // With nothing else on the list. Null: even starting today is too late.
        startByAlone: alone === null ? null : Day.iso(alone),
        startByAloneLabel: alone === null ? "already too late" : Day.label(alone),
      };
    });
  }

  /**
   * Test the week as it is and, one at a time, each candidate added to it.
   *
   * :param candidates: Up to 8 items of {label, kind, hours, dueDate}. They are not saved.
   * :return: The commitments' rows and, per candidate, whether everything still fits.
   */
  checkFit(candidates = []) {
    const today = Week.today();
    if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) return { ok: false, reason: `Give at most ${MAX_CANDIDATES} candidates.` };
    const checked = [];
    for (const candidate of candidates) {
      const one = Week.checkItem(candidate, today);
      if (!one.ok) return { ok: false, reason: `${String(candidate?.label ?? "A candidate")}: ${one.reason}` };
      checked.push(one.item);
    }
    const base = Week.schedule(this.hours, today, this.commitments);
    return {
      ok: true,
      today,
      hoursPerWeek: Week.hoursPerWeek(this.hours),
      allFit: base.every(row => row.fits),
      commitments: base,
      candidates: checked.map(item => {
        const rows = Week.schedule(this.hours, today, [...this.commitments, { id: "candidate", ...item }]);
        const own = rows.find(row => row.id === "candidate");
        const { id, ...candidate } = own;
        return {
          ...candidate,
          // True when it and every commitment still fit with it added.
          fitsWithCommitments: rows.every(row => row.fits),
          wouldNotFit: rows.filter(row => !row.fits).map(row => row.label),
        };
      }),
      note: "Hours by kind are typical guides. Work is planned to finish the day before each due date.",
    };
  }

  /**
   * The public calculator: how long one entry takes at an even number of hours a week.
   * It reads no visitor's week, so the action bridge shares it with other sites.
   *
   * :param input: {kind, hours, hoursPerWeek, dueDate}; hours overrides the kind's typical hours.
   * :return: The hours, the days needed and the latest start day, or {ok: false, reason}.
   */
  static estimate(input = {}) {
    const today = Week.today();
    const checked = Week.checkItem({ label: "entry", kind: input.kind, hours: input.hours, dueDate: input.dueDate }, today);
    if (!checked.ok) return checked;
    const perWeek = input.hoursPerWeek;
    if (!Number.isFinite(perWeek) || perWeek < 0.5 || perWeek > 7 * MAX_DAY_HOURS) return { ok: false, reason: `hoursPerWeek must be between 0.5 and ${7 * MAX_DAY_HOURS}.` };
    const { kind, hours, dueDate } = checked.item;
    const todayMs = Day.parse(today);
    const dueMs = Day.parse(dueDate);
    const daysNeeded = Math.ceil(hours / (perWeek / 7));
    const startMs = dueMs - daysNeeded * DAY;
    const daysLeft = Math.round((dueMs - todayMs) / DAY);
    const fits = startMs >= todayMs;
    return {
      ok: true,
      today,
      kind,
      hours,
      hoursSource: input.hours === undefined || input.hours === null ? `typical for ${kind}` : "given",
      hoursPerWeek: perWeek,
      dueDate,
      daysLeft,
      daysNeeded,
      weeksNeeded: Math.round(daysNeeded / 7 * 10) / 10,
      fits,
      startBy: fits ? Day.iso(startMs) : null,
      startByLabel: fits ? Day.label(startMs) : "already too late at this pace",
      // What it takes to finish in time when starting today.
      hoursPerWeekNeededFromToday: Math.ceil(hours / daysLeft * 7 * 2) / 2,
      note: "Assumes the hours are spread evenly over the week, and work ends the day before the due date. Typical hours are rough guides.",
    };
  }

  getState() {
    const today = Week.today();
    const rows = Week.schedule(this.hours, today, this.commitments);
    return {
      today,
      todayLabel: Day.label(Day.parse(today)),
      hours: { ...this.hours },
      hoursPerWeek: Week.hoursPerWeek(this.hours),
      commitments: rows,
      allFit: rows.every(row => row.fits),
      typicalHoursByKind: { ...EFFORT },
      // Where the page sends a visitor who is looking for something to enter.
      partner: { ...PARTNER },
      version: this.version,
    };
  }

  /** Draw the hours, the commitments and the summary. Skips silently without a page. */
  render() {
    const doc = globalThis.document;
    if (!doc || typeof doc.getElementById !== "function") return;
    const list = doc.getElementById("commitments-list");
    const summary = doc.getElementById("fit-summary");
    if (!list || !summary) return;
    for (const day of WEEKDAYS) {
      const field = doc.getElementById(`h-${day}`);
      if (field) field.value = String(this.hours[day]);
    }
    const state = this.getState();
    const total = doc.getElementById("hours-total");
    if (total) total.textContent = `${state.hoursPerWeek} free hours a week`;
    list.replaceChildren(...state.commitments.map(row => {
      const li = doc.createElement("li");
      li.className = row.fits ? "commitment" : "commitment short";
      const title = doc.createElement("strong");
      title.textContent = row.label;
      const meta = doc.createElement("span");
      meta.className = "meta";
      meta.textContent = ` ${row.hours} h · due ${row.dueLabel} · ${row.daysLeft} days left`;
      const verdict = doc.createElement("p");
      verdict.textContent = row.fits
        ? `Fits, with ${row.spareHours} h to spare before the due date. On its own, start by ${row.startByAloneLabel}.`
        : `Does not fit: ${row.shortByHours} h short. Only ${row.freeHoursBeforeDue} free hours come before the due date.`;
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "link-button";
      button.textContent = "Remove";
      button.dataset.remove = row.id;
      li.append(title, meta, verdict, button);
      return li;
    }));
    const empty = doc.getElementById("commitments-empty");
    if (empty) empty.hidden = state.commitments.length > 0;
    if (state.commitments.length === 0) {
      summary.textContent = `Today is ${state.todayLabel}. Add something with a due date to see whether it fits.`;
    } else if (state.allFit) {
      summary.textContent = `Today is ${state.todayLabel}. Everything fits in your ${state.hoursPerWeek} hours a week.`;
    } else {
      const short = state.commitments.filter(row => !row.fits).map(row => row.label);
      summary.textContent = `Today is ${state.todayLabel}. Too much for ${state.hoursPerWeek} hours a week: ${short.join(", ")} will not be done in time.`;
    }
    summary.className = state.allFit ? "summary" : "summary short";
  }

  /** Wire the page's own forms to the same methods the assistant uses. */
  wire() {
    const doc = globalThis.document;
    if (!doc || typeof doc.getElementById !== "function") return;
    const hoursForm = doc.getElementById("hours-form");
    const hoursMessage = doc.getElementById("hours-message");
    hoursForm?.addEventListener("submit", event => {
      event.preventDefault();
      const input = {};
      for (const day of WEEKDAYS) {
        const field = doc.getElementById(`h-${day}`);
        if (field) input[day] = field.value === "" ? 0 : Number(field.value);
      }
      const result = this.setWeeklyHours(input);
      if (hoursMessage) hoursMessage.textContent = result.ok ? "" : result.reason;
    });
    const form = doc.getElementById("commitment-form");
    const message = doc.getElementById("commitment-message");
    form?.addEventListener("submit", event => {
      event.preventDefault();
      const hours = doc.getElementById("c-hours").value;
      const result = this.addCommitment({
        label: doc.getElementById("c-label").value,
        kind: doc.getElementById("c-kind").value,
        hours: hours === "" ? undefined : Number(hours),
        dueDate: doc.getElementById("c-dueDate").value,
      });
      if (message) message.textContent = result.ok ? "" : result.reason;
      if (result.ok) {
        for (const id of ["c-label", "c-hours", "c-dueDate"]) doc.getElementById(id).value = "";
      }
    });
    doc.getElementById("commitments-list")?.addEventListener("click", event => {
      const id = event.target?.dataset?.remove;
      if (id) this.removeCommitment(id);
    });
    const link = doc.getElementById("partner-link");
    if (link) {
      link.href = PARTNER.url;
      link.textContent = PARTNER.name;
    }
  }
}

/** The one page object the page and the assistant share. */
export class App {
  static page = new Week();
}

App.page.wire();
App.page.render();
