/* Probe headless do mw-tab-purifier-card — monta card e editor fora do
 * navegador com o mesmo shim de DOM dos irmãos. Pega o que dói perder sem
 * abrir o HA: a leitura das entidades do purificador LocalTuya, os três
 * mostradores na escala canônica (regra 90), nível/modo, a aba de
 * esterilização com as condições, a tomada e o log.
 *
 * Roda no CI e antes de qualquer PR:  node tools/probe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ------------------------------- shim DOM ------------------------------- */

const mkStyle = () => {
  const s = { _p: {} };
  s.setProperty = (k, v) => { s._p[k] = String(v); };
  s.removeProperty = (k) => { delete s._p[k]; };
  s.get = (k) => s._p[k];
  return s;
};

class Node {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.style = mkStyle();
    this.children = [];
    this.dataset = {};
    this._attrs = {};
    this._listeners = {};
    this._q = new Map();
    this._classes = new Set();
    this.innerHTML = "";
    this.textContent = "";
    this.hidden = false;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
      toggle: (c, on) => (on === undefined
        ? (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c))
        : (on ? this._classes.add(c) : this._classes.delete(c))),
    };
  }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  append(...n) { n.forEach((x) => this.appendChild(x)); }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  replaceChild(nw, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) this.children[i] = nw;
    nw.parentNode = this;
  }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  removeEventListener() {}
  dispatchEvent(ev) { (this._listeners[ev && ev.type] || []).forEach((f) => f(ev)); return true; }
  // memoiza por seletor: o código só consulta seletores fixos
  querySelector(sel) {
    if (!this._q.has(sel)) this._q.set(sel, new Node("div"));
    return this._q.get(sel);
  }
  querySelectorAll() { return []; }
  getElementById(id) { return this.querySelector("#" + id); }
  focus() {}
}

global.Node = Node;
global.HTMLElement = class extends Node {
  attachShadow() { this.shadowRoot = new Node("shadow-root"); return this.shadowRoot; }
};
global.CustomEvent = class {
  constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
};
const reg = {};
global.customElements = {
  define: (n, c) => { reg[n] = c; },
  get: (n) => reg[n],
  whenDefined: () => Promise.resolve(),
};
global.document = { createElement: (t) => new Node(t), body: new Node("body") };
// no Node 24 `navigator` é getter-only: define por cima, não por atribuição
Object.defineProperty(global, "navigator", { value: { vibrate: () => {} }, configurable: true });

// helpers de bolso: os "cards de dentro" viram nós marcados
global.window = {
  customCards: [],
  localStorage: { _v: {}, getItem(k) { return k in this._v ? this._v[k] : null; }, setItem(k, v) { this._v[k] = v; } },
  dispatchEvent: () => {},
  loadCardHelpers: async () => ({
    createCardElement(cfg) {
      const el = new Node("div");
      el._cfg = cfg;
      el.getCardSize = () => 2;
      return el;
    },
  }),
};

const infoBanner = [];
const realInfo = console.info;
console.info = (...a) => infoBanner.push(a.join(" "));

const SRC = path.join(__dirname, "..", "dist", "mw-tab-purifier-card.js");
eval(fs.readFileSync(SRC, "utf8"));
console.info = realInfo;

let pass = 0; const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

/* ------------------------------- hass falso ------------------------------ */

