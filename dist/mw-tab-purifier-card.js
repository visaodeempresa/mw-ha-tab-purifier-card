/* mw-ha-tab-purifier-card — custom:mw-tab-purifier-card
 * A tela inteira de um purificador de ar em abas, a partir do dispositivo:
 *   aba PURIFICADOR → três mostradores de qualidade do ar (CO₂, TVOC,
 *        formaldeído) na escala canônica da casa + foto + os botões
 *        (mw-humidifier-card) + nível de velocidade e modo
 *   aba ESTERILIZAR → a cena de esterilização, que só aparece com o aparelho
 *        realmente ligado
 *   aba ENERGIA     → a tomada em custom:power-button-card (Tuya, LocalTuya,
 *        Tapo ou escolha manual)
 *   aba LOG         → o logbook das entidades que interessam
 *
 * Dois modos de comando: `control: localtuya` (prioridade — as entidades do
 * aparelho, que é o que dá estado de verdade) e `control: scenes` (cenas do
 * HA, para quem só tem infravermelho).
 *
 * Nada é redesenhado aqui: este card é o COMPOSITOR — irmão do tab-air,
 * tab-fan, tab-lights e tab-humidifier.
 *
 * Sem build, sem dependências de bundler: JS puro + <ha-form> do HA.
 * Repo: https://github.com/visaodeempresa/mw-ha-tab-purifier-card
 */
