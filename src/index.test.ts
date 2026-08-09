import { describe, expect, test } from "bun:test";
import type { Lesson } from "bancada";
import { inventoryPlugin } from "./index.ts";

const ROOT = new URL("../", import.meta.url).pathname;

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "03-traffic-light",
  title: "Traffic light",
  level: 1,
  requires: [],
  path: `${ROOT}test`,
  front: { componentes: [{ id: "red-led", qtd: 1 }] },
  body: "",
  ...over,
});

async function ready(extra: Record<string, unknown> = {}) {
  const p = inventoryPlugin();
  await p.configure?.({
    file: "test/inventory.yml",
    label: "Parts",
    root: ROOT,
    ...extra,
  });
  return p;
}

const pageOf = async (p: ReturnType<typeof inventoryPlugin>): Promise<string> =>
  (await p.routes!()[0]!.handle(new Request("http://x/inventory"), [] as never)).text();

describe("configure", () => {
  test("fails loudly when the file does not exist", async () => {
    const p = inventoryPlugin();
    await expect(p.configure?.({ file: "nao-existe.yml", root: ROOT })).rejects.toThrow();
  });

  test("loads the inventory once, at startup", async () => {
    const p = await ready();
    expect(p.name).toBe("inventory");
  });
});

describe("onLesson", () => {
  test("resolves the ids the frontmatter declared into real items", async () => {
    const p = await ready();
    const l = p.onLesson!(lesson());
    expect(l.items).toHaveLength(1);
    expect(l.items[0].item.name).toContain("Red LED");
    expect(l.items[0].qty).toBe(1);
  });

  test("attaches under its own key, leaving the rest of the lesson alone", async () => {
    const p = await ready();
    const l = p.onLesson!(lesson());
    expect(l.title).toBe("Traffic light");
    expect(l.front.componentes).toBeDefined();
  });

  test("an unknown id survives as unresolved instead of vanishing", async () => {
    const p = await ready();
    const l = p.onLesson!(lesson({ front: { componentes: [{ id: "servo", qtd: 1 }] } }));
    expect(l.items[0].item).toBeNull();
    expect(l.items[0].id).toBe("servo");
  });

  test("a lesson that declares nothing gets an empty list, not undefined", async () => {
    const p = await ready();
    expect(p.onLesson!(lesson({ front: {} })).items).toEqual([]);
  });
});

describe("cards", () => {
  test("renders the parts card with the inventory name, not the id", async () => {
    const p = await ready();
    const [card] = await p.cards!(p.onLesson!(lesson()));
    expect(card).toContain("Parts");
    expect(card).toContain("Red LED");
    expect(card).not.toContain("red-led");
  });

  test("no card at all when the lesson uses nothing", async () => {
    const p = await ready();
    expect(await p.cards!(p.onLesson!(lesson({ front: {} })))).toEqual([]);
  });

  test("escapes what comes from the files", async () => {
    const p = await ready();
    const [card] = await p.cards!(p.onLesson!(lesson()));
    expect(card).not.toMatch(/<script/i);
  });
});

describe("validate", () => {
  test("says nothing about a lesson that fits in stock", async () => {
    const p = await ready();
    expect(p.validate!(p.onLesson!(lesson()))).toEqual([]);
  });

  test("catches asking for more than there is", async () => {
    const p = await ready();
    const l = p.onLesson!(lesson({ front: { componentes: [{ id: "red-led", qtd: 99 }] } }));
    expect(p.validate!(l)[0].message).toContain("99");
  });
});

describe("menuItems and routes", () => {
  test("adds one menu entry, and its own route actually matches that URL", async () => {
    const p = await ready();
    const items = p.menuItems!();
    expect(items).toHaveLength(1);

    // comparing against the regex source breaks on the escaped `/`; what
    // matters is that the menu link lands on a route this plugin serves
    const routes = p.routes!();
    expect(routes.some((r) => r.pattern.test(items[0]!.url))).toBe(true);
  });

  test("serves its route", async () => {
    const p = await ready();
    const [route] = p.routes!();
    const res = await route!.handle(new Request("http://x/inventory"), [] as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ESP32");
  });
});

/**
 * This package ships in English and claims to be subject-agnostic. Both claims
 * are testable: no other language in the defaults, and no field belonging to
 * one subject on the page unless a repository asks for it by name.
 */
describe("the page speaks the configured language, not the author's", () => {
  test("every visible string can be replaced from the config", async () => {
    const p = await ready({
      labels: { item: "Peça", qty: "Qtd", usedIn: "Usado em", runningLow: "Acabando" },
    });
    const html = await pageOf(p);
    for (const t of ["Peça", "Qtd", "Usado em", "Acabando"]) expect(html, t).toContain(t);
  });

  test("a repository that renames one label keeps the English defaults for the rest", async () => {
    const html = await pageOf(await ready({ labels: { qty: "Qtd" } }));
    expect(html).toContain("Qtd");
    expect(html).toContain("Used in");
  });

  test("the defaults are English", async () => {
    const html = await pageOf(await ready());
    expect(html).toContain("Item");
    expect(html).toContain("Used in");
    expect(html).toContain("Source of truth");
  });

  test("says nothing about voltage unless the repository asks for that column", async () => {
    expect(await pageOf(await ready())).not.toContain("3v3");
  });

  test("an extra column renders the field the repository named", async () => {
    const html = await pageOf(await ready({ columns: [{ key: "voltage", label: "Voltage" }] }));
    expect(html).toContain("Voltage");
    expect(html).toContain("3v3");
  });

  test("the extra column lands between qty and used-in, where its header is", async () => {
    const html = await pageOf(await ready({ columns: [{ key: "voltage", label: "Voltage" }] }));
    const headers = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual(["Item", "Qty", "Voltage", "Used in"]);
    const cells = [...html.matchAll(/<tr><td>ESP32[\s\S]*?<\/tr>/g)][0]!;
    expect(cells[0]!.indexOf("3v3")).toBeGreaterThan(cells[0]!.indexOf("<td>1</td>"));
  });

  test("an item missing that field gets a dash, not the word undefined", async () => {
    const html = await pageOf(await ready({ columns: [{ key: "no-such-field", label: "X" }] }));
    expect(html).not.toContain("undefined");
    expect(html).toContain("—");
  });
});