const DEV = "00a22ed54e157a886a7444c6352f2495";
const AR = "sensor-qualidade-ar";
const TOMADA = "tomada-purificador";
const P = "escritorio_purificador_de_ar_do_escritorio_local";
const HASS = {
  areas: { escritorio: { name: "Escritório" } },
  devices: { [DEV]: { name: "Purificador Escritório" }, [AR]: { name: "Qualidade do Ar" },
             [TOMADA]: { name: "Tomada Purificador" } },
  entities: {}, states: {}, callService() {},
};
const add = (id, dev, nome, extra, attrs) => {
  HASS.entities[id] = Object.assign({ device_id: dev }, extra || {});
  HASS.states[id] = { state: "off", attributes: Object.assign({ friendly_name: nome }, attrs || {}) };
};
// purificador LocalTuya
add(`fan.${P}_fan`, DEV, "Fan");
add(`light.${P}_state_light`, DEV, "State Light");
add(`switch.${P}_child_lock`, DEV, "Child Lock");
add(`switch.${P}_reset_filter_cartridge`, DEV, "Reset Filter Cartridge");
add(`select.${P}_nivel_de_velocidade`, DEV, "Nível de velocidade");
add(`select.${P}_modo`, DEV, "Modo");
// sensor de qualidade do ar (nomes em português, sem device_class — LocalTuya)
add("sensor.qualidade_do_ar_do_escritorio_dioxido_de_carbono", AR, "Dióxido de carbono");
add("sensor.qualidade_do_ar_do_escritorio_vocs", AR, "VOCs");
add("sensor.qualidade_do_ar_do_escritorio_formaldeido", AR, "Formaldeído");
// tomada Tuya
add("switch.tomada_do_purificador_de_ar_do_escritorio_local_tomada", TOMADA, "Tomada");
add("sensor.tomada_do_purificador_de_ar_do_escritorio_local_voltagem", TOMADA, "Voltagem");
add("sensor.tomada_do_purificador_de_ar_do_escritorio_local_corrente", TOMADA, "Corrente");
add("sensor.tomada_do_purificador_de_ar_do_escritorio_local_potencia", TOMADA, "Potência");
add("sensor.tomada_do_purificador_de_ar_do_escritorio_local_energia", TOMADA, "Energia");
// cena de esterilização
add("scene.esterilizar_escritorio_em_um_minuto", null, "Esterilizar escritório em um minuto");
add("switch.purificador_de_ar_do_escritorio_potencia", null, "Potência");

