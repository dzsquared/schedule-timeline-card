/*!
 * schedule-timeline-card
 * Card customizado para entidades `schedule` do Home Assistant.
 * Modos: simple | next | calendar
 */

const CARD_VERSION = "1.0.6";
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const REFETCH_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;
const AFTER_TAP_WINDOW_MS = 15 * 60 * 1000;
const AFTER_TAP_REFETCH_MS = 5 * 1000;

// Keep English complete. Other locales may omit keys and inherit English per key.
// Use lower-case BCP 47 locale keys (e.g. "pt-br") for regional overrides.
const I18N = {
  en: {
    card: {
      on: "On",
      off: "Off",
      unavailable: "Unavailable",
      now: "Now",
      noNext: "No upcoming event",
      loading: "Loading schedule…",
      noConfig: "Schedule not found. Schedules defined in YAML are not exposed by the helper API.",
      missing: "Entity not found: {entity}",
      nextOnToday: "Turns on at {time}",
      nextOffToday: "Turns off at {time}",
      nextOnTomorrow: "Turns on tomorrow at {time}",
      nextOffTomorrow: "Turns off tomorrow at {time}",
      nextOnDay: "Turns on {day} at {time}",
      nextOffDay: "Turns off {day} at {time}",
      countdown: "in {duration}",
      lessThanMinute: "<1min",
      minutes: "{minutes}min",
      hours: "{hours}h",
      hoursMinutes: "{hours}h {minutes}min",
      daysHours: "{days}d {hours}h",
      axisHour: "{hour}h",
      nowAt: "Now ({time})",
    },
    editor: {
      entity: "Schedule entity",
      name: "Name (optional)",
      icon: "Icon (on)",
      icon_off: "Icon (off)",
      mode: "Mode",
      days: "Days displayed",
      start_hour: "Start hour",
      end_hour: "End hour",
      show_icon: "Show icon",
      show_next: "Show next event",
      show_now_marker: "Show now marker",
      show_total: "Total hours per day",
      show_legend: "Show legend",
      on_color: "On color (CSS)",
      now_color: "Now marker color (CSS)",
      modes: {
        simple: "Simple (on/off)",
        next: "Next event",
        calendar: "Calendar",
      },
    },
    errors: { missingEntity: "Define 'entity' (e.g. schedule.irrigation)" },
  },
  pt: {
    card: {
      on: "Ligado",
      off: "Desligado",
      unavailable: "Indisponível",
      now: "Agora",
      noNext: "Sem próximo evento",
      loading: "Carregando horários…",
      noConfig: "Horários não encontrados. Schedules definidos em YAML não são expostos pela API do helper.",
      missing: "Entidade não encontrada: {entity}",
      nextOnToday: "Liga às {time}",
      nextOffToday: "Desliga às {time}",
      nextOnTomorrow: "Liga amanhã às {time}",
      nextOffTomorrow: "Desliga amanhã às {time}",
      nextOnDay: "Liga {day} às {time}",
      nextOffDay: "Desliga {day} às {time}",
      countdown: "em {duration}",
      lessThanMinute: "<1min",
      minutes: "{minutes}min",
      hours: "{hours}h",
      hoursMinutes: "{hours}h {minutes}min",
      daysHours: "{days}d {hours}h",
      axisHour: "{hour}h",
      nowAt: "Agora ({time})",
    },
    editor: {
      entity: "Entidade (schedule)",
      name: "Nome (opcional)",
      icon: "Ícone (ligado)",
      icon_off: "Ícone (desligado)",
      mode: "Modo",
      days: "Dias exibidos",
      start_hour: "Hora inicial",
      end_hour: "Hora final",
      show_icon: "Mostrar ícone",
      show_next: "Mostrar próximo evento",
      show_now_marker: "Marcador de agora",
      show_total: "Total de horas por dia",
      show_legend: "Mostrar legenda",
      on_color: "Cor de ligado (CSS)",
      now_color: "Cor do marcador (CSS)",
      modes: {
        simple: "Simples (ligado/desligado)",
        next: "Próximo evento",
        calendar: "Calendário",
      },
    },
    errors: { missingEntity: "Defina 'entity' (ex.: schedule.irrigacao)" },
  },
};

