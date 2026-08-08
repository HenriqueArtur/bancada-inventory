/**
 * Inventory plugin: a stock of things you own, and what each lesson uses.
 *
 * Subject-agnostic on purpose. It answers "do I have enough", "is it usable",
 * "where is it used" — questions that read the same for filament, lumber and
 * resistors. Anything a subject adds rides in `Item.extra` and is read by the
 * plugin that understands it.
 */
import { join } from "node:path";
import type { Lesson, MenuItem, Plugin, Route } from "bancada";
import { checkRunningLow, checkStock, type Item, readInventory, usedBy } from "./inventory.ts";

export interface ResolvedUse {
  id: string;
  qty: number;
  /** null when the lesson names something the inventory does not have. */
  item: Item | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Settings {
  file: string;
  label: string;
  route: string;
  /** Frontmatter key the lessons use to list what they consume. */
  key: string;
  root: string;
}

const DEFAULTS: Settings = {
  file: "inventory.yml",
  label: "Parts",
  route: "/inventory",
  key: "componentes",
  root: "",
};

export function inventoryPlugin(): Plugin {
  let settings: Settings = DEFAULTS;
  let inventory = new Map<string, Item>();
  const lessons: {
    id: string;
    title: string;
    items: { id: string; qty: number }[];
  }[] = [];

  return {
    name: "inventory",

    async configure(config) {
      settings = { ...DEFAULTS, ...(config as Partial<Settings>) };
      // Loaded once at startup, not per request: a missing file has to stop
      // the server, not turn every lesson into "you own nothing".
      inventory = await readInventory(join(settings.root, settings.file));
    },

    onLesson(lesson: Lesson) {
      const declared = (lesson.front[settings.key] ?? []) as {
        id: string;
        qtd?: number;
        qty?: number;
      }[];

      const items: ResolvedUse[] = declared.map((d) => ({
        id: d.id,
        qty: d.qty ?? d.qtd ?? 1,
        item: inventory.get(d.id) ?? null,
      }));

      // remembered so the inventory page can answer "used in which lessons"
      lessons.push({
        id: lesson.id,
        title: lesson.title,
        items: items.map((i) => ({ id: i.id, qty: i.qty })),
      });

      return { ...lesson, items };
    },

    cards(lesson: Lesson) {
      const items = (lesson.items ?? []) as ResolvedUse[];
      if (items.length === 0) return [];

      const rows = items
        .map(
          (u) =>
            `<div class="peca"><span>${escapeHtml(u.item?.name ?? u.id)}</span>` +
            `<span class="selo">${u.qty}×</span></div>`,
        )
        .join("");

      return [`<div class="cartao"><h3>${escapeHtml(settings.label)}</h3>${rows}</div>`];
    },

    validate(lesson: Lesson) {
      const items = (lesson.items ?? []) as ResolvedUse[];
      return checkStock(
        lesson.id,
        items.map((i) => ({ id: i.id, qty: i.qty })),
        inventory,
      );
    },

    menuItems(): MenuItem[] {
      return [{ title: settings.label, url: settings.route }];
    },

    routes(): Route[] {
      return [
        {
          pattern: new RegExp(`^${settings.route}$`),
          handle: () =>
            new Response(paginaDoInventario(inventory, lessons, settings), {
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
        },
      ];
    },
  };
}

/** The stock table, with what each item is used by. */
function paginaDoInventario(
  inventory: Map<string, Item>,
  lessons: {
    id: string;
    title: string;
    items: { id: string; qty: number }[];
  }[],
  settings: Settings,
): string {
  const rows = [...inventory.values()]
    .map((item) => {
      const uses = usedBy(item.id, lessons)
        .map((u) => `<a href="/p/${u.id}">${escapeHtml(u.id.split("-")[0]!)}</a>`)
        .join(" ");
      const blocked = item.blocked ? ' <span class="selo">bloqueado</span>' : "";

      return `<tr><td>${escapeHtml(item.name)}${blocked}<br>
        <code style="font-size:12px;color:var(--suave)">${escapeHtml(item.id)}</code></td>
        <td>${item.qty}</td><td>${escapeHtml(String(item.extra.tensao ?? "—"))}</td>
        <td>${uses || "—"}</td></tr>`;
    })
    .join("");

  const baixo = checkRunningLow(inventory)
    .map((f) => `<li>${escapeHtml(f.message)}</li>`)
    .join("");

  return `<h1>${escapeHtml(settings.label)}</h1>
    <p>Fonte da verdade: <code>${escapeHtml(settings.file)}</code>.
    A última coluna mostra em que lições cada item aparece.</p>
    ${baixo ? `<div class="cartao"><h3>Acabando</h3><ul>${baixo}</ul></div>` : ""}
    <table><thead><tr><th>Item</th><th>Qtd</th><th>Tensão</th><th>Usado em</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}