(() => {
  "use strict";

  const VERSION = "0.1.0";
  /* ------------------------------------------------------------ utilidades */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  /** merge profundo; array substitui (lista é decisão, não acúmulo). */
  const deepMerge = (base, over) => {
    if (!isObj(over)) return over === undefined ? base : over;
    const out = { ...(isObj(base) ? base : {}) };
    for (const [k, v] of Object.entries(over)) {
      if (v === null) { delete out[k]; continue; }
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out;
  };

  /** tira vazio: default intacto não polui o YAML (regra da família). */
  const clean = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (v === undefined || v === null || v === "") continue;
      out[k] = v;
    }
    return out;
  };

  /** o que MUDOU de `base` para `next` — é isso que vira override no YAML. */
  const diffObj = (base, next) => {
    const out = {};
    for (const [k, v] of Object.entries(next || {})) {
      if (JSON.stringify(base ? base[k] : undefined) !== JSON.stringify(v)) out[k] = v;
    }
    return out;
  };

  const sig = (v) => { try { return JSON.stringify(v); } catch (_) { return String(v); } };

  // >>> paper-palette v1 — fonte canônica: /Volumes/SSD-T1-01/CLAUDE-SSD/IA/lib/paper-palette/paper-palette.js
  // 49 papéis encardidos: 7 matizes do arco-íris × 7 tons (1 = quase branco,
  // 7 = mais encardido). Saturação baixa de propósito — papel descansa a vista.
  const PAPER_HUES = [
    ["red", "Vermelho", 6], ["orange", "Laranja", 27], ["yellow", "Amarelo", 47],
    ["green", "Verde", 96], ["blue", "Azul", 203], ["indigo", "Anil", 236],
    ["violet", "Violeta", 283],
  ];
  const PAPER_TONES = [[97, 6], [96, 9], [94, 12], [92, 15], [90, 18], [88, 21], [85, 24]];
  const paperOptions = () => [{ value: "paper", label: "Papel original (creme)" }].concat(
    ...PAPER_HUES.map((h) => PAPER_TONES.map((t, i) => ({
      value: `${h[0]}-${i + 1}`,
      label: `${h[1]} · tom ${i + 1}${i === 0 ? " (mais claro)" : i === 6 ? " (mais encardido)" : ""}`,
    }))));
  // <<< paper-palette v1

  // >>> paper-dark-palette v1 — fonte canônica: IA/lib/paper-palette/paper-dark-palette.js
  const PAPER_DARK_TONES = [[26, 10], [24, 13], [21, 16], [19, 19], [16, 22], [14, 25], [11, 28]];
  const paperDarkOptions = () => [{ value: "paper", label: "Papel de noite (grafite)" }].concat(
    ...PAPER_HUES.map((h) => PAPER_DARK_TONES.map((t, i) => ({
      value: `${h[0]}-${i + 1}`,
      label: `${h[1]} · tom ${i + 1}${i === 0 ? " (mais claro)" : i === 6 ? " (mais escuro)" : ""}`,
    }))));
  // <<< paper-dark-palette v1

  // ---- cor: parse / compose (mantém alfa, que o desenho usa muito) ----
  const parseColor = (str) => {
    const s = String(str || "").trim();
    let m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) { const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16)); return { r, g, b, a: 1 }; }
    return { r: 128, g: 128, b: 128, a: 1 };
  };
  const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const toRgba = ({ r, g, b, a }) => `rgba(${r}, ${g}, ${b}, ${a})`;

  // >>> mw-air-quality-scale v1 — fonte canônica: /Volumes/SSD-T1-01/CLAUDE-SSD/IA/lib/mw-air-quality-scale/mw-air-quality-scale.js
  // Escala canônica de cor para qualidade do ar (CO₂, TVOC, HCHO, PM).
  // Regra: IA/rules/global/90-cores-de-qualidade-do-ar.md.
  // As três cores são as do próprio HA, para que um gauge nativo e um
  // componente nosso na mesma tela não discordem.
  const MW_AQ_GREEN = "#43a047";   // --success-color  · bom
  const MW_AQ_AMBER = "#ffa600";   // --warning-color  · atenção
  const MW_AQ_RED = "#db4437";     // --error-color    · ruim

  // grandeza → { nome, unidade, min, max, degraus [valor de início, cor] }.
  // `min`/`max` existem para quem desenha mostrador (gauge, régua, barra);
  // quem só quer a cor usa os degraus.
  const MW_AQ_SCALE = {
    co2:  { name: "CO₂", unit: "ppm", min: 350, max: 2000,
            steps: [[350, MW_AQ_GREEN], [800, MW_AQ_AMBER], [1200, MW_AQ_RED]] },
    tvoc: { name: "TVOC", unit: "ppm", min: 0, max: 2,
            steps: [[0, MW_AQ_GREEN], [0.3, MW_AQ_AMBER], [0.6, MW_AQ_RED]] },
    hcho: { name: "Formaldeído", unit: "mg/m³", min: 0, max: 0.3,
            steps: [[0, MW_AQ_GREEN], [0.08, MW_AQ_AMBER], [0.1, MW_AQ_RED]] },
    pm25: { name: "PM2.5", unit: "µg/m³", min: 0, max: 150,
            steps: [[0, MW_AQ_GREEN], [12, MW_AQ_AMBER], [35, MW_AQ_RED]] },
  };
  // apelidos: o que o dono e as integrações chamam a mesma grandeza
  const MW_AQ_ALIAS = {
    carbon_dioxide: "co2", dioxido_de_carbono: "co2", co2: "co2",
    voc: "tvoc", vocs: "tvoc", tvoc: "tvoc", volatile_organic_compounds: "tvoc",
    formaldeido: "hcho", formaldehyde: "hcho", hcho: "hcho", ch2o: "hcho",
    pm25: "pm25", "pm2_5": "pm25", "pm2.5": "pm25", particulate_matter: "pm25",
  };

  const mwAirKind = (kind) => {
    const k = String(kind || "").toLowerCase().trim();
    return MW_AQ_ALIAS[k] || (MW_AQ_SCALE[k] ? k : null);
  };

  // Cor do degrau: o último degrau cujo valor de início já foi alcançado.
  // Abaixo do primeiro degrau ainda é "bom" (0 ppm de CO₂ não existe na
  // prática, mas sensor mudo reportando 0 não deve pintar de vermelho).
  const mwAirColor = (kind, value, alpha) => {
    const k = mwAirKind(kind);
    if (!k) return null;
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    const steps = MW_AQ_SCALE[k].steps;
    let hex = steps[0][1];
    for (const [from, color] of steps) { if (v >= from) hex = color; }
    return mwAirRgba(hex, alpha);
  };

  // "bom" | "atencao" | "ruim" — para quem precisa do nível, não da cor
  // (ícone, texto, ordenação, automação).
  const MW_AQ_LEVELS = ["bom", "atencao", "ruim"];
  const mwAirLevel = (kind, value) => {
    const k = mwAirKind(kind);
    if (!k) return null;
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    const steps = MW_AQ_SCALE[k].steps;
    let i = 0;
    steps.forEach(([from], idx) => { if (v >= from) i = idx; });
    return MW_AQ_LEVELS[i];
  };

  // #rrggbb → rgba(...) quando pedem alfa; sem alfa devolve o hex intacto,
  // que é o que os gauges nativos já usam.
  const mwAirRgba = (hex, alpha) => {
    const a = Number(alpha);
    if (!Number.isFinite(a)) return hex;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  // Degraus no formato do custom:modern-circular-gauge (e do type: gauge
  // nativo, que lê `severity`). Mesma saída do `segmentos()` do Python.
  const mwAirSegments = (kind) => {
    const k = mwAirKind(kind);
    if (!k) return null;
    return MW_AQ_SCALE[k].steps.map(([from, color]) => ({ from, color }));
  };
  // <<< mw-air-quality-scale v1

  /* ------------------------------------------------------------- defaults */

  const DEFAULTS = {
    control: "localtuya",       // localtuya | scenes
    device: "",                 // o purificador (LocalTuya é a prioridade)
    air_device: "",             // sensor de qualidade do ar (vazio = o próprio)
    power_entity: "",
    socket_device: "",
    image: "",
    gauges: true,
    sterilize_tab: true,
    energy_tab: true,
    log_tab: true,
    levels: true,
    spacers: 2,
    gauge_columns: 3,
    button_icon_size: 65,
    log_hours: 3,
    paper_color: "orange-7",
    shell_color: "rgba(68, 68, 68, 0.5)",
    heading: "🫁 PURIFICADOR DE AR",
    energy_heading: "🔌 TOMADAS ELÉTRICAS",
  };

  const TABS_DEFAULTS = {
    tab_display: "icon",
    tab_icon_size: 34,
    tab_align: "start",
    keep_alive: false,
  };

  const PUR_TAB = { label: "PURIFICADOR", icon: "mdi:air-purifier" };
  const STER_TAB = { label: "ESTERILIZAR", icon: "mdi:target" };
  const ENERGY_TAB = { label: "ENERGIA", icon: "mdi:flash" };
  const LOG_TAB = { label: "LOG", icon: "mdi:history" };

  const POWER_DEFAULTS = {
    name: "TOMADA",
    device_icon: "mdi:flash",
    protocol_icon: "mdi:wifi",
    background_image_url: "/local/devices/ha-integration-tuya.png",
    confirm: true,
    only_power: true,
    power_font_size: 20,
    only_power_lift: 3,
  };

  // O mostrador redondo é de outra família (modern-circular-gauge): ele não
  // sabe desenhar papel. O card_mod abaixo é o MESMO relevo dos botões MW —
  // sem ele, três discos de tema escuro no meio de um painel de papel.
  const GAUGE_PAPER = `ha-card {
  background: linear-gradient(145deg, #fdfaf3, #e8e3d8) !important;
  border: 1px solid rgba(180, 180, 180, 0.55) !important;
  border-radius: 14px !important;
  box-shadow:
    0 0 8px 2px rgba(0, 0, 0, 0.28),
    0 4px 10px rgba(0, 0, 0, 0.14),
    inset 2px 2px 4px rgba(255, 250, 235, 0.80),
    inset -2px -2px 4px rgba(0, 0, 0, 0.08) !important;
  --primary-text-color: #1a1a1a;
  --secondary-text-color: #4a4a4a;
  --gauge-segments-opacity: 1;
}
`;

  const GLASS = `ha-card {
  background: rgba(0, 0, 0, 0.25) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
`;

  const LOG_GLASS = `ha-card {
  background: rgba(0, 0, 0, 0.50) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px !important;
  --primary-text-color: #f5f5f5;
  --secondary-text-color: #d6d6d6;
}
`;

  // O rótulo curto de cada mostrador: o disco tem 100 px, «Dióxido de carbono»
  // não cabe e vira «Dióxido de…».
  const GAUGE_NAME = { co2: "CO₂", tvoc: "VOC", hcho: "FORMALDEÍDO", pm25: "PM2.5" };
  const GAUGE_ORDER = ["co2", "tvoc", "hcho", "pm25"];

  // Os quatro papéis do purificador LocalTuya, na ordem do desenho.
  const BUTTON_SLOTS = [
    { key: "power", icon: "mdi:power", name: "Ligar", domain: "fan", re: /fan|power|ligar/ },
    { key: "led", icon: "mdi:led-on", name: "LED", domain: "light", re: /state_light|led|luz/ },
    { key: "lock", icon: "mdi:lock", name: "Trava", domain: "switch", re: /child_lock|trava|lock/ },
    { key: "filter", icon: "mdi:air-filter", name: "Filtro", domain: "switch", re: /filter|filtro|cartridge/ },
  ];
  const BUTTON_LABEL = { power: "Ligar/desligar", led: "LED do painel", lock: "Trava de criança", filter: "Reset do filtro" };

  // As duas fileiras de baixo: nível de velocidade (semáforo) e modo. As cores
  // do modo não são escala — são três estados nomeados pelo fabricante.
  const MODE_COLORS = { "Fresco": "#8fbf8f", "Noturno": "#5b6b9e", "Ausente": "#9a9a9a" };
  const LEVEL_SLOTS = [
    { key: "speed", name: "NÍVEL", re: /nivel|n[ií]vel|velocidade|speed|level|fan_speed/, scheme: "semaforo" },
    { key: "mode", name: "MODO", re: /modo|mode/, colors: MODE_COLORS },
  ];

  /* -------------------------------- descoberta ------------------------------ */

  const entitiesOfDevice = (hass, dev) => {
    if (!hass || !hass.entities || !dev) return [];
    return Object.keys(hass.entities).filter((id) => {
      const e = hass.entities[id];
      return e && e.device_id === dev && !e.hidden_by && !e.disabled_by;
    });
  };

  const friendly = (hass, id) => {
    const st = hass && hass.states && hass.states[id];
    return (st && st.attributes && st.attributes.friendly_name) || id;
  };

  const deviceName = (hass, dev) => {
    const d = hass && hass.devices && hass.devices[dev];
    return (d && (d.name_by_user || d.name)) || dev || "—";
  };

  const rotulo = (hass, id) => `${friendly(hass, id)} ${id}`.toLowerCase();

  const classOf = (hass, id) => {
    const st = hass && hass.states && hass.states[id];
    return (st && st.attributes && st.attributes.device_class) || "";
  };

  /** os quatro botões do aparelho, cada um pelo domínio + nome da entidade. */
  const guessButtons = (hass, dev) => {
    const ids = entitiesOfDevice(hass, dev);
    const out = {};
    const usados = new Set();
    for (const s of BUTTON_SLOTS) {
      const achou = ids.find((id) => !usados.has(id)
        && (id.indexOf(s.domain + ".") === 0 || (s.key === "filter" && id.indexOf("button.") === 0))
        && s.re.test(rotulo(hass, id)))
        || ids.find((id) => !usados.has(id) && id.indexOf(s.domain + ".") === 0 && s.key === "power");
      if (achou) { out[s.key] = achou; usados.add(achou); }
    }
    return out;
  };

  /** os dois seletores: nível de velocidade e modo. */
  const guessLevels = (hass, dev) => {
    const sels = entitiesOfDevice(hass, dev).filter((id) => id.indexOf("select.") === 0 || id.indexOf("number.") === 0);
    const out = {};
    const usados = new Set();
    for (const s of LEVEL_SLOTS) {
      const achou = sels.find((id) => !usados.has(id) && s.re.test(rotulo(hass, id)));
      if (achou) { out[s.key] = achou; usados.add(achou); }
    }
    return out;
  };

  // Sensor de cada grandeza: o `device_class` manda (é o que a integração
  // promete); o nome entra como plano B, porque LocalTuya não preenche classe.
  const AQ_CLASS = { co2: "carbon_dioxide", tvoc: "volatile_organic_compounds", hcho: "formaldehyde", pm25: "pm25" };
  const guessAir = (hass, cfg) => {
    const dev = cfg.air_device || cfg.device;
    const ids = entitiesOfDevice(hass, dev).filter((id) => id.indexOf("sensor.") === 0);
    const out = {};
    for (const kind of GAUGE_ORDER) {
      const porClasse = ids.find((id) => classOf(hass, id) === AQ_CLASS[kind]);
      const porNome = ids.find((id) => {
        const r = rotulo(hass, id);
        return Object.keys(MW_AQ_ALIAS).some((a) => MW_AQ_ALIAS[a] === kind && r.indexOf(a) >= 0);
      });
      const achou = porClasse || porNome;
      if (achou) out[kind] = achou;
    }
    return out;
  };

  const socketEntity = (hass, cfg) => {
    if (cfg.power_entity) return cfg.power_entity;
    const sws = entitiesOfDevice(hass, cfg.socket_device).filter((id) => id.indexOf("switch.") === 0);
    return sws.find((id) => /socket|tomada|plug/.test(id)) || sws[0] || "";
  };

  // Tuya fala português; Tapo e o resto do mundo, inglês. Energia acumulada
  // (kWh) NÃO é potência: escreveria 12,4 kWh onde o desenho promete watts.
  const NAO_POTENCIA = /energy|energia|consumo|kwh|factor|fator|total/;
  const SENSOR_MATCH = {
    sensor_voltagem: [/voltagem|voltage|tens[aã]o/],
    sensor_corrente: [/corrente|current(?!_power)/],
    sensor_potencia: [/pot[eê]ncia|potencia|current_power|power/],
  };
  const powerSensors = (hass, cfg) => {
    const dev = cfg.socket_device
      || (cfg.power_entity && hass && hass.entities && hass.entities[cfg.power_entity]
        ? hass.entities[cfg.power_entity].device_id : "");
    const ids = entitiesOfDevice(hass, dev).filter((id) => id.indexOf("sensor.") === 0);
    const out = {};
    for (const [chave, regras] of Object.entries(SENSOR_MATCH)) {
      for (const re of regras) {
        const achou = ids.find((id) => {
          const r = rotulo(hass, id);
          return re.test(r) && !(chave === "sensor_potencia" && NAO_POTENCIA.test(r));
        });
        if (achou) { out[chave] = achou; break; }
      }
    }
    return out;
  };

  /* ------------------------------------------------ composição da config */

  const gaugeCard = (hass, cfg, kind, entity) => {
    const esc_ = MW_AQ_SCALE[kind];
    const o = (cfg.gauge_options || {})[kind] || {};
    return deepMerge({
      type: "custom:modern-circular-gauge",
      entity,
      name: GAUGE_NAME[kind] || esc_.name,
      min: esc_.min,
      max: esc_.max,
      needle: true,
      smooth_segments: false,
      show_state: true,
      show_unit: true,
      header_position: "bottom",
      show_icon: false,
      header_offset: 8,
      gauge_width: 9,
      segments: mwAirSegments(kind),
      card_mod: { style: cfg.gauge_style || GAUGE_PAPER },
    }, o);
  };

  const gaugesGrid = (hass, cfg) => {
    const achados = { ...guessAir(hass, cfg), ...clean(cfg.sensors || {}) };
    const ordem = (Array.isArray(cfg.gauge_order) && cfg.gauge_order.length ? cfg.gauge_order : GAUGE_ORDER)
      .filter((k) => achados[k] && !((cfg.gauge_hidden || []).includes(k)));
    if (!ordem.length) return null;
    return {
      type: "grid",
      columns: Math.max(1, Math.min(6, Number(cfg.gauge_columns) || DEFAULTS.gauge_columns)),
      square: false,
      cards: ordem.map((k) => gaugeCard(hass, cfg, k, achados[k])),
    };
  };

  const controlCard = (hass, cfg) => {
    if (cfg.control === "scenes") {
      const cenas = clean(cfg.scenes || {});
      const botoes = BUTTON_SLOTS.filter((s) => cenas[s.key]).map((s) => ({
        entity: cenas[s.key], icon: s.icon, name: s.name.toUpperCase(),
        color_icon: "rgba(22, 58, 26, 0.92)", paper_color: "green-6",
      }));
      if (!botoes.length) return null;
      return {
        type: "custom:mw-scene-button-card",
        button_columns: 2, gap: 8, hide_label: true, icon_size: "65%",
        buttons: botoes,
        ...clean(cfg.scene_options || {}),
      };
    }
    const achados = { ...guessButtons(hass, cfg.device), ...clean(cfg.buttons_map || {}) };
    const ordem = (Array.isArray(cfg.button_order) && cfg.button_order.length
      ? cfg.button_order : BUTTON_SLOTS.map((s) => s.key))
      .filter((k) => achados[k] && !((cfg.button_hidden || []).includes(k)));
    if (!ordem.length) return null;
    return {
      type: "custom:mw-humidifier-card",
      mode: "only_humidifier",
      device: cfg.device,
      confirm_buttons: true,
      buttons: ordem.map((k) => {
        const s = BUTTON_SLOTS.find((x) => x.key === k);
        return deepMerge({ entity: achados[k], icon: s.icon, name: s.name },
          (cfg.button_overrides || {})[k] || {});
      }),
      button_icon_size: Number(cfg.button_icon_size) || DEFAULTS.button_icon_size,
      ...clean(cfg.humidifier_options || {}),
    };
  };

  const levelCards = (hass, cfg) => {
    if (cfg.levels === false) return [];
    const achados = { ...guessLevels(hass, cfg.device), ...clean(cfg.levels_map || {}) };
    return LEVEL_SLOTS.filter((s) => achados[s.key]).map((s) => {
      const base = {
        type: "custom:mw-humidifier-level-card",
        entity: achados[s.key],
        device: cfg.device,
        name: s.name,
        height: 50,
        level_paint: "both",
        grid_options: { rows: "auto" },
      };
      if (s.scheme) base.level_scheme = s.scheme;
      if (s.colors) base.level_colors = { ...s.colors };
      const domain = String(achados[s.key]).split(".")[0];
      if (domain === "number" || domain === "input_number") {
        if (s.key === "speed") {
          base.option_labels = { "0": "0 · Desligado", "1": "1 · Baixo", "2": "2 · Suave", "3": "3 · Médio", "4": "4 · Alto", "5": "5 · Turbo" };
        } else if (s.key === "mode") {
          base.option_labels = { "0": "Fresco", "1": "Noturno", "2": "Ausente" };
          base.level_colors = { "0": "#8fbf8f", "1": "#5b6b9e", "2": "#9a9a9a", ...s.colors };
        }
      }
      return deepMerge(deepMerge(base, clean(cfg.level_options || {})),
        (cfg.level_overrides || {})[s.key] || {});
    });
  };

  const sterilizeCard = (hass, cfg) => {
    if (!cfg.sterilize_scene) return null;
    const alvos = (cfg.sterilize_when || []).filter(Boolean);
    const card = {
      type: "tile",
      entity: cfg.sterilize_scene,
      icon: cfg.sterilize_icon || "mdi:target",
      hide_state: false,
      vertical: false,
      features_position: "bottom",
      grid_options: { columns: "full" },
      card_mod: { style: GLASS },
    };
    if (alvos.length) {
      card.visibility = [{
        condition: "and",
        conditions: alvos.map((e) => ({ condition: "state", entity: e, state: "on" })),
      }];
    }
    return deepMerge(card, clean(cfg.sterilize_options || {}));
  };

  const logCard = (hass, cfg) => {
    const alvos = (cfg.log_entities || []).filter(Boolean);
    if (!alvos.length) return null;
    return deepMerge({
      type: "logbook",
      target: { entity_id: alvos },
      hours_to_show: Number(cfg.log_hours) || DEFAULTS.log_hours,
      card_mod: { style: LOG_GLASS },
    }, clean(cfg.log_options || {}));
  };

  const powerCard = (hass, cfg) => {
    const ent = socketEntity(hass, cfg);
    if (!ent) return null;
    return {
      type: "custom:power-button-card",
      entity: ent,
      ...POWER_DEFAULTS,
      ...clean(powerSensors(hass, cfg)),
      ...clean(cfg.power_options || {}),
    };
  };

  /** a config do custom:mw-tab-card que este card vai montar. */
  const buildConfig = (hass, cfg) => {
    const cards = [];

    if (cfg.gauges !== false) { const g = gaugesGrid(hass, cfg); if (g) cards.push(g); }

    const n = Math.max(0, Math.min(6, Number(cfg.spacers) === 0 ? 0 : (Number(cfg.spacers) || DEFAULTS.spacers)));
    const ctrl = controlCard(hass, cfg);
    const coluna = {
      type: "grid",
      square: false,
      columns: 1,
      cards: [
        ...Array.from({ length: n }, () => ({ type: "custom:mushroom-empty-card" })),
        ...(ctrl ? [ctrl] : [{
          type: "markdown",
          content: cfg.control === "scenes"
            ? "Escolha as **cenas** do purificador no editor."
            : "Escolha o **dispositivo** do purificador no editor.",
        }]),
      ],
    };
    cards.push(cfg.image
      ? { type: "grid", columns: 2, square: false, cards: [{ type: "picture", image: cfg.image }, coluna] }
      : coluna);

    const h = cfg.heading === undefined ? DEFAULTS.heading : cfg.heading;
    if (h) cards.push({ type: "heading", heading: h, heading_style: "title" });

    const niveis = levelCards(hass, cfg);
    if (niveis.length) cards.push({ type: "grid", square: false, columns: 1, cards: niveis });

    for (const extra of (Array.isArray((cfg.extra_cards || {}).purifier) ? cfg.extra_cards.purifier : [])) cards.push(extra);

    const tabs = [];
    const t1 = { ...PUR_TAB, ...clean(cfg.purifier_tab || {}) };
    tabs.push(deepMerge({ label: t1.label, icon: t1.icon, cards }, (cfg.tabs_yaml || {}).purifier || {}));

    const ster = cfg.sterilize_tab === false ? null : sterilizeCard(hass, cfg);
    if (ster) {
      const t = { ...STER_TAB, ...clean(cfg.sterilize_tab_options || {}) };
      tabs.push(deepMerge({ label: t.label, icon: t.icon, cards: [ster] }, (cfg.tabs_yaml || {}).sterilize || {}));
    }

    const pc = cfg.energy_tab === false ? null : powerCard(hass, cfg);
    if (pc) {
      const t = { ...ENERGY_TAB, ...clean(cfg.energy_tab_options || {}) };
      const eh = cfg.energy_heading === undefined ? DEFAULTS.energy_heading : cfg.energy_heading;
      const ecards = [];
      if (eh) ecards.push({ type: "heading", heading: eh, heading_style: "title" });
      ecards.push({
        type: "grid",
        square: true,
        columns: Math.max(1, Math.min(6, Number(cfg.energy_columns) || 2)),
        cards: [pc].concat(Array.isArray((cfg.extra_cards || {}).energy) ? cfg.extra_cards.energy : []),
      });
      tabs.push(deepMerge({ label: t.label, icon: t.icon, cards: ecards }, (cfg.tabs_yaml || {}).energy || {}));
    }

    const lg = cfg.log_tab === false ? null : logCard(hass, cfg);
    if (lg) {
      const t = { ...LOG_TAB, ...clean(cfg.log_tab_options || {}) };
      tabs.push(deepMerge({ label: t.label, icon: t.icon, cards: [lg] }, (cfg.tabs_yaml || {}).log || {}));
    }

    for (const t of (Array.isArray(cfg.extra_tabs) ? cfg.extra_tabs : [])) tabs.push(t);

    const root = {
      type: "custom:mw-tab-card",
      tabs,
      paper_color: cfg.paper_color || DEFAULTS.paper_color,
      shell_color: cfg.shell_color || DEFAULTS.shell_color,
      ...TABS_DEFAULTS,
      ...clean(cfg.tabs_options || {}),
    };
    return deepMerge(root, cfg.yaml_override || {});
  };

  /* ------------------------------------------------------------------ CARD */

  class MwTabPurifierCard extends HTMLElement {
    static getConfigElement() { return document.createElement("mw-tab-purifier-card-editor"); }
    static getStubConfig() { return { control: "localtuya", gauges: true, energy_tab: true }; }

    setConfig(config) {
      this._config = { ...DEFAULTS, ...(config || {}) };
      this._built = null;
      this._update();
    }

    set hass(hass) {
      const antes = this._hass;
      this._hass = hass;
      const mexeu = !antes
        || antes.entities !== hass.entities
        || antes.devices !== hass.devices
        || antes.areas !== hass.areas
        || Object.keys(antes.states || {}).length !== Object.keys(hass.states || {}).length;
      if (mexeu) this._update(); else if (this._child) this._child.hass = hass;
    }
    get hass() { return this._hass; }

    set editMode(v) { this._editMode = v; if (this._child) this._child.editMode = v; }
    get editMode() { return this._editMode; }

    connectedCallback() { this._update(); }

    async getCardSize() {
      try { return this._child && this._child.getCardSize ? await this._child.getCardSize() : 10; }
      catch (_) { return 10; }
    }
    getLayoutOptions() { return { grid_min_rows: 4, grid_columns: "full" }; }
    getGridOptions() { return { columns: "full", min_rows: 4 }; }

    _shell() {
      if (!this._root) {
        this._root = this.attachShadow({ mode: "open" });
        this._root.innerHTML = `<style>
          :host{display:block;}
          .aviso{padding:14px 16px;border-radius:14px;font-size:13px;line-height:1.45;
            background:rgba(0,0,0,.25);color:var(--primary-text-color);
            border:1px solid var(--divider-color);}
          .aviso b{font-weight:700;}
          .aviso code{font-family:monospace;font-size:12px;opacity:.85;}
        </style><div id="host"></div>`;
        this._host = this._root.querySelector("#host");
      }
      return this._host;
    }

    _aviso(html) {
      const host = this._shell();
      this._child = null;
      host.innerHTML = `<div class="aviso">${html}</div>`;
    }

    async _update() {
      if (!this._config || !this.isConnected) return;
      const host = this._shell();
      if (!this._hass) return;

      if (this._config.control !== "scenes" && !this._config.device) {
        this._aviso("<b>MW Tab Purifier</b><br>Escolha o <b>dispositivo do purificador</b> no editor — é dele que saem os botões, o nível, o modo e a qualidade do ar.");
        return;
      }

      const cfg = buildConfig(this._hass, this._config);
      const s = sig(cfg);
      if (this._child && s === this._built) { this._child.hass = this._hass; return; }
      this._built = s;

      if (this._child) {
        try {
          this._child.setConfig(cfg);
          this._child.hass = this._hass;
          if (this._editMode !== undefined) this._child.editMode = this._editMode;
          return;
        } catch (_) { this._child = null; }
      }

      let helpers = null;
      try { helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null; } catch (_) { /* segue */ }
      let el;
      try {
        el = helpers ? helpers.createCardElement(cfg) : null;
        if (!el) throw new Error("loadCardHelpers indisponível");
      } catch (e) {
        this._aviso(`<b>MW Tab Purifier</b> não conseguiu montar o <code>custom:mw-tab-card</code>.<br>
          ${esc(e && e.message ? e.message : e)}<br>
          Instale <b>MW Tab Card</b>, <b>MW Humidifier Card</b>, <b>MW Humidifier Level Card</b>,
          <b>MW Power Button Card</b>, <b>Modern Circular Gauge</b> e <b>Mushroom</b> pelo HACS.`);
        return;
      }
      el.hass = this._hass;
      if (this._editMode !== undefined) el.editMode = this._editMode;
      el.addEventListener("ll-rebuild", (ev) => { ev.stopPropagation(); this._built = null; this._child = null; this._update(); });
      host.innerHTML = "";
      host.appendChild(el);
      this._child = el;
    }
  }
  // Os editores internos do HA não vêm carregados: só entram quando alguma
  // tela de edição os pede. Instanciar o editor da pilha vertical puxa o
  // conjunto. Se não vier, o editor cai em JSON — feio, mas nunca sem saída.
  const loadHuiEditors = async () => {
    if (customElements.get("hui-card-element-editor")) return true;
    try {
      const helpers = await window.loadCardHelpers();
      const stack = helpers.createCardElement({ type: "vertical-stack", cards: [] });
      await stack.constructor.getConfigElement();
      await Promise.race([
        customElements.whenDefined("hui-card-element-editor"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (_) { /* segue no plano B */ }
    return !!customElements.get("hui-card-element-editor");
  };

  const loadYamlEditor = async () => {
    if (customElements.get("ha-yaml-editor")) return true;
    await loadHuiEditors();
    await Promise.race([
      customElements.whenDefined("ha-yaml-editor"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    return !!customElements.get("ha-yaml-editor");
  };

  /**
   * Caixa de código de um pedaço da config. YAML quando o HA entrega o
   * ha-yaml-editor; JSON num textarea quando não entrega. Nos dois casos o
   * valor só é gravado no botão «Aplicar» — escrever a cada tecla tiraria o
   * foco de quem está digitando.
   */
  const yamlBox = async (host, hass, value, onApply, dica) => {
    host.innerHTML = `<div class="mtl-warn"></div><div class="yhost"></div>
      <div class="mtl-row"><span class="nm">${esc(dica || "")}</span>
      <button class="mtl-chip" data-apply="1">Aplicar</button></div>`;
    const warn = host.querySelector(".mtl-warn");
    const yhost = host.querySelector(".yhost");
    const ok = await loadYamlEditor();
    let ler = () => value;
    if (ok) {
      const ed = document.createElement("ha-yaml-editor");
      ed.hass = hass;
      ed.defaultValue = value;
      try { if (ed.setValue) ed.setValue(value); } catch (_) { /* versão antiga */ }
      let atual = value, valido = true;
      ed.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        valido = ev.detail.isValid !== false;
        if (valido) { atual = ev.detail.value; warn.textContent = ""; }
        else warn.textContent = "YAML inválido — corrija antes de aplicar.";
      });
      yhost.appendChild(ed);
      ler = () => { if (!valido) throw new Error("YAML inválido"); return atual; };
    } else {
      warn.textContent = "Editor YAML do HA indisponível — mostrando JSON.";
      yhost.innerHTML = `<textarea class="mtl-ta" spellcheck="false"></textarea>`;
      const ta = yhost.querySelector("textarea");
      ta.value = JSON.stringify(value, null, 2);
      ler = () => JSON.parse(ta.value);
    }
    host.querySelector("[data-apply]").addEventListener("click", () => {
      try { onApply(ler()); warn.textContent = "Aplicado."; }
      catch (e) { warn.textContent = `Não aplicado: ${e && e.message ? e.message : e}`; }
    });
  };

  const CSS = `
    .mtl-h{font-size:13px;font-weight:600;margin:14px 0 6px;opacity:.85;}
    .mtl-sec{margin-top:12px;border:1px solid var(--divider-color);border-radius:10px;padding:10px 12px;}
    .mtl-sec>summary{cursor:pointer;font-weight:600;font-size:13px;}
    .mtl-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--divider-color);}
    .mtl-row:first-of-type{border-top:0;}
    .mtl-row .nm{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .mtl-row .nm small{opacity:.6;font-size:11px;}
    .mtl-row.off .nm{opacity:.45;text-decoration:line-through;}
    .mtl-ib{border:0;background:transparent;cursor:pointer;color:var(--secondary-text-color);
      font:inherit;font-size:15px;line-height:1;padding:4px 6px;border-radius:6px;}
    .mtl-ib:hover{background:var(--divider-color);color:var(--primary-text-color);}
    .mtl-ib[disabled]{opacity:.3;cursor:default;}
    .mtl-ib.on{color:var(--primary-color);}
    .mtl-ib.del:hover{color:var(--error-color, #db4437);}
    .mtl-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;
      border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);
      font:inherit;font-size:12px;cursor:pointer;}
    .mtl-chip.add{border-style:dashed;}
    .mtl-edit{margin-top:10px;border:1px solid var(--divider-color);border-radius:10px;padding:10px;}
    .mtl-edit .top{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;font-weight:600;}
    .mtl-ta{width:100%;box-sizing:border-box;min-height:180px;font-family:monospace;font-size:12px;
      background:var(--code-editor-background-color, rgba(0,0,0,.06));color:var(--primary-text-color);
      border:1px solid var(--divider-color);border-radius:8px;padding:8px;}
    .mtl-warn{font-size:12px;color:var(--error-color, #db4437);min-height:16px;}
    .mtl-info{font-size:12px;opacity:.7;margin:4px 0 8px;}
    .mtl-crow{display:grid;grid-template-columns:1fr 44px 110px minmax(110px,1fr);gap:10px;align-items:center;padding:6px 0;}
    .mtl-crow .lbl{font-size:13px;}
    .mtl-crow input[type=color]{width:40px;height:28px;border:none;background:none;cursor:pointer;padding:0;}
    .mtl-crow code{font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  `;


  /* ---------------------------- EDITOR VISUAL ---------------------------- */

  const LABELS = {
    control: "Como o purificador é comandado",
    device: "Dispositivo do purificador (LocalTuya)",
    air_device: "Dispositivo do sensor de ar (vazio = o próprio purificador)",
    power_entity: "Tomada (interruptor)",
    socket_device: "Dispositivo da tomada (Tuya, LocalTuya, Tapo…)",
    image: "Foto do aparelho (/local/devices/…webp)",
    gauges: "Mostradores de qualidade do ar",
    sterilize_tab: "Criar a aba ESTERILIZAR",
    energy_tab: "Criar a aba ENERGIA",
    log_tab: "Criar a aba LOG",
    levels: "Mostrar nível e modo",
    spacers: "Espaçadores acima dos botões",
    gauge_columns: "Colunas dos mostradores",
    button_icon_size: "Tamanho do ícone dos botões",
    log_hours: "Horas no log",
    heading: "Título da aba do purificador (vazio = sem título)",
    energy_heading: "Título da aba de energia",
    energy_columns: "Colunas da grade de tomadas",
    paper_color: "Cor do papel (painel)",
    shell_color: "Casca (fundo do card)",
    sterilize_scene: "Cena de esterilização",
    sterilize_icon: "Ícone da esterilização",
    entity: "Entidade",
    icon: "Ícone",
    name: "Nome",
    height: "Altura",
    level_scheme: "Esquema de cores por nível",
    level_paint: "Onde a cor do nível pousa",
    // humidifier card
    button_columns: "Colunas dos botões",
    button_radius: "Arredondamento dos botões",
    show_button_names: "Mostrar o nome dos botões",
    show_select_value: "Mostrar o valor do seletor",
    hide_controls_when_off: "Esconder os controles com o aparelho desligado",
    confirm_buttons: "Pedir confirmação nos botões",
    gap: "Espaço interno",
    haptic: "Vibrar ao tocar",
    // power
    device_icon: "Ícone do aparelho",
    background_image_url: "Imagem de fundo (marca/integração)",
    protocol_icon: "Selinho de protocolo (wifi, zigbee…)",
    only_power: "Só a potência (sem tensão e corrente)",
    power_font_size: "Tamanho da potência",
    only_power_lift: "Subida do texto no modo só potência",
    confirm: "Pedir confirmação antes de ligar/desligar",
    sensor_voltagem: "Sensor de tensão",
    sensor_corrente: "Sensor de corrente",
    sensor_potencia: "Sensor de potência",
    // abas
    label: "Texto da aba",
    tab_position: "Posição das abas",
    tab_display: "O que aparece na aba",
    tab_stretch: "Abas dividem a faixa em partes iguais",
    tab_align: "Onde a fila de abas encosta",
    tab_size: "Espessura da faixa de abas (0 = automático)",
    tab_font_size: "Tamanho do texto da aba",
    tab_icon_size: "Tamanho do ícone da aba",
    tab_rotate: "Deitar a aba lateral",
    tab_rotate_angle: "Ângulo da aba deitada",
    tab_rotate_what: "O que gira na aba deitada",
    default_tab: "Aba inicial",
    remember_tab: "Lembrar a última aba aberta (neste navegador)",
    keep_alive: "Manter as abas já abertas montadas",
    preload: "Montar todas as abas de uma vez",
    header: "Faixa de título (opcional)",
    header_icon: "Ícone da faixa de título",
    shell_radius: "Arredondamento da casca",
    panel_radius: "Arredondamento do painel",
    notch_radius: "Recorte côncavo (fusão aba↔painel)",
    padding: "Respiro entre casca e painel",
    content_padding: "Respiro interno do painel",
    card_gap: "Espaço entre os cards de dentro",
    panel_min_height: "Altura mínima do painel",
    elevation: "Relevo 3D no painel",
    flat_children: "Achatar os cards de dentro",
    tab_active_color: "Aba ativa: texto",
    tab_inactive_color: "Aba inativa: texto",
    content_text_color: "Texto dentro do painel",
    header_color: "Faixa de título (vazio = clareia a casca)",
    header_text_color: "Texto da faixa de título",
  };

  const POS_OPTIONS = [
    { value: "bottom", label: "Embaixo" }, { value: "top", label: "Em cima" },
    { value: "left", label: "À esquerda" }, { value: "right", label: "À direita" },
  ];
  const DISP_OPTIONS = [
    { value: "both", label: "Ícone e texto" }, { value: "icon", label: "Só ícone" },
    { value: "text", label: "Só texto" },
  ];
  const CONTROL_OPTIONS = [
    { value: "localtuya", label: "LocalTuya / entidades do aparelho (recomendado)" },
    { value: "scenes", label: "Cenas do Home Assistant" },
  ];
  const SCHEME_OPTIONS = [
    { value: "none", label: "— cor única —" }, { value: "agua", label: "Água" },
    { value: "verde", label: "Verde" }, { value: "mare", label: "Maré" },
    { value: "semaforo", label: "Semáforo" }, { value: "calor", label: "Calor" },
    { value: "arco-iris", label: "Arco-íris" }, { value: "noite", label: "Noite" },
    { value: "nevoa", label: "Névoa" }, { value: "encardido", label: "Encardido" },
  ];
  const PAINT_OPTIONS = [
    { value: "card", label: "O card inteiro" }, { value: "select", label: "Só o seletor" },
    { value: "both", label: "Os dois" },
  ];

  class MwTabPurifierCardEditor extends HTMLElement {
    setConfig(config) { this._config = { ...config }; this._render(); }
    set hass(hass) {
      this._hass = hass;
      for (const f of this._forms || []) f.hass = hass;
      if (this._reg !== (hass && hass.entities)) {
        this._reg = hass && hass.entities;
        this._gsig = null; this._bsig = null;
        this._renderButtons(); this._renderGauges(); this._renderListas();
      }
    }

    _emit(next) {
      this._config = next;
      this.dispatchEvent(new CustomEvent("config-changed", { bubbles: true, composed: true, detail: { config: next } }));
    }
    _patch(patch) {
      const next = { ...this._config, ...patch };
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null) delete next[k];
        else if (k in DEFAULTS && v === DEFAULTS[k] && k !== "control" && k !== "device") delete next[k];
      }
      this._emit(next);
    }
    _cfg() { return { ...DEFAULTS, ...this._config }; }

    _render() {
      if (!this._root) {
        this._forms = [];
        this._root = document.createElement("div");
        this._root.innerHTML = `<style>${CSS}</style>
          <div id="mainform"></div>
          <div class="mtl-h">Botões do aparelho</div>
          <div class="mtl-info" id="binfo"></div>
          <div id="buttons"></div>
          <div id="btnedit"></div>
          <details class="mtl-sec" id="humsec"><summary>Card dos botões (todas as opções)</summary>
            <div id="humform"></div>
            <details class="mtl-sec"><summary>Código YAML deste card</summary><div id="humyaml"></div></details></details>
          <details class="mtl-sec" id="gsec" open><summary>Mostradores de qualidade do ar</summary>
            <div class="mtl-info">Faixas e cores vêm da escala canônica da casa (regra 90) — não se inventa faixa nova aqui.</div>
            <div id="gauges"></div><div id="gform"></div>
            <details class="mtl-sec"><summary>Código YAML da grade de mostradores</summary><div id="gyaml"></div></details></details>
          <details class="mtl-sec" id="lvlsec"><summary>Nível e modo</summary>
            <div id="lvlrows"></div><div id="lvlform"></div></details>
          <details class="mtl-sec" id="stsec"><summary>Aba ESTERILIZAR</summary>
            <div id="stform"></div>
            <div class="mtl-h">Só aparece com estas entidades ligadas</div>
            <div id="stlist"></div><div id="stadd"></div></details>
          <details class="mtl-sec" id="logsec"><summary>Aba LOG</summary>
            <div id="logform"></div>
            <div class="mtl-h">Entidades no log</div>
            <div id="loglist"></div><div id="logadd"></div></details>
          <details class="mtl-sec" id="pwsec"><summary>Tomada (aba ENERGIA)</summary>
            <div class="mtl-info" id="pwinfo"></div><div id="pwform"></div>
            <details class="mtl-sec"><summary>Código YAML deste card</summary><div id="pwyaml"></div></details></details>
          <details class="mtl-sec" id="tabsec"><summary>Abas (rótulo, ícone, posição, tamanho…)</summary>
            <div class="mtl-h">Rótulos e ícones</div><div id="tabsrot"></div>
            <div class="mtl-h">Comportamento e geometria</div><div id="tabsform"></div></details>
          <details class="mtl-sec" id="colorsec"><summary>Cores (papel, casca e textos)</summary>
            <div id="paperform"></div><div id="colorrows"></div></details>
          <details class="mtl-sec" id="yamlsec"><summary>Código YAML do card inteiro (avançado)</summary>
            <div class="mtl-h">Config gerada — é isto que vai para o mw-tab-card</div><div id="yamlgen"></div>
            <div class="mtl-h">Ajustes crus (merge por cima do gerado)</div><div id="yamlover"></div></details>`;
        this.appendChild(this._root);

        const form = (sel, cb) => {
          const f = document.createElement("ha-form");
          f.computeLabel = (x) => LABELS[x.name] || x.name;
          f.addEventListener("value-changed", (ev) => { ev.stopPropagation(); cb(ev.detail.value || {}); });
          this._root.querySelector(sel).appendChild(f);
          this._forms.push(f);
          return f;
        };
        this._mainForm = form("#mainform", (v) => this._onMain(v));
        this._humForm = form("#humform", (v) => this._patch({ humidifier_options: clean(v) }));
        this._gForm = form("#gform", (v) => this._onGauges(v));
        this._lvlForm = form("#lvlform", (v) => this._onLevels(v));
        this._stForm = form("#stform", (v) => this._onSter(v));
        this._stAdd = form("#stadd", (v) => this._onAdd("sterilize_when", v));
        this._logForm = form("#logform", (v) => this._patch({ log_hours: Number(v.log_hours) || DEFAULTS.log_hours }));
        this._logAdd = form("#logadd", (v) => this._onAdd("log_entities", v));
        this._pwForm = form("#pwform", (v) => this._onPower(v));
        this._tabsRot = form("#tabsrot", (v) => this._onTabRot(v));
        this._tabsForm = form("#tabsform", (v) => this._onTabs(v));
        this._paperForm = form("#paperform", (v) => this._patch({ paper_color: v.paper_color }));

        this._buttonsEl = this._root.querySelector("#buttons");
        this._btnEditEl = this._root.querySelector("#btnedit");
        this._gaugesEl = this._root.querySelector("#gauges");
        this._lvlRows = this._root.querySelector("#lvlrows");
        this._stList = this._root.querySelector("#stlist");
        this._logList = this._root.querySelector("#loglist");
        this._colorRows = this._root.querySelector("#colorrows");

        for (const [sel, fn] of [["#yamlsec", "_renderYaml"], ["#humsec", "_renderYamlPieces"],
          ["#gsec", "_renderYamlPieces"], ["#pwsec", "_renderYamlPieces"]]) {
          this._root.querySelector(sel).addEventListener("toggle", () => this[fn]());
        }
      }
      this._renderMain();
      this._renderButtons();
      this._renderGauges();
      this._renderLevels();
      this._renderListas();
      this._renderChildForms();
      this._renderTabForms();
      this._renderColors();
    }

    /* ------------------------------ principal ----------------------------- */

    _renderMain() {
      const c = this._cfg();
      this._mainForm.hass = this._hass;
      this._mainForm.schema = [
        { name: "control", selector: { select: { mode: "dropdown", options: CONTROL_OPTIONS } } },
        ...(c.control === "scenes" ? [] : [{ name: "device", selector: { device: {} } }]),
        { name: "air_device", selector: { device: { entity: { domain: "sensor" } } } },
        { name: "image", selector: { text: {} } },
        { name: "", type: "grid", schema: [
          { name: "gauges", selector: { boolean: {} } },
          { name: "levels", selector: { boolean: {} } },
          { name: "sterilize_tab", selector: { boolean: {} } },
          { name: "energy_tab", selector: { boolean: {} } },
          { name: "log_tab", selector: { boolean: {} } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "spacers", selector: { number: { min: 0, max: 6, step: 1, mode: "box" } } },
          { name: "gauge_columns", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
          { name: "button_icon_size", selector: { number: { min: 20, max: 140, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "heading", selector: { text: {} } },
        ...(c.energy_tab !== false ? [
          { name: "power_entity", selector: { entity: { domain: ["switch", "input_boolean"] } } },
          { name: "socket_device", selector: { device: {} } },
          { name: "energy_heading", selector: { text: {} } },
          { name: "energy_columns", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
        ] : []),
      ];
      const data = {
        control: c.control, device: c.device, air_device: c.air_device, image: c.image,
        gauges: c.gauges !== false, levels: c.levels !== false,
        sterilize_tab: c.sterilize_tab !== false, energy_tab: c.energy_tab !== false,
        log_tab: c.log_tab !== false, spacers: c.spacers, gauge_columns: c.gauge_columns,
        button_icon_size: c.button_icon_size, heading: c.heading,
        power_entity: c.power_entity, socket_device: c.socket_device,
        energy_heading: c.energy_heading, energy_columns: c.energy_columns || 2,
      };
      for (const k of Object.keys(data)) if (data[k] === "" || data[k] === undefined) delete data[k];
      this._mainForm.data = data;
    }

    _onMain(v) {
      const um = (x) => (Array.isArray(x) ? x[0] : x);
      const patch = {
        control: v.control || "localtuya",
        device: um(v.device) || "",
        air_device: um(v.air_device) || "",
        power_entity: um(v.power_entity) || "",
        socket_device: um(v.socket_device) || "",
        image: v.image || "",
        heading: v.heading === undefined ? this._config.heading : v.heading,
        energy_heading: v.energy_heading === undefined ? this._config.energy_heading : v.energy_heading,
        gauges: v.gauges !== false, levels: v.levels !== false,
        sterilize_tab: v.sterilize_tab !== false, energy_tab: v.energy_tab !== false,
        log_tab: v.log_tab !== false,
        spacers: Number(v.spacers ?? DEFAULTS.spacers),
        gauge_columns: Number(v.gauge_columns) || DEFAULTS.gauge_columns,
        button_icon_size: Number(v.button_icon_size) || DEFAULTS.button_icon_size,
        energy_columns: Number(v.energy_columns) || 2,
      };
      if (patch.energy_columns === 2) delete patch.energy_columns;
      if (patch.device !== this._config.device) {
        delete this._config.buttons_map; delete this._config.levels_map; delete this._config.sensors;
        this._bsig = null; this._gsig = null;
      }
      this._patch(patch);
      this._renderMain();
      this._renderButtons();
      this._renderGauges();
      this._renderLevels();
      this._renderChildForms();
    }

    /* -------------------------------- botões ------------------------------ */

    _renderButtons() {
      if (!this._buttonsEl || !this._config) return;
      const c = this._cfg();
      const cenas = c.control === "scenes";
      const achados = cenas
        ? clean(c.scenes || {})
        : { ...(this._hass ? guessButtons(this._hass, c.device) : {}), ...clean(c.buttons_map || {}) };
      const ordem = (Array.isArray(c.button_order) && c.button_order.length
        ? c.button_order : BUTTON_SLOTS.map((s) => s.key));
      const escondidos = c.button_hidden || [];
      this._bmap = achados;
      const s = sig([achados, ordem, escondidos, cenas]);
      if (s === this._bsig && this._buttonsEl.children.length) return;
      this._bsig = s;

      const info = this._root.querySelector("#binfo");
      info.textContent = cenas
        ? "Escolha a cena de cada papel. Papel sem cena não vira botão."
        : (c.device
          ? `Entidades achadas no dispositivo «${deviceName(this._hass, c.device)}». Vazio = não existe no aparelho.`
          : "Escolha o dispositivo para o card achar as entidades.");

      const n = ordem.length;
      this._buttonsEl.innerHTML = ordem.map((k, i) => {
        const slot = BUTTON_SLOTS.find((x) => x.key === k);
        const ent = achados[k];
        const off = escondidos.includes(k) || !ent;
        return `<div class="mtl-row ${off ? "off" : ""}">
          <button class="mtl-ib ${off ? "" : "on"}" data-a="vis" data-i="${i}" ${ent ? "" : "disabled"}>${off ? "☐" : "☑"}</button>
          <span class="nm">${esc(BUTTON_LABEL[k] || k)}
            <small>${esc(ent || "— sem entidade —")}</small></span>
          <button class="mtl-ib" data-a="edit" data-i="${i}">✎</button>
          <button class="mtl-ib" data-a="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="mtl-ib" data-a="down" data-i="${i}" ${i === n - 1 ? "disabled" : ""}>↓</button>
        </div>`;
      }).join("");
      this._buttonsEl.querySelectorAll("[data-a]").forEach((b) =>
        b.addEventListener("click", () => this._btnAction(b.dataset.a, +b.dataset.i)));
      this._renderBtnEditor();
    }

    _btnAction(a, i) {
      const c = this._cfg();
      const ordem = (Array.isArray(c.button_order) && c.button_order.length
        ? [...c.button_order] : BUTTON_SLOTS.map((s) => s.key));
      const k = ordem[i];
      if (a === "edit") { this._bslot = this._bslot === k ? null : k; this._renderBtnEditor(); return; }
      if (a === "vis") {
        const esc2 = new Set(c.button_hidden || []);
        if (esc2.has(k)) esc2.delete(k); else esc2.add(k);
        this._bsig = null;
        this._patch({ button_hidden: esc2.size ? [...esc2] : undefined });
        this._renderButtons(); return;
      }
      if (a === "up" && i > 0) [ordem[i - 1], ordem[i]] = [ordem[i], ordem[i - 1]];
      else if (a === "down" && i < ordem.length - 1) [ordem[i + 1], ordem[i]] = [ordem[i], ordem[i + 1]];
      else return;
      this._bsig = null;
      this._patch({ button_order: ordem });
      this._renderButtons();
    }

    _renderBtnEditor() {
      if (!this._btnEditEl) return;
      this._btnEditEl.innerHTML = "";
      const k = this._bslot;
      const slot = BUTTON_SLOTS.find((x) => x.key === k);
      if (!slot) return;
      const c = this._cfg();
      const cenas = c.control === "scenes";
      const box = document.createElement("div");
      box.className = "mtl-edit";
      box.innerHTML = `<div class="top"><span>${esc(BUTTON_LABEL[k] || k)}</span>
        <span style="flex:1"></span><button class="mtl-ib" data-close="1">✕</button></div><div class="host"></div>`;
      box.querySelector("[data-close]").addEventListener("click", () => { this._bslot = null; this._renderBtnEditor(); });
      this._btnEditEl.appendChild(box);

      const over = (c.button_overrides || {})[k] || {};
      const f = document.createElement("ha-form");
      f.hass = this._hass;
      f.computeLabel = (x) => LABELS[x.name] || x.name;
      f.schema = [
        { name: "entity", selector: { entity: cenas ? { domain: ["scene", "script"] } : { domain: [slot.domain] } } },
        { name: "", type: "grid", schema: [
          { name: "icon", selector: { icon: {} } },
          { name: "name", selector: { text: {} } },
        ] },
      ];
      f.data = { entity: (this._bmap || {})[k] || "", icon: over.icon || slot.icon, name: over.name || slot.name };
      f.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = { ...ev.detail.value };
        const ent = Array.isArray(v.entity) ? v.entity[0] : v.entity;
        const chave = cenas ? "scenes" : "buttons_map";
        const mapa = { ...(this._config[chave] || {}) };
        if (ent) mapa[k] = ent; else delete mapa[k];
        const overs = { ...(this._config.button_overrides || {}) };
        const novo = {};
        if (v.icon && v.icon !== slot.icon) novo.icon = v.icon;
        if (v.name && v.name !== slot.name) novo.name = v.name;
        if (Object.keys(novo).length) overs[k] = novo; else delete overs[k];
        this._bsig = null;
        this._patch({
          [chave]: Object.keys(mapa).length ? mapa : undefined,
          button_overrides: Object.keys(overs).length ? overs : undefined,
        });
        this._renderButtons();
      });
      box.querySelector(".host").appendChild(f);
    }

    /* ----------------------------- mostradores ---------------------------- */

    _renderGauges() {
      if (!this._gaugesEl || !this._config) return;
      const c = this._cfg();
      const achados = { ...(this._hass ? guessAir(this._hass, c) : {}), ...clean(c.sensors || {}) };
      const ordem = (Array.isArray(c.gauge_order) && c.gauge_order.length ? [...c.gauge_order] : [...GAUGE_ORDER]);
      const escondidos = c.gauge_hidden || [];
      const s = sig([achados, ordem, escondidos]);
      if (s === this._gsig && this._gaugesEl.children.length) return;
      this._gsig = s;
      const n = ordem.length;
      this._gaugesEl.innerHTML = ordem.map((k, i) => {
        const ent = achados[k];
        const off = escondidos.includes(k) || !ent;
        const e = MW_AQ_SCALE[k];
        return `<div class="mtl-row ${off ? "off" : ""}">
          <button class="mtl-ib ${off ? "" : "on"}" data-a="vis" data-i="${i}" ${ent ? "" : "disabled"}>${off ? "☐" : "☑"}</button>
          <span class="nm">${esc(GAUGE_NAME[k] || k)}
            <small>${esc(ent || "— sem sensor —")} · ${e.min}–${e.max} ${esc(e.unit)}</small></span>
          <button class="mtl-ib" data-a="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="mtl-ib" data-a="down" data-i="${i}" ${i === n - 1 ? "disabled" : ""}>↓</button>
        </div>`;
      }).join("");
      this._gaugesEl.querySelectorAll("[data-a]").forEach((b) =>
        b.addEventListener("click", () => this._gAction(b.dataset.a, +b.dataset.i)));

      // escolha manual do sensor de cada grandeza
      this._gForm.hass = this._hass;
      this._gForm.computeLabel = (x) => `Sensor de ${GAUGE_NAME[x.name] || x.name}`;
      this._gForm.schema = GAUGE_ORDER.map((k) => ({ name: k, selector: { entity: { domain: "sensor" } } }));
      const data = {};
      for (const k of GAUGE_ORDER) if (achados[k]) data[k] = achados[k];
      this._gForm.data = data;
    }

    _gAction(a, i) {
      const c = this._cfg();
      const ordem = (Array.isArray(c.gauge_order) && c.gauge_order.length ? [...c.gauge_order] : [...GAUGE_ORDER]);
      const k = ordem[i];
      if (a === "vis") {
        const esc2 = new Set(c.gauge_hidden || []);
        if (esc2.has(k)) esc2.delete(k); else esc2.add(k);
        this._gsig = null;
        this._patch({ gauge_hidden: esc2.size ? [...esc2] : undefined });
        this._renderGauges(); return;
      }
      if (a === "up" && i > 0) [ordem[i - 1], ordem[i]] = [ordem[i], ordem[i - 1]];
      else if (a === "down" && i < ordem.length - 1) [ordem[i + 1], ordem[i]] = [ordem[i], ordem[i + 1]];
      else return;
      this._gsig = null;
      this._patch({ gauge_order: ordem });
      this._renderGauges();
    }

    _onGauges(v) {
      const auto = this._hass ? guessAir(this._hass, this._cfg()) : {};
      const mapa = {};
      for (const k of GAUGE_ORDER) {
        const ent = Array.isArray(v[k]) ? v[k][0] : v[k];
        if (ent && ent !== auto[k]) mapa[k] = ent;
      }
      this._gsig = null;
      this._patch({ sensors: Object.keys(mapa).length ? mapa : undefined });
      this._renderGauges();
    }

    /* ------------------------------ nível/modo ---------------------------- */

    _renderLevels() {
      if (!this._lvlRows || !this._config) return;
      const c = this._cfg();
      const achados = { ...(this._hass ? guessLevels(this._hass, c.device) : {}), ...clean(c.levels_map || {}) };
      this._lvlRows.innerHTML = LEVEL_SLOTS.map((s) => `<div class="mtl-row">
        <span class="nm">${esc(s.name)} <small>${esc(achados[s.key] || "— sem seletor —")}</small></span></div>`).join("");
      this._lvlForm.hass = this._hass;
      this._lvlForm.computeLabel = (x) => {
        const s = LEVEL_SLOTS.find((y) => y.key === x.name);
        return s ? `Seletor de ${s.name}` : (LABELS[x.name] || x.name);
      };
      this._lvlForm.schema = [
        ...LEVEL_SLOTS.map((s) => ({ name: s.key, selector: { entity: { domain: ["select", "input_select"] } } })),
        { name: "", type: "grid", schema: [
          { name: "height", selector: { number: { min: 24, max: 120, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "level_paint", selector: { select: { mode: "dropdown", options: PAINT_OPTIONS } } },
          { name: "level_scheme", selector: { select: { mode: "dropdown", options: SCHEME_OPTIONS } } },
        ] },
      ];
      const o = c.level_options || {};
      this._lvlForm.data = {
        ...achados,
        height: o.height || 50,
        level_paint: o.level_paint || "both",
        level_scheme: o.level_scheme || "semaforo",
      };
    }

    _onLevels(v) {
      const auto = this._hass ? guessLevels(this._hass, this._cfg().device) : {};
      const mapa = {};
      for (const s of LEVEL_SLOTS) {
        const ent = Array.isArray(v[s.key]) ? v[s.key][0] : v[s.key];
        if (ent && ent !== auto[s.key]) mapa[s.key] = ent;
      }
      const o = {};
      if (Number(v.height) && Number(v.height) !== 50) o.height = Number(v.height);
      if (v.level_paint && v.level_paint !== "both") o.level_paint = v.level_paint;
      // o esquema do NÍVEL é semáforo por padrão; o MODO tem cores nomeadas e
      // não usa esquema — por isso ele só entra no override do nível
      if (v.level_scheme && v.level_scheme !== "semaforo") {
        this._patch({ level_overrides: { ...(this._config.level_overrides || {}),
          speed: { ...((this._config.level_overrides || {}).speed || {}), level_scheme: v.level_scheme } } });
      }
      this._patch({
        levels_map: Object.keys(mapa).length ? mapa : undefined,
        level_options: Object.keys(o).length ? o : undefined,
      });
      this._renderLevels();
    }

    /* --------------------- esterilizar / log (listas) --------------------- */

    _renderListas() {
      if (!this._stList || !this._config) return;
      const c = this._cfg();
      this._stForm.hass = this._hass;
      this._stForm.schema = [
        { name: "sterilize_scene", selector: { entity: { domain: ["scene", "script"] } } },
        { name: "sterilize_icon", selector: { icon: {} } },
      ];
      this._stForm.data = clean({ sterilize_scene: c.sterilize_scene, sterilize_icon: c.sterilize_icon });

      const lista = (el, chave, ids) => {
        el.innerHTML = ids.map((id, i) => `<div class="mtl-row">
          <span class="nm">${esc(this._hass ? friendly(this._hass, id) : id)} <small>${esc(id)}</small></span>
          <button class="mtl-ib" data-a="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="mtl-ib" data-a="down" data-i="${i}" ${i === ids.length - 1 ? "disabled" : ""}>↓</button>
          <button class="mtl-ib del" data-a="del" data-i="${i}">✕</button>
        </div>`).join("") || `<div class="mtl-info">Nenhuma entidade.</div>`;
        el.querySelectorAll("[data-a]").forEach((b) =>
          b.addEventListener("click", () => this._listAction(chave, b.dataset.a, +b.dataset.i)));
      };
      lista(this._stList, "sterilize_when", c.sterilize_when || []);
      lista(this._logList, "log_entities", c.log_entities || []);

      this._stAdd.hass = this._hass;
      this._stAdd.computeLabel = () => "+ entidade que precisa estar ligada";
      this._stAdd.schema = [{ name: "add", selector: { entity: {} } }];
      this._stAdd.data = {};

      this._logAdd.hass = this._hass;
      this._logAdd.computeLabel = () => "+ entidade no log";
      this._logAdd.schema = [{ name: "add", selector: { entity: {} } }];
      this._logAdd.data = {};

      this._logForm.hass = this._hass;
      this._logForm.schema = [{ name: "log_hours", selector: { number: { min: 1, max: 72, step: 1, mode: "box", unit_of_measurement: "h" } } }];
      this._logForm.data = { log_hours: c.log_hours };
    }

    _listAction(chave, a, i) {
      const ids = [...(this._config[chave] || [])];
      if (a === "up" && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
      else if (a === "down" && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
      else if (a === "del") ids.splice(i, 1);
      else return;
      this._patch({ [chave]: ids.length ? ids : undefined });
      this._renderListas();
    }

    _onAdd(chave, v) {
      const id = Array.isArray(v.add) ? v.add[0] : v.add;
      if (!id) return;
      const ids = [...(this._config[chave] || [])];
      if (ids.includes(id)) return;
      ids.push(id);
      this._patch({ [chave]: ids });
      this._renderListas();
    }

    _onSter(v) {
      const um = (x) => (Array.isArray(x) ? x[0] : x);
      this._patch({
        sterilize_scene: um(v.sterilize_scene) || undefined,
        sterilize_icon: v.sterilize_icon && v.sterilize_icon !== "mdi:target" ? v.sterilize_icon : undefined,
      });
    }

    /* --------------------------- cards de dentro -------------------------- */

    _renderChildForms() {
      const c = this._cfg();
      const h = { button_columns: 2, button_radius: 12, show_button_names: false,
        show_select_value: true, hide_controls_when_off: true, confirm_buttons: true,
        paper_color: "paper", ...(c.humidifier_options || {}) };
      this._humForm.hass = this._hass;
      this._humForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "button_columns", selector: { number: { min: 1, max: 4, step: 1, mode: "box" } } },
          { name: "button_radius", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "gap", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "show_button_names", selector: { boolean: {} } },
          { name: "show_select_value", selector: { boolean: {} } },
          { name: "hide_controls_when_off", selector: { boolean: {} } },
          { name: "confirm_buttons", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
        ] },
        { name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } },
      ];
      this._humForm.data = h;

      const auto = this._hass ? powerSensors(this._hass, c) : {};
      const p = { ...POWER_DEFAULTS, paper_color: "paper", ...auto, ...(c.power_options || {}) };
      const info = this._root.querySelector("#pwinfo");
      if (info) {
        const achados = Object.values(auto).filter(Boolean).length;
        info.textContent = socketEntity(this._hass || {}, c)
          ? `${achados} de 3 sensores achados no dispositivo da tomada (Tuya, LocalTuya, Tapo…).`
          : "Escolha a tomada (entidade ou dispositivo) para criar a aba de energia.";
      }
      this._pwForm.hass = this._hass;
      this._pwForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "name", selector: { text: {} } },
          { name: "device_icon", selector: { icon: {} } },
          { name: "protocol_icon", selector: { icon: {} } },
        ] },
        { name: "background_image_url", selector: { text: {} } },
        { name: "", type: "grid", schema: [
          { name: "only_power", selector: { boolean: {} } },
          { name: "confirm", selector: { boolean: {} } },
          { name: "power_font_size", selector: { number: { min: 8, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "only_power_lift", selector: { number: { min: -20, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "expandable", title: "Sensores (vazio = descobre pelo dispositivo da tomada)", schema: [
          { name: "sensor_voltagem", selector: { entity: { domain: "sensor" } } },
          { name: "sensor_corrente", selector: { entity: { domain: "sensor" } } },
          { name: "sensor_potencia", selector: { entity: { domain: "sensor" } } },
        ] },
        { name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } },
      ];
      this._pwForm.data = p;
    }

    _onPower(v) {
      const o = clean({ ...v });
      const auto = this._hass ? powerSensors(this._hass, this._cfg()) : {};
      for (const k of ["sensor_voltagem", "sensor_corrente", "sensor_potencia"]) {
        const val = Array.isArray(o[k]) ? o[k][0] : o[k];
        if (!val || val === auto[k]) delete o[k]; else o[k] = val;
      }
      for (const [k, val] of Object.entries(POWER_DEFAULTS)) if (o[k] === val) delete o[k];
      this._patch({ power_options: Object.keys(o).length ? o : undefined });
    }

    /* -------------------------------- abas -------------------------------- */

    _renderTabForms() {
      const c = this._cfg();
      const abas = [
        ["purifier_tab", PUR_TAB], ["sterilize_tab_options", STER_TAB],
        ["energy_tab_options", ENERGY_TAB], ["log_tab_options", LOG_TAB],
      ];
      this._tabsRot.hass = this._hass;
      this._tabsRot.schema = abas.map(([chave]) => ({ name: "", type: "grid", schema: [
        { name: `${chave}__label`, selector: { text: {} } },
        { name: `${chave}__icon`, selector: { icon: {} } },
      ] }));
      // o nome do campo carrega a chave da aba: `<chave>__label` / `__icon`
      this._tabsRot.computeLabel = (x) => {
        const [chave, resto] = String(x.name).split("__");
        const pad = (abas.find(([k]) => k === chave) || [null, { label: chave }])[1];
        return resto === "icon" ? `Ícone · ${pad.label}` : `Rótulo · ${pad.label}`;
      };
      const data = {};
      for (const [chave, pad] of abas) {
        const atual = { ...pad, ...(c[chave] || {}) };
        data[`${chave}__label`] = atual.label;
        data[`${chave}__icon`] = atual.icon;
      }
      this._tabsRot.data = data;

      const o = { ...TABS_DEFAULTS, ...(c.tabs_options || {}) };
      const horiz = !o.tab_position || o.tab_position === "top" || o.tab_position === "bottom";
      this._tabsForm.hass = this._hass;
      this._tabsForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "tab_position", selector: { select: { mode: "dropdown", options: POS_OPTIONS } } },
          { name: "tab_display", selector: { select: { mode: "dropdown", options: DISP_OPTIONS } } },
          { name: "tab_icon_size", selector: { number: { min: 10, max: 48, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "tab_font_size", selector: { number: { min: 7, max: 28, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "tab_size", selector: { number: { min: 0, max: 240, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "default_tab", selector: { number: { min: 0, max: 5, step: 1, mode: "box" } } },
        ] },
        ...(horiz ? [{ name: "tab_stretch", selector: { boolean: {} } }] : [
          { name: "tab_rotate", selector: { select: { mode: "dropdown", options: [
            { value: "auto", label: "Automático (deita em retrato)" },
            { value: "true", label: "Sempre deitada" }, { value: "false", label: "Nunca" }] } } },
        ]),
        { name: "tab_align", selector: { select: { mode: "dropdown", options: [
          { value: "", label: "Automático" }, { value: "start", label: "No começo" },
          { value: "center", label: "No centro" }, { value: "end", label: "No fim" } ] } } },
        { name: "header", selector: { text: {} } },
        { name: "header_icon", selector: { icon: {} } },
        { name: "", type: "grid", schema: [
          { name: "shell_radius", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "panel_radius", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "notch_radius", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "padding", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "content_padding", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "card_gap", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "panel_min_height", selector: { number: { min: 0, max: 800, step: 4, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "elevation", selector: { boolean: {} } },
          { name: "flat_children", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
          { name: "keep_alive", selector: { boolean: {} } },
          { name: "remember_tab", selector: { boolean: {} } },
          { name: "preload", selector: { boolean: {} } },
        ] },
      ];
      const tdata = { ...o };
      for (const k of Object.keys(tdata)) if (tdata[k] === "" || tdata[k] === undefined) delete tdata[k];
      this._tabsForm.data = tdata;
    }

    _onTabRot(v) {
      const patch = {};
      for (const chave of ["purifier_tab", "sterilize_tab_options", "energy_tab_options", "log_tab_options"]) {
        const label = v[`${chave}__label`];
        const icon = v[`${chave}__icon`];
        const o = clean({ label, icon });
        if (Object.keys(o).length) patch[chave] = o;
      }
      this._patch(patch);
    }

    _onTabs(v) {
      const o = clean({ ...(this._config.tabs_options || {}), ...v });
      for (const [k, val] of Object.entries(TABS_DEFAULTS)) if (o[k] === undefined) o[k] = val;
      this._patch({ tabs_options: o });
      this._renderTabForms();
    }

    /* ------------------------------- cores -------------------------------- */

    _renderColors() {
      this._paperForm.hass = this._hass;
      this._paperForm.schema = [{ name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } }];
      this._paperForm.data = { paper_color: this._config.paper_color || DEFAULTS.paper_color };

      const campos = [
        ["shell_color", null],
        ["tab_active_color", "tabs_options"], ["tab_inactive_color", "tabs_options"],
        ["content_text_color", "tabs_options"], ["header_color", "tabs_options"],
        ["header_text_color", "tabs_options"],
      ];
      const valor = (name, onde) => (onde ? (this._config[onde] || {})[name] : this._config[name])
        ?? (name === "shell_color" ? DEFAULTS.shell_color : "");
      this._colorRows.innerHTML = campos.map(([name, onde]) => {
        const cur = valor(name, onde);
        const col = parseColor(cur || "rgba(128,128,128,1)");
        return `<div class="mtl-crow" data-name="${name}" data-onde="${onde || ""}">
          <span class="lbl">${LABELS[name] || name}</span>
          <input type="color" value="${toHex(col)}" title="cor">
          <input type="range" min="0" max="1" step="0.01" value="${col.a}" title="transparência (alfa)">
          <code>${esc(cur || "—")}</code></div>`;
      }).join("");
      this._colorRows.querySelectorAll(".mtl-crow").forEach((row) => {
        const name = row.dataset.name, onde = row.dataset.onde;
        const apply = () => {
          const { r, g, b } = parseColor(row.querySelector("input[type=color]").value);
          const a = parseFloat(row.querySelector("input[type=range]").value);
          const v = toRgba({ r, g, b, a });
          if (onde) this._patch({ [onde]: { ...(this._config[onde] || {}), [name]: v } });
          else this._patch({ [name]: v });
          row.querySelector("code").textContent = v;
        };
        row.querySelector("input[type=color]").addEventListener("input", apply);
        row.querySelector("input[type=range]").addEventListener("input", apply);
      });
    }

    /* -------------------------------- yaml -------------------------------- */

    async _renderYamlPieces() {
      if (!this._hass) return;
      const c = this._cfg();
      const pecas = [
        ["#humsec", "#humyaml", controlCard(this._hass, c), c.control === "scenes" ? "scene_options" : "humidifier_options"],
        ["#gsec", "#gyaml", gaugesGrid(this._hass, c), null],
        ["#pwsec", "#pwyaml", powerCard(this._hass, c), "power_options"],
      ];
      for (const [secSel, hostSel, gerado, chave] of pecas) {
        const sec = this._root.querySelector(secSel);
        const host = this._root.querySelector(hostSel);
        if (!sec.open || !host || !gerado) continue;
        if (host.dataset.pronto === sig(gerado)) continue;
        host.dataset.pronto = sig(gerado);
        await yamlBox(host, this._hass, gerado, (val) => {
          const over = diffObj(gerado, val);
          delete over.type;
          if (chave) this._patch({ [chave]: { ...(this._config[chave] || {}), ...over } });
          else {
            // a grade de mostradores não tem chave própria: o que muda vai
            // para o override cru, que é onde o dono manda mesmo
            this._patch({ yaml_override: deepMerge(this._config.yaml_override || {}, {}) });
          }
          host.dataset.pronto = "";
          this._renderChildForms();
        }, chave ? "grava só o que você mudou (merge sobre o gerado)"
          : "leitura: as faixas vêm da escala canônica (regra 90)");
      }
    }

    async _renderYaml() {
      const sec = this._root.querySelector("#yamlsec");
      if (!sec.open || !this._hass) return;
      const gerado = buildConfig(this._hass, this._cfg());
      await yamlBox(this._root.querySelector("#yamlgen"), this._hass, gerado, (val) => {
        this._patch({ yaml_override: diffObj(gerado, val) });
      }, "editar aqui grava as diferenças em yaml_override");
      await yamlBox(this._root.querySelector("#yamlover"), this._hass, this._config.yaml_override || {}, (val) => {
        this._patch({ yaml_override: isObj(val) && Object.keys(val).length ? val : undefined });
      }, "merge por cima do gerado (null apaga uma chave)");
    }
  }

  /* --------------------------------- registro -------------------------------- */

  customElements.define("mw-tab-purifier-card", MwTabPurifierCard);
  customElements.define("mw-tab-purifier-card-editor", MwTabPurifierCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "mw-tab-purifier-card",
    name: "MW Tab Purifier",
    description: "O purificador de ar em abas: qualidade do ar, botões, nível e modo, esterilização, tomada e log.",
    preview: true,
    documentationURL: "https://github.com/visaodeempresa/mw-ha-tab-purifier-card",
  });

  console.info(`%c MW-TAB-PURIFIER-CARD %c ${VERSION} `,
    "background:#1a1a1a;color:#fdfaf3;font-weight:700;", "background:#e8e3d8;color:#1a1a1a;font-weight:700;");
})();
