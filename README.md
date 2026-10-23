# MW Tab Purifier Card

`custom:mw-tab-purifier-card` — o purificador de ar inteiro em abas.

| aba | o que entra |
|---|---|
| **PURIFICADOR** | CO₂, TVOC e formaldeído em `modern-circular-gauge` (escala canônica da casa) · foto · botões do aparelho (`mw-humidifier-card`) · nível e modo (`mw-humidifier-level-card`) |
| **ESTERILIZAR** | a cena de esterilização, visível só com o aparelho realmente ligado |
| **ENERGIA** | a tomada em `power-button-card` |
| **LOG** | `logbook` das entidades que interessam |

Compositor: a casca e as abas são do `custom:mw-tab-card`.

## Dois modos de comando

| modo | de onde vem o toque |
|---|---|
| `control: localtuya` (**padrão**) | as entidades do próprio aparelho — `fan.*`, `light.*state_light`, `switch.*child_lock`, `switch.*filter`, `select.*nível`, `select.*modo`. É o único que dá **estado de verdade** |
| `control: scenes` | cenas do HA, para quem só alcança o aparelho por infravermelho |

## Qualidade do ar

Faixas e cores vêm da **escala canônica da casa**
(`IA/rules/global/90-cores-de-qualidade-do-ar.md`), embutida como
`mw-air-quality-scale v1` — aqui não se inventa faixa nova:

| grandeza | min | max | 🟩 | 🟨 | 🟥 |
|---|---|---|---|---|---|
| CO₂ (ppm) | 350 | 2000 | 350 | 800 | 1200 |
| TVOC (ppm) | 0 | 2 | 0 | 0,3 | 0,6 |
| Formaldeído (mg/m³) | 0 | 0,3 | 0 | 0,08 | 0,1 |
| PM2.5 (µg/m³) | 0 | 150 | 0 | 12 | 35 |

O sensor de cada grandeza sai do `device_class`; sem ele (o caso do LocalTuya),
pelo nome. Dá para trocar qualquer um à mão no editor.

## Exemplo

```yaml
type: custom:mw-tab-purifier-card
device: 00a22ed54e157a886a7444c6352f2495
air_device: <id do sensor de qualidade do ar>
socket_device: <id da tomada>
image: /local/devices/purificador-ekaza-air-master.webp
sterilize_scene: scene.esterilizar_escritorio_em_um_minuto
sterilize_when:
  - switch.tomada_do_purificador_de_ar_do_escritorio
  - switch.purificador_de_ar_do_escritorio_potencia
log_entities:
  - fan.escritorio_purificador_de_ar_do_escritorio_local_fan
```

## Depende de (HACS)

`MW Tab Card` · `MW Humidifier Card` · `MW Humidifier Level Card` ·
`MW Power Button Card` · `MW Scene Button Card` (modo cenas) ·
`Modern Circular Gauge` · `card-mod` · `Mushroom`

## Verificação

```bash
node --check dist/mw-tab-purifier-card.js && node tools/probe.js
```

---

Autoria: MAYCON WILLIAN OLIVEIRA <visaodeempresa@gmail.com>