const mk = (cfg) => {
  const el = new (customElements.get("mw-tab-purifier-card"))();
  el.isConnected = true;
  el.setConfig(cfg);
  el.hass = HASS;
  return el;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

ok(!!customElements.get("mw-tab-purifier-card"), "custom element não registrado");
ok(!!customElements.get("mw-tab-purifier-card-editor"), "editor não registrado");

(async () => {
  const card = mk({
    device: DEV, air_device: AR, socket_device: TOMADA,
    image: "/local/devices/purificador-ekaza-air-master.webp",
    sterilize_scene: "scene.esterilizar_escritorio_em_um_minuto",
    sterilize_when: ["switch.tomada_do_purificador_de_ar_do_escritorio_local_tomada",
                     "switch.purificador_de_ar_do_escritorio_potencia"],
    log_entities: [`fan.${P}_fan`, "switch.tomada_do_purificador_de_ar_do_escritorio_local_tomada"],
  });
  await tick(); await tick(); await tick();
  const cfg = card._child && card._child._cfg;
  ok(!!cfg, "o card não montou o custom:mw-tab-card");
  if (cfg) {
    eq(cfg.type, "custom:mw-tab-card", "tipo do filho");
    eq(cfg.paper_color, "orange-7", "papel padrão");
    eq(cfg.tab_icon_size, 34, "ícone de aba 34px");
    eq(cfg.tab_align, "start", "fila de abas no começo");
    eq(cfg.tabs.length, 4, "quatro abas");
    eq(cfg.tabs.map((t) => t.label), ["PURIFICADOR", "ESTERILIZAR", "ENERGIA", "LOG"], "rótulos das abas");

    // ---- mostradores na escala canônica (regra 90)
    const g = cfg.tabs[0].cards[0];
    eq(g.type, "grid", "grade dos mostradores");
    eq(g.columns, 3, "três colunas");
    eq(g.cards.length, 3, "três mostradores (CO₂, VOC, formaldeído)");
    const co2 = g.cards[0];
    eq(co2.type, "custom:modern-circular-gauge", "mostrador redondo");
    eq(co2.entity, "sensor.qualidade_do_ar_do_escritorio_dioxido_de_carbono", "sensor de CO₂ achado pelo nome");
    eq(co2.name, "CO₂", "rótulo curto do CO₂");
    eq([co2.min, co2.max], [350, 2000], "faixa do CO₂ (regra 90)");
    eq(co2.segments, [{ from: 350, color: "#43a047" }, { from: 800, color: "#ffa600" },
      { from: 1200, color: "#db4437" }], "degraus do CO₂ (regra 90)");
    eq(co2.needle, true, "ponteiro ligado");
    ok(co2.card_mod && /linear-gradient\(145deg, #fdfaf3/.test(co2.card_mod.style), "papel no mostrador");
    eq([g.cards[1].min, g.cards[1].max], [0, 2], "faixa do TVOC");
    eq(g.cards[1].segments[1].from, 0.3, "atenção do TVOC em 0,3");
    eq([g.cards[2].min, g.cards[2].max], [0, 0.3], "faixa do formaldeído");
    eq(g.cards[2].segments[2].from, 0.1, "ruim do formaldeído em 0,1");

    // ---- foto + botões do aparelho
    const col = cfg.tabs[0].cards[1].cards[1];
    eq(cfg.tabs[0].cards[1].cards[0].type, "picture", "a foto");
    eq(col.cards.length, 3, "2 espaçadores + o card dos botões");
    const hum = col.cards[2];
    eq(hum.type, "custom:mw-humidifier-card", "card dos botões");
    eq(hum.mode, "only_humidifier", "modo só controles");
    eq(hum.confirm_buttons, true, "confirmação nos botões");
    eq(hum.button_icon_size, 65, "ícone dos botões");
    eq(hum.buttons.map((b) => b.entity), [`fan.${P}_fan`, `light.${P}_state_light`,
      `switch.${P}_child_lock`, `switch.${P}_reset_filter_cartridge`], "ordem ligar → LED → trava → filtro");
    eq(hum.buttons.map((b) => b.icon), ["mdi:power", "mdi:led-on", "mdi:lock", "mdi:air-filter"], "ícones dos botões");

    eq(cfg.tabs[0].cards[2], { type: "heading", heading: "🫁 PURIFICADOR DE AR", heading_style: "title" }, "título da aba");

    // ---- nível e modo
    const niveis = cfg.tabs[0].cards[3].cards;
    eq(niveis.length, 2, "nível e modo");
    eq(niveis[0].entity, `select.${P}_nivel_de_velocidade`, "seletor de nível");
    eq(niveis[0].name, "NÍVEL", "nome do nível");
    eq(niveis[0].level_scheme, "semaforo", "semáforo no nível");
    eq(niveis[0].level_paint, "both", "cor no card e no seletor");
    eq(niveis[1].entity, `select.${P}_modo`, "seletor de modo");
    eq(niveis[1].level_colors, { Fresco: "#8fbf8f", Noturno: "#5b6b9e", Ausente: "#9a9a9a" }, "cores do modo");
    ok(!niveis[1].level_scheme, "modo não usa esquema de escala");

    // ---- esterilizar
    const st = cfg.tabs[1].cards[0];
    eq(st.type, "tile", "card da esterilização");
    eq(st.entity, "scene.esterilizar_escritorio_em_um_minuto", "cena da esterilização");
    eq(st.visibility[0].conditions.length, 2, "duas condições de visibilidade");
    eq(st.visibility[0].conditions[0].state, "on", "condição pede ligado");
    ok(st.card_mod && /backdrop-filter/.test(st.card_mod.style), "vidro na esterilização");

    // ---- energia
    const pw = cfg.tabs[2].cards[1].cards[0];
    eq(pw.type, "custom:power-button-card", "card da tomada");
    eq(pw.entity, "switch.tomada_do_purificador_de_ar_do_escritorio_local_tomada", "interruptor da tomada");
    eq(pw.sensor_potencia, "sensor.tomada_do_purificador_de_ar_do_escritorio_local_potencia", "potência achada");
    ok(!/energia/.test(String(pw.sensor_potencia)), "energia acumulada entrou como potência");

    // ---- log
    const lg = cfg.tabs[3].cards[0];
    eq(lg.type, "logbook", "card do log");
    eq(lg.hours_to_show, 3, "três horas de log");
    eq(lg.target.entity_id.length, 2, "duas entidades no log");
    ok(lg.card_mod && /rgba\(0, 0, 0, 0\.50\)/.test(lg.card_mod.style), "vidro escuro no log");
  }

  // abas desligadas somem
  const c2 = mk({ device: DEV, air_device: AR, gauges: false, sterilize_tab: false, log_tab: false, energy_tab: false });
  await tick(); await tick(); await tick();
  const cfg2 = c2._child && c2._child._cfg;
  if (cfg2) {
    eq(cfg2.tabs.length, 1, "só a aba do purificador");
    eq(cfg2.tabs[0].cards[0].type, "grid", "sem mostradores, a coluna dos botões vem primeiro");
  }

  // esconder e reordenar mostradores e botões
  const c3 = mk({ device: DEV, air_device: AR, gauge_hidden: ["tvoc"], gauge_order: ["hcho", "co2", "tvoc"],
    button_hidden: ["filter"], button_order: ["led", "power", "lock", "filter"], energy_tab: false, log_tab: false, sterilize_tab: false });
  await tick(); await tick(); await tick();
  const cfg3 = c3._child && c3._child._cfg;
  if (cfg3) {
    const g = cfg3.tabs[0].cards[0];
    eq(g.cards.map((x) => x.name), ["FORMALDEÍDO", "CO₂"], "ordem e exclusão dos mostradores");
    const hum = cfg3.tabs[0].cards[1].cards[2];
    eq(hum.buttons.map((b) => b.icon), ["mdi:led-on", "mdi:power", "mdi:lock"], "ordem e exclusão dos botões");
  }

  // modo cenas: a fileira vira mw-scene-button-card
  const c4 = mk({ control: "scenes", air_device: AR, energy_tab: false, log_tab: false, sterilize_tab: false,
    scenes: { power: "scene.esterilizar_escritorio_em_um_minuto" } });
  await tick(); await tick(); await tick();
  const cfg4 = c4._child && c4._child._cfg;
  if (cfg4) {
    const f = cfg4.tabs[0].cards[1].cards[2];
    eq(f.type, "custom:mw-scene-button-card", "fileira de cenas");
    eq(f.buttons[0].entity, "scene.esterilizar_escritorio_em_um_minuto", "cena no botão");
  }

  // sem dispositivo: aviso honesto
  const c5 = mk({});
  await tick(); await tick();
  ok(!c5._child, "sem dispositivo não pode montar card");
  ok(/Escolha o/.test(String(c5._host.innerHTML)), "faltou o aviso de dispositivo vazio");

  // editor monta sem hass e sem os elementos internos do HA
  const ed = new (customElements.get("mw-tab-purifier-card-editor"))();
  let erro = null;
  try { ed.setConfig({ device: DEV }); } catch (e) { erro = e; }
  ok(!erro, `editor quebrou sem hass: ${erro && erro.message}`);
  erro = null;
  try { ed.hass = HASS; } catch (e) { erro = e; }
  ok(!erro, `editor quebrou com hass: ${erro && erro.message}`);

  const emitido = [];
  ed.addEventListener("config-changed", (ev) => emitido.push(ev.detail.config));
  ed._patch({ spacers: 2, paper_color: "orange-7" });
  const last = emitido[emitido.length - 1] || {};
  ok(!("spacers" in last), "spacers igual ao default foi escrito no YAML");
  ok(!("paper_color" in last), "paper_color igual ao default foi escrito no YAML");

  ok(infoBanner.some((l) => /MW-TAB-PURIFIER-CARD/.test(l)), "banner de versão ausente");

  if (fails.length) {
    console.error(`\n✗ probe: ${fails.length} falha(s), ${pass} ok\n`);
    for (const f of fails) console.error("  · " + f);
    process.exit(1);
  }
  console.log(`✓ probe mw-tab-purifier-card: ${pass} verificações passaram`);
})();
