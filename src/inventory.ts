/**
 * A stock of things you own, and what each lesson consumes from it.
 *
 * Deliberately subject-agnostic: an item is an id, a name, a quantity and
 * whether it is usable. Filament, lumber, a paid tool subscription and a
 * resistor are all the same shape here.
 *
 * Anything a subject needs beyond that — a resistor's voltage, a filament's
 * nozzle temperature — rides along in `extra` and is read by the plugin that
 * understands it. Putting `voltage` in this type would make every 3D printing
 * repository carry a field about electricity.
 */
import { parse } from "yaml";

export interface Item {
  id: string;
  name: string;
  qty: number;
  kind?: string;
  consumable?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  notes?: string;
  /** Whatever the subject added. Untouched here; read by subject plugins. */
  extra: Record<string, unknown>;
}

/** Keys this plugin owns. Everything else in the YAML falls through to `extra`. */
const KNOWN: Record<string, keyof Item> = {
  id: "id",
  nome: "name",
  name: "name",
  qtd: "qty",
  qty: "qty",
  categoria: "kind",
  kind: "kind",
  consumivel: "consumable",
  consumable: "consumable",
  bloqueado: "blocked",
  blocked: "blocked",
  motivo_bloqueio: "blockedReason",
  blockedReason: "blockedReason",
  notas: "notes",
  notes: "notes",
};

export async function readInventory(path: string): Promise<Map<string, Item>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    // Failing loudly matters: an inventory read as empty makes every "you do
    // not own this" finding true and useless.
    throw new Error(`inventory not found at ${path}`);
  }

  const data = parse(await file.text()) as {
    componentes?: unknown[];
    items?: unknown[];
  };
  const rows = (data.items ?? data.componentes ?? []) as Record<string, unknown>[];

  return new Map(
    rows.map((row) => {
      const item: Item = { id: "", name: "", qty: 0, extra: {} };
      for (const [key, value] of Object.entries(row)) {
        const known = KNOWN[key];
        if (known) (item as unknown as Record<string, unknown>)[known] = value;
        else item.extra[key] = value;
      }
      return [item.id, item];
    }),
  );
}

export interface ItemUse {
  id: string;
  qty: number;
}

export interface Finding {
  level: "error" | "warning";
  where: string;
  message: string;
}

const error = (where: string, message: string): Finding => ({
  level: "error",
  where,
  message,
});
const warning = (where: string, message: string): Finding => ({
  level: "warning",
  where,
  message,
});

/** Do you own enough of everything this lesson asks for, and is it usable? */
export function checkStock(
  lessonId: string,
  uses: ItemUse[],
  inventory: Map<string, Item>,
): Finding[] {
  const findings: Finding[] = [];

  for (const use of uses) {
    const item = inventory.get(use.id);

    if (!item) {
      findings.push(error(lessonId, `item '${use.id}' is not in the inventory`));
      continue;
    }
    if (item.blocked) {
      const why = (item.blockedReason ?? "").trim().split("\n")[0];
      findings.push(error(lessonId, `uses ${item.name}, which is blocked: ${why}`));
    }
    if (use.qty > item.qty) {
      findings.push(error(lessonId, `asks for ${use.qty}x ${item.name}, stock is ${item.qty}`));
    }
  }

  return findings;
}

/** Consumables about to run out. A warning, never a build failure. */
export function checkRunningLow(inventory: Map<string, Item>, floor = 1): Finding[] {
  return [...inventory.values()]
    .filter((i) => i.consumable && i.qty <= floor)
    .map((i) => warning("inventory", `${i.name}: only ${i.qty} left`));
}

/** Which lessons use an item, and how many each one asks for. */
export function usedBy(
  itemId: string,
  lessons: { id: string; title: string; items: ItemUse[] }[],
): { id: string; title: string; qty: number }[] {
  return lessons
    .map((l) => ({ l, use: l.items.find((u) => u.id === itemId) }))
    .filter((x) => x.use)
    .map(({ l, use }) => ({ id: l.id, title: l.title, qty: use!.qty }));
}
