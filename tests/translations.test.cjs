const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const { join } = require('node:path');

function load() {
  class Element {
    constructor() { this.listeners = {}; this.children = []; }
    attachShadow() { this.shadowRoot = { innerHTML: '', querySelector: () => null }; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    appendChild(child) { this.children.push(child); }
    dispatchEvent(event) { this.lastEvent = event; }
  }
  const context = vm.createContext({
    HTMLElement: Element,
    document: { createElement: () => new Element() },
    customElements: { define() {} },
    window: {},
    // Deliberately different from the server setting.
    navigator: { language: 'pt-BR' },
    console: { info() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
  });
  vm.runInContext(readFileSync(join(__dirname, '../schedule-timeline-card.js'), 'utf8') + `
    globalThis.api = { I18N, translate, serverLocale, translator, fmtDuration, fmtUntil,
      ScheduleTimelineCard, ScheduleTimelineCardEditor };
  `, context);
  return context.api;
}

const state = { state: 'on', last_updated: '2026-11-21', attributes: {} };
const hass = (language) => ({
  config: { language, time_zone: 'UTC' },
  locale: { language: 'fr' },
  states: { 'schedule.test': state },
});

function messages(dictionary, prefix = '') {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : messages(value, path);
  });
}

test('uses the server language, ignores browser and user language, defaults safely', () => {
  const { serverLocale, translator } = load();
  assert.equal(serverLocale(hass('pt_BR')), 'pt-BR');
  assert.equal(translator(hass('en'))('editor.entity'), 'Schedule entity');
  for (const language of [undefined, null, '', '   ', 'invalid_locale!', 42]) {
    assert.equal(serverLocale(hass(language)), 'en');
  }
  assert.equal(serverLocale(undefined), 'en');
});

test('exact locale, base language, and English fallbacks apply per key', () => {
  const { I18N, translate } = load();
  I18N['pt-br'] = { card: { on: 'Regional on' } };
  I18N.es = { card: { on: 'Encendido' } };
  I18N.fr = { card: { on: 'Allumé' } };
  assert.equal(translate('pt-BR', 'card.on'), 'Regional on');
  assert.equal(translate('pt-BR', 'editor.mode'), 'Modo');
  assert.equal(translate('es-MX', 'card.on'), 'Encendido');
  assert.equal(translate('es-MX', 'editor.mode'), 'Mode');
  assert.equal(translate('fr', 'card.on'), 'Allumé');
  assert.equal(translate('de-DE', 'card.on'), 'On');
  assert.equal(translate('en', 'unknown.key'), 'unknown.key');
});

test('supplied translation keys and placeholders match the English dictionary', () => {
  const { I18N } = load();
  const english = new Map(messages(I18N.en));
  for (const [locale, dictionary] of Object.entries(I18N)) {
    const entries = new Map(messages(dictionary));
    for (const [key, value] of entries) {
      assert.ok(english.has(key), `${locale}: unknown translation key ${key}`);
      const placeholders = (message) => [...message.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      assert.deepEqual(placeholders(value), placeholders(english.get(key)), `${locale}: ${key}`);
    }
  }
});

test('complete messages allow word order changes and literal placeholder values', () => {
  const { I18N, translate } = load();
  I18N.xx = { card: { nextOnToday: '{time}: activate' } };
  assert.equal(translate('xx', 'card.nextOnToday', { time: '09:00' }), '09:00: activate');
  assert.equal(translate('en', 'card.missing', { entity: '$& {time}' }), 'Entity not found: $& {time}');
});

test('editor updates labels and options on server language changes and preserves YAML', () => {
  const { ScheduleTimelineCardEditor } = load();
  for (const hassFirst of [false, true]) {
    const editor = new ScheduleTimelineCardEditor();
    const config = { entity: 'schedule.test', mode: 'calendar', days: 7 };
    if (hassFirst) editor.hass = hass('en');
    editor.setConfig(config);
    if (!hassFirst) editor.hass = hass('en');
    const form = editor._form;
    assert.equal(form.computeLabel({ name: 'entity' }), 'Schedule entity');
    assert.equal(form.computeLabel({ name: '' }), '');
    const oldSchema = form.schema;
    editor.hass = hass('pt-BR');
    assert.equal(editor._form, form);
    assert.notEqual(form.schema, oldSchema);
    assert.equal(form.computeLabel({ name: 'entity' }), 'Entidade (schedule)');
    const options = form.schema.find(s => s.name === 'mode').selector.select.options;
    assert.equal(options.find(o => o.value === 'calendar').label, 'Calendário');
    assert.equal(editor._config, config);
    const saved = { ...config, mode: 'next' };
    form.listeners['value-changed']({ stopPropagation() {}, detail: { value: saved } });
    assert.equal(editor.lastEvent.type, 'config-changed');
    assert.equal(editor.lastEvent.detail.config, saved);
  }
});

test('all card modes refresh on language change even with the same entity object', () => {
  const { ScheduleTimelineCard } = load();
  for (const mode of ['simple', 'next', 'calendar']) {
    const card = new ScheduleTimelineCard();
    card.setConfig({ entity: 'schedule.test', mode, show_total: true, tap_action: 'none' });
    card._maybeFetch = () => {};
    card._list = [{ id: 'test', ...Object.fromEntries(
      ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        .map(day => [day, [{ from: '00:00', to: '24:00' }]])
    ) }];
    card.hass = hass('en');
    assert.match(card.shadowRoot.innerHTML, />On</);
    card.hass = hass('pt');
    assert.match(card.shadowRoot.innerHTML, />Ligado</);
    assert.equal(card._lang(), 'pt');
    card.hass = hass('de-DE');
    assert.match(card.shadowRoot.innerHTML, />On</);
    assert.equal(card._lang(), 'de-DE');
  }
});

test('next-event templates cover both states and each day variant', () => {
  const { ScheduleTimelineCard, translator } = load();
  const card = new ScheduleTimelineCard();
  card.hass = hass('en');
  const np = { y: 2026, m: 11, d: 21 };
  for (const isOn of [true, false]) {
    for (const dayDiff of [0, 1, 3]) {
      const label = card._nextLabel({ dayDiff, min: 540 }, isOn, np, translator(hass('en')));
      assert.match(label, new RegExp(isOn ? '^Turns off' : '^Turns on'));
      assert.match(label, /at 09:00$/);
      assert.doesNotMatch(label, /\{|card\./);
    }
  }
});

test('errors, missing entities, durations and countdowns use dictionaries', () => {
  const { ScheduleTimelineCard, translator, fmtDuration, fmtUntil } = load();
  const card = new ScheduleTimelineCard();
  assert.throws(() => card.setConfig({}), /Define 'entity'/);
  card.hass = hass('pt');
  assert.throws(() => card.setConfig({}), /Defina 'entity'/);
  card.setConfig({ entity: 'schedule.<missing>' });
  card.hass = hass('en');
  assert.match(card.shadowRoot.innerHTML, /Entity not found: schedule.&lt;missing&gt;/);
  const t = translator(hass('en'));
  assert.equal(fmtDuration(30, t), '30min');
  assert.equal(fmtDuration(60, t), '1h');
  assert.equal(fmtDuration(90, t), '1h 30min');
  assert.equal(fmtUntil(0, t), '<1min');
  assert.equal(fmtUntil(10, t), '10min');
  assert.equal(fmtUntil(90, t), '1h 30min');
  assert.equal(fmtUntil(1500, t), '1d 1h');
});