// The instance language intentionally takes precedence over browser/user settings.
function serverLocale(hass) {
  const language = hass?.config?.language;
  if (typeof language !== "string" || !language.trim()) return "en";
  try {
    return Intl.getCanonicalLocales(language.trim().replace(/_/g, "-"))[0];
  } catch {
    return "en";
  }
}

function translate(locale, key, values = {}) {
  const normalized = locale.toLowerCase();
  const locales = [...new Set([normalized, normalized.split("-")[0], "en"])];
  for (const language of locales) {
    const message = key.split(".").reduce((value, part) =>
      value && Object.hasOwn(value, part) ? value[part] : undefined, I18N[language]);
    if (typeof message === "string") {
      return message.replace(/\{(\w+)\}/g, (placeholder, name) =>
        Object.hasOwn(values, name) ? String(values[name]) : placeholder);
    }
  }
  return key;
}

const translator = (hass) => {
  const locale = serverLocale(hass);
  return (key, values) => translate(locale, key, values);
};

const pad = (n) => String(n).padStart(2, "0");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clamp = (v, a, b) => {
  const n = Number(v);
  if (Number.isNaN(n)) return a;
  return Math.min(b, Math.max(a, n));
};

const fmtHM = (min) => (min >= 1440 ? "24:00" : `${pad(Math.floor(min / 60))}:${pad(min % 60)}`);

const fmtDuration = (min, t) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return t("card.minutes", { minutes: m });
  return m ? t("card.hoursMinutes", { hours: h, minutes: pad(m) }) : t("card.hours", { hours: h });
};

const fmtUntil = (minutes, t) => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return t("card.lessThanMinute");
  if (m < 60) return t("card.minutes", { minutes: m });
  if (m < 1440) return t("card.hoursMinutes", { hours: Math.floor(m / 60), minutes: pad(m % 60) });
  return t("card.daysHours", { days: Math.floor(m / 1440), hours: Math.floor((m % 1440) / 60) });
};

const parseTime = (s) => {
  const [h, m] = String(s).split(":");
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
};

const dtfCache = {};
function tzParts(date, tz) {
  let key = tz || "local";
  let f = dtfCache[key];
  if (!f) {
    const opts = {
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    };
    try {
      f = new Intl.DateTimeFormat("en-US", tz ? { ...opts, timeZone: tz } : opts);
    } catch (e) {
      f = new Intl.DateTimeFormat("en-US", opts);
    }
    dtfCache[key] = f;
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute };
}

class ScheduleTimelineCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._list = null;
    this._loading = false;
    this._lastFetch = 0;
    this._key = "";
  }

  static getConfigElement() {
    return document.createElement("schedule-timeline-card-editor");
  }

  static getStubConfig(hass) {
    const entity = Object.keys((hass && hass.states) || {}).find((id) => id.startsWith("schedule."));
    return { entity: entity || "schedule.example", mode: "calendar", days: 5 };
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error(translator(this._hass)("errors.missingEntity"));
    const days = Math.round(clamp(config.days ?? 5, 1, 7));
    let start = Math.round(clamp(config.start_hour ?? 0, 0, 23));
    let end = Math.round(clamp(config.end_hour ?? 24, 1, 24));
    if (end <= start) {
      start = 0;
      end = 24;
    }
    this._config = {
      mode: "simple",
      show_icon: true,
      show_next: true,
      show_now_marker: true,
      show_total: false,
      show_legend: true,
      tap_action: "more-info",
      ...config,
      days,
      start_hour: start,
      end_hour: end,
    };
    this._lastFetch = 0;
    this._render();
  }

  set hass(hass) {
    const locale = serverLocale(hass);
    const languageChanged = locale !== this._locale;
    this._locale = locale;
    this._hass = hass;
    if (!this._config) return;
    const st = hass.states[this._config.entity];
    const a = (st && st.attributes) || {};
    const key = st
      ? `${st.state}|${st.last_updated}|${st.last_reported || ""}|${JSON.stringify(a)}`
      : "none";
    const changed = st !== this._stateObj;
    this._stateObj = st;
    if (key !== this._key) {
      this._key = key;
      this._lastFetch = 0;
    }
    this._maybeFetch();
    if (changed || languageChanged || !this._shown) {
      this._shown = true;
      this._render();
    }
  }

  connectedCallback() {
    this._onDialogClosed = () => {
      if (!this._config || Date.now() > (this._afterTapUntil || 0)) return;
      this._lastFetch = 0;
      setTimeout(() => this._maybeFetch(), 400);
    };
    document.addEventListener("dialog-closed", this._onDialogClosed);
    this._timer = setInterval(() => {
      this._maybeFetch();
      this._render();
    }, TICK_MS);
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    document.removeEventListener("dialog-closed", this._onDialogClosed);
  }

  _maybeFetch() {
    if (!this._config || !this._hass || this._loading || !this._needsConfig()) return;
    const age = Date.now() - this._lastFetch;
    const afterTap = Date.now() < (this._afterTapUntil || 0);
    if (age > REFETCH_MS || (afterTap && age > AFTER_TAP_REFETCH_MS)) this._fetch();
  }

  getCardSize() {
    const c = this._config || {};
    if (c.mode === "calendar") return 2 + (c.days || 5) * 0.6;
    return c.mode === "next" ? 2 : 1;
  }

  getGridOptions() {
    const c = this._config || {};
    return { columns: c.mode === "simple" ? 6 : 12, rows: "auto", min_columns: 3 };
  }

  _needsConfig() {
    const c = this._config;
    if (!c) return false;
    const a = (this._stateObj && this._stateObj.attributes) || {};
    return c.mode === "calendar" || (c.mode === "next" && !a.next_event);
  }

  async _fetch() {
    if (this._loading || !this._hass || !this._hass.callWS) return;
    this._loading = true;
    try {
      const list = await this._hass.callWS({ type: "schedule/list" });
      this._list = Array.isArray(list) ? list : [];
    } catch (e) {
      this._list = [];
    }
    this._lastFetch = Date.now();
    this._loading = false;
    this._render();
  }

  _findSchedule() {
    if (!this._list) return null;
    const id = this._config.entity.split(".")[1];
    const fn = this._stateObj && this._stateObj.attributes.friendly_name;
    return this._list.find((i) => i.id === id) || this._list.find((i) => i.name === fn) || null;
  }

  _t() {
    return translator(this._hass);
  }

  _lang() {
    return serverLocale(this._hass);
  }

  _wd(dt) {
    let s;
    try {
      s = new Intl.DateTimeFormat(this._lang(), { weekday: "short", timeZone: "UTC" }).format(dt);
    } catch (e) {
      s = DAY_KEYS[dt.getUTCDay()].slice(0, 3);
    }
    s = s.replace(/\.$/, "");
    return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${pad(dt.getUTCDate())}`;
  }

  _icon(isOn) {
    const c = this._config;
    const entIcon = this._stateObj && this._stateObj.attributes.icon;
    const base = c.icon || entIcon || "mdi:calendar-clock";
    return isOn ? base : c.icon_off || base;
  }

  _next(np, nowMin, now, sch) {
    const st = this._stateObj;
    const tz = this._hass.config && this._hass.config.time_zone;
    const na = st.attributes.next_event;
    if (na) {
      const d = new Date(na);
      if (!Number.isNaN(d.getTime())) {
        const p = tzParts(d, tz);
        return {
          dayDiff: Math.round((Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(np.y, np.m - 1, np.d)) / 864e5),
          min: p.h * 60 + p.min,
          until: (d.getTime() - now.getTime()) / 60000,
        };
      }
    }
    if (!sch) return null;
    const ivs = [];
    for (let off = 0; off <= 7; off++) {
      const key = DAY_KEYS[new Date(Date.UTC(np.y, np.m - 1, np.d + off)).getUTCDay()];
      for (const it of sch[key] || []) {
        ivs.push([off * 1440 + parseTime(it.from), off * 1440 + parseTime(it.to)]);
      }
    }
    ivs.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of ivs) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    let target = null;
    for (const iv of merged) {
      if (nowMin >= iv[0] && nowMin < iv[1]) {
        target = iv[1];
        break;
      }
      if (iv[0] > nowMin) {
        target = iv[0];
        break;
      }
    }
    if (target === null) return null;
    return { dayDiff: Math.floor(target / 1440), min: target % 1440, until: target - nowMin };
  }

  _nextLabel(n, isOn, np, t) {
    if (!n) return t("card.noNext");
    const action = isOn ? "Off" : "On";
    const time = fmtHM(n.min);
    if (n.dayDiff <= 0) return t(`card.next${action}Today`, { time });
    if (n.dayDiff === 1) return t(`card.next${action}Tomorrow`, { time });
    const dt = new Date(Date.UTC(np.y, np.m - 1, np.d + n.dayDiff));
    return t(`card.next${action}Day`, { day: this._wd(dt), time });
  }

  _calendar(np, nowMin, t, sch) {
    const c = this._config;
    if (!this._list) return `<div class="msg">${esc(t("card.loading"))}</div>`;
    if (!sch) return `<div class="msg">${esc(t("card.noConfig"))}</div>`;

    const S = c.start_hour * 60;
    const E = c.end_hour * 60;
    const span = E - S;
    const pct = (m) => ((m - S) / span) * 100;
    const nowPct = pct(nowMin);
    const showNow = c.show_now_marker && nowMin >= S && nowMin <= E;

    const spanH = span / 60;
    const step = spanH > 12 ? 6 : spanH > 6 ? 2 : 1;
    let ticksHtml = "";
    for (let h = Math.ceil(S / 60 / step) * step; h * 60 <= E; h += step) {
      const p = pct(h * 60);
      const tf = p <= 0 ? "none" : p >= 100 ? "translateX(-100%)" : "translateX(-50%)";
      ticksHtml += `<span class="tick" style="left:${p.toFixed(2)}%;transform:${tf}">${esc(t("card.axisHour", { hour: h }))}</span>`;
    }
    const totSpacer = c.show_total ? `<div class="tot"></div>` : "";
    let html = `<div class="grid"><div class="day axis"><div class="lbl"></div><div class="ticks">${ticksHtml}</div>${totSpacer}</div>`;

    for (let i = 0; i < c.days; i++) {
      const dt = new Date(Date.UTC(np.y, np.m - 1, np.d + i));
      const items = sch[DAY_KEYS[dt.getUTCDay()]] || [];
      let blocks = "";
      let total = 0;
      for (const it of items) {
        const from = parseTime(it.from);
        const to = parseTime(it.to);
        total += Math.max(0, to - from);
        const a = Math.max(from, S);
        const b = Math.min(to, E);
        if (b <= a) continue;
        let tip = `${fmtHM(from)} \u2192 ${fmtHM(to)} (${fmtDuration(to - from, t)})`;
        if (it.data && typeof it.data === "object") {
          const extra = Object.entries(it.data).map(([k, v]) => `${k}: ${v}`).join(", ");
          if (extra) tip += `\n${extra}`;
        }
        blocks += `<div class="blk" title="${esc(tip)}" style="left:${pct(a).toFixed(2)}%;width:${(((b - a) / span) * 100).toFixed(2)}%"></div>`;
      }
      const today = i === 0;
      const marker = today && showNow ? `<div class="now" style="left:${nowPct.toFixed(2)}%"></div>` : "";
      const tot = c.show_total ? `<div class="tot">${total ? esc(fmtDuration(total, t)) : "\u2013"}</div>` : "";
      html += `<div class="day${today ? " today" : ""}"><div class="lbl">${esc(this._wd(dt))}</div><div class="track">${blocks}${marker}</div>${tot}</div>`;
    }
    html += `</div>`;

    if (c.show_legend) {
      html += `<div class="legend"><span><i class="dot"></i>${esc(t("card.on"))}</span>`;
      if (showNow) html += `<span><i class="bar"></i>${esc(t("card.nowAt", { time: fmtHM(nowMin) }))}</span>`;
      html += `</div>`;
    }
    return html;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const c = this._config;
    const st = this._stateObj;
    const t = this._t();
    const root = this.shadowRoot;

    if (!st) {
      root.innerHTML = `<style>${STYLE}</style><ha-card><div class="msg">${esc(t("card.missing", { entity: c.entity }))}</div></ha-card>`;
      return;
    }

    const now = new Date();
    const tz = this._hass.config && this._hass.config.time_zone;
    const np = tzParts(now, tz);
    const nowMin = np.h * 60 + np.min;
    const isOn = st.state === "on";
    const unavailable = st.state === "unavailable" || st.state === "unknown";
    const name = c.name || st.attributes.friendly_name || c.entity;
    const sch = this._findSchedule();

    const stateText = unavailable ? t("card.unavailable") : isOn ? t("card.on") : t("card.off");
    const needNext = c.mode === "next" || (c.mode === "calendar" && c.show_next);
    const n = needNext && !unavailable ? this._next(np, nowMin, now, sch) : null;
    const nextLabel = needNext ? (unavailable ? t("card.unavailable") : this._nextLabel(n, isOn, np, t)) : "";
    const countdown = n ? t("card.countdown", { duration: fmtUntil(n.until, t) }) : "";

    let info;
    let chip = `<span class="chip${isOn ? " on" : ""}">${esc(stateText)}</span>`;
    if (c.mode === "simple") {
      info = `<div class="name">${esc(name)}</div><div class="sub${isOn ? " on" : ""}">${esc(stateText)}</div>`;
      chip = "";
    } else if (c.mode === "next") {
      info = `<div class="name">${esc(name)}</div><div class="sub nextline"><span class="strong">${esc(nextLabel)}</span>${countdown ? ` \u00b7 ${esc(countdown)}` : ""}</div>`;
    } else {
      const line = [nextLabel, countdown].filter(Boolean).join(" \u00b7 ");
      info = `<div class="name">${esc(name)}</div>${c.show_next ? `<div class="sub">${esc(line)}</div>` : ""}`;
    }

    const icon = c.show_icon
      ? `<div class="ico${isOn ? " on" : ""}"><ha-icon icon="${esc(this._icon(isOn))}"></ha-icon></div>`
      : "";
    const onColor = c.on_color || "var(--success-color, #43a047)";
    const nowColor = c.now_color || "var(--error-color, #db4437)";
    const tap = typeof c.tap_action === "object" ? c.tap_action.action : c.tap_action;
    const clickable = tap !== "none";
    const body = c.mode === "calendar" ? this._calendar(np, nowMin, t, sch) : "";

    root.innerHTML = `<style>${STYLE}</style><ha-card class="${clickable ? "click" : ""}${c.mode !== "calendar" ? " compact" : ""}" style="--on:${esc(onColor)};--nowc:${esc(nowColor)}"><div class="head">${icon}<div class="info">${info}</div>${chip}</div>${body}</ha-card>`;

    if (clickable) {
      const card = root.querySelector("ha-card");
      if (card) {
        card.addEventListener("click", () => {
          this._afterTapUntil = Date.now() + AFTER_TAP_WINDOW_MS;
          this.dispatchEvent(
            new CustomEvent("hass-more-info", { detail: { entityId: c.entity }, bubbles: true, composed: true })
          );
        });
      }
    }
  }
}

const STYLE = `
:host{display:block;container-type:inline-size}
ha-card{padding:12px 16px;overflow:hidden}
ha-card.click{cursor:pointer}
ha-card.compact{padding:8px 12px}
.sub.nextline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strong{color:var(--primary-text-color);font-weight:500}
@container (max-width:300px){.chip{display:none}}
.head{display:flex;align-items:center;gap:12px}
.ico{flex:none;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--secondary-text-color) 15%,transparent);color:var(--secondary-text-color)}
.ico.on{background:color-mix(in srgb,var(--on) 18%,transparent);color:var(--on)}
.info{flex:1;min-width:0}
.name{font-size:14px;font-weight:500;color:var(--primary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.main{font-size:16px;font-weight:500;color:var(--primary-text-color);line-height:1.35}
.sub{font-size:12px;color:var(--secondary-text-color);line-height:1.4}
.sub.on{color:var(--on)}
.chip{flex:none;font-size:12px;padding:2px 10px;border-radius:12px;background:color-mix(in srgb,var(--secondary-text-color) 15%,transparent);color:var(--secondary-text-color)}
.chip.on{background:color-mix(in srgb,var(--on) 18%,transparent);color:var(--on)}
.grid{margin-top:12px}
.day{display:flex;align-items:center;gap:8px;padding:4px 6px;margin:0 -6px;border-radius:8px}
.day.today{background:color-mix(in srgb,var(--primary-color) 12%,transparent)}
.day.axis{padding-top:0;padding-bottom:2px}
.lbl{flex:none;width:50px;font-size:12px;color:var(--secondary-text-color)}
.today .lbl{color:var(--primary-color);font-weight:500}
.track{flex:1;position:relative;height:20px;border-radius:4px;background:color-mix(in srgb,var(--secondary-text-color) 15%,transparent)}
.blk{position:absolute;top:0;bottom:0;border-radius:3px;background:var(--on);opacity:.85}
.today .blk{opacity:1}
.now{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--nowc)}
.ticks{flex:1;position:relative;height:14px;font-size:11px;color:var(--secondary-text-color)}
.tick{position:absolute;top:0;white-space:nowrap}
.tot{flex:none;width:48px;text-align:right;font-size:11px;color:var(--secondary-text-color)}
.legend{display:flex;gap:14px;margin-top:10px;font-size:11px;color:var(--secondary-text-color)}
.legend span{display:inline-flex;align-items:center;gap:5px}
.dot{width:10px;height:10px;border-radius:2px;background:var(--on);display:inline-block}
.bar{width:2px;height:10px;background:var(--nowc);display:inline-block}
.msg{padding:8px 0;font-size:13px;color:var(--secondary-text-color)}
`;

const EDITOR_DEFAULTS = {
  mode: "simple",
  days: 5,
  start_hour: 0,
  end_hour: 24,
  show_icon: true,
  show_next: true,
  show_now_marker: true,
  show_total: false,
  show_legend: true,
};

const editorSchema = (t) => [
  { name: "entity", required: true, selector: { entity: { domain: "schedule" } } },
  { name: "name", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "icon", selector: { icon: {} } },
      { name: "icon_off", selector: { icon: {} } },
    ],
  },
  {
    name: "mode",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "simple", label: t("editor.modes.simple") },
          { value: "next", label: t("editor.modes.next") },
          { value: "calendar", label: t("editor.modes.calendar") },
        ],
      },
    },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "days", selector: { number: { min: 1, max: 7, mode: "box" } } },
      { name: "start_hour", selector: { number: { min: 0, max: 23, mode: "box" } } },
      { name: "end_hour", selector: { number: { min: 1, max: 24, mode: "box" } } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "show_icon", selector: { boolean: {} } },
      { name: "show_next", selector: { boolean: {} } },
      { name: "show_now_marker", selector: { boolean: {} } },
      { name: "show_total", selector: { boolean: {} } },
      { name: "show_legend", selector: { boolean: {} } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "on_color", selector: { text: {} } },
      { name: "now_color", selector: { text: {} } },
    ],
  },
];

class ScheduleTimelineCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const locale = serverLocale(hass);
    const languageChanged = locale !== this._locale;
    this._locale = locale;
    this._hass = hass;
    if (languageChanged) this._render();
    else if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = ev.detail.value;
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    const t = translator(this._hass);
    this._form.computeLabel = (schema) => {
      if (!schema.name) return "";
      const key = `editor.${schema.name}`;
      const label = t(key);
      return label === key ? schema.name : label;
    };
    this._form.schema = editorSchema(t);
    this._form.data = { ...EDITOR_DEFAULTS, ...this._config };
  }
}

customElements.define("schedule-timeline-card", ScheduleTimelineCard);
customElements.define("schedule-timeline-card-editor", ScheduleTimelineCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "schedule-timeline-card",
  name: "Schedule Timeline Card",
  description: "Displays schedule entities: state, next event, and a daily timeline.",
});

console.info(`%c SCHEDULE-TIMELINE-CARD %c v${CARD_VERSION} `, "color:#fff;background:#43a047;font-weight:500", "color:#43a047");
