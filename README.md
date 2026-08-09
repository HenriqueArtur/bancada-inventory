# @bancada/inventory

Inventory plugin for [bancada](https://github.com/HenriqueArtur/bancada): a
stock of things you own, and what each lesson consumes from it.

## Why it is not about electronics

Take the subject away and everything here still stands. "What do I have, how
much, what does this lesson need, can I build it" reads the same for filament,
lumber, a paid tool subscription and a resistor.

So an item is an id, a name, a quantity and whether it is usable. Anything a
subject adds — a resistor's voltage, a filament's nozzle temperature — rides
along in `extra`, untouched, and is read by the plugin that understands it.

Putting `voltage` in this type would make every 3D printing repository carry a
field about electricity.

## What it does

- **`Parts` card** on each lesson, naming what it uses and how many
- **an inventory page** listing the stock, with the lessons each item appears in
- **checks** for the repository gate: enough stock, nothing blocked, and a
  warning for consumables running out

A blocked item is one you own but cannot use yet — a board that came without
soldered headers, say. It fails the check loudly, because a lesson that depends
on it is a lesson you cannot do.

## Install

```bash
bun add @bancada/inventory
```

```json
{
  "plugins": [
    {
      "name": "inventory",
      "script": "@bancada/inventory",
      "config": { "file": "inventory.yml", "label": "Parts", "route": "/inventory" }
    }
  ]
}
```

| setting | default | what it is |
|---|---|---|
| `file` | `inventory.yml` | the stock, relative to the repository root |
| `label` | `Parts` | the card and menu title |
| `route` | `/inventory` | where the inventory page lives |
| `key` | `componentes` | the frontmatter key a lesson lists its uses under |
| `columns` | `[]` | extra table columns, each reading one key out of `extra` |
| `labels` | English | every string the page puts on screen |

The file is loaded once at startup. A missing one stops the server rather than
becoming an empty inventory — an empty one makes every "you do not own this"
finding true and useless.

### Your own columns

The stock table shows item, quantity and where each one is used. Anything else
is your subject's, so you name it:

```json
"columns": [{ "key": "voltage", "label": "Voltage" }]
```

Each `key` is read out of the item's `extra`, in order, between quantity and
the used-in column. An item without that field gets a dash.

### Another language

Every visible string has a key, and overriding one leaves the rest in English:

```json
"labels": { "item": "Peça", "qty": "Qtd", "usedIn": "Usado em" }
```

| key | default |
|---|---|
| `item` | `Item` |
| `qty` | `Qty` |
| `usedIn` | `Used in` |
| `blocked` | `blocked` |
| `runningLow` | `Running low` |
| `source` | `Source of truth` |
| `hint` | the sentence under the title |

## The file

```yaml
items:
  - id: red-led
    name: Red LED 5mm
    qty: 5
    consumable: true
    voltage: 3v3      # not ours; kept in `extra`
```

## For another plugin

Read what this one resolved instead of parsing the file again:

```ts
onLesson(lesson) {
  const uses = lesson.items;   // [{ id, qty, item }]
}
```

Declare `inventory` **before** your plugin in the config — the order is what
makes the data be there.

## License

MIT.
