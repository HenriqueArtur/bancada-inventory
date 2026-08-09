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

/**
 * An extra column on the stock table, reading one key out of `Item.extra`.
 *
 * This is how a subject gets its own field on screen without this plugin
 * learning about it. Electronics asks for `tensao`; a 3D-printing repository
 * would ask for `material`, and neither word belongs in here.
 */
export interface Column {
  key: string;
  label: string;
}

interface Labels {
  item: string;
  qty: string;
  usedIn: string;
  blocked: string;
  runningLow: string;
  source: string;
  hint: string;
}

interface Settings {
  file: string;
  label: string;
  route: string;
  /** Frontmatter key the lessons use to list what they consume. */
  key: string;
  root: string;
  columns: Column[];
  labels: Labels;
}

const DEFAULT_LABELS: Labels = {
  item: "Item",
  qty: "Qty",
  usedIn: "Used in",
  blocked: "blocked",
  runningLow: "Running low",
  source: "Source of truth",
  hint: "The last column shows which lessons each item appears in.",
};

const DEFAULTS: Settings = {
  file: "inventory.yml",
  label: "Parts",
  route: "/inventory",
  key: "componentes",
  root: "",
  columns: [],
  labels: DEFAULT_LABELS,
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
      const given = config as Partial<Settings>;
      // labels merge key by key: a repository that renames one column should
      // not have to restate the other six
      settings = { ...DEFAULTS, ...given, labels: { ...DEFAULT_LABELS, ...given.labels } };
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
            `<div class="part"><span>${escapeHtml(u.item?.name ?? u.id)}</span>` +
            `<span class="badge">${u.qty}×</span></div>`,
        )
        .join("");

      return [`<div class="card"><h3>${escapeHtml(settings.label)}</h3>${rows}</div>`];
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
            new Response(renderInventoryPage(inventory, lessons, settings), {
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
        },
      ];
    },
  };
}

/** The stock table, with what each item is used by. */
function renderInventoryPage(
  inventory: Map<string, Item>,
  lessons: {
    id: string;
    title: string;
    items: { id: string; qty: number }[];
  }[],
  settings: Settings,
): string {
  const { labels, columns } = settings;

  const rows = [...inventory.values()]
    .map((item) => {
      const uses = usedBy(item.id, lessons)
        .map((u) => `<a href="/p/${u.id}">${escapeHtml(u.id.split("-")[0]!)}</a>`)
        .join(" ");
      const blocked = item.blocked
        ? ` <span class="badge">${escapeHtml(labels.blocked)}</span>`
        : "";
      // `?? "—"` and not `|| "—"`: a legitimate 0 or "" would otherwise
      // render as a dash and read as "this item has no such field"
      const extra = columns
        .map((c) => `<td>${escapeHtml(String(item.extra[c.key] ?? "—"))}</td>`)
        .join("");

      return `<tr><td>${escapeHtml(item.name)}${blocked}<br>
        <code style="font-size:12px;color:var(--muted)">${escapeHtml(item.id)}</code></td>
        <td>${item.qty}</td>${extra}
        <td>${uses || "—"}</td></tr>`;
    })
    .join("");

  const low = checkRunningLow(inventory)
    .map((f) => `<li>${escapeHtml(f.message)}</li>`)
    .join("");

  const headers = [labels.item, labels.qty, ...columns.map((c) => c.label), labels.usedIn]
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join("");

  return `<h1>${escapeHtml(settings.label)}</h1>
    <p>${escapeHtml(labels.source)}: <code>${escapeHtml(settings.file)}</code>.
    ${escapeHtml(labels.hint)}</p>
    ${low ? `<div class="card"><h3>${escapeHtml(labels.runningLow)}</h3><ul>${low}</ul></div>` : ""}
    <table><thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody></table>`;
}
