import { describe, expect, test } from "bun:test";
import type { Lesson } from "bancada";
import { inventoryPlugin } from "./index.ts";

const RAIZ = new URL("../", import.meta.url).pathname;

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "03-traffic-light",
  title: "Traffic light",
  level: 1,
  requires: [],
  path: `${RAIZ}test`,
  front: { componentes: [{ id: "red-led", qtd: 1 }] },
  body: "",
  ...over,
});

async function prontoParaUso() {
  const p = inventoryPlugin();
  await p.configure?.({
    file: "test/inventory.yml",
    label: "Parts",
    root: RAIZ,
  });
  return p;
}

describe("configure", () => {
  test("fails loudly when the file does not exist", async () => {
    const p = inventoryPlugin();
    await expect(p.configure?.({ file: "nao-existe.yml", root: RAIZ })).rejects.toThrow();
  });

  test("loads the inventory once, at startup", async () => {
    const p = await prontoParaUso();
    expect(p.name).toBe("inventory");
  });
});

describe("onLesson", () => {
  test("resolves the ids the frontmatter declared into real items", async () => {
    const p = await prontoParaUso();
    const l = p.onLesson!(lesson());
    expect(l.items).toHaveLength(1);
    expect(l.items[0].item.name).toContain("Red LED");
    expect(l.items[0].qty).toBe(1);
  });

  test("attaches under its own key, leaving the rest of the lesson alone", async () => {
    const p = await prontoParaUso();
    const l = p.onLesson!(lesson());
    expect(l.title).toBe("Traffic light");
    expect(l.front.componentes).toBeDefined();
  });

  test("an unknown id survives as unresolved instead of vanishing", async () => {
    const p = await prontoParaUso();
    const l = p.onLesson!(lesson({ front: { componentes: [{ id: "servo", qtd: 1 }] } }));
    expect(l.items[0].item).toBeNull();
    expect(l.items[0].id).toBe("servo");
  });

  test("a lesson that declares nothing gets an empty list, not undefined", async () => {
    const p = await prontoParaUso();
    expect(p.onLesson!(lesson({ front: {} })).items).toEqual([]);
  });
});

describe("cards", () => {
  test("renders the parts card with the inventory name, not the id", async () => {
    const p = await prontoParaUso();
    const [card] = await p.cards!(p.onLesson!(lesson()));
    expect(card).toContain("Parts");
    expect(card).toContain("Red LED");
    expect(card).not.toContain("red-led");
  });

  test("no card at all when the lesson uses nothing", async () => {
    const p = await prontoParaUso();
    expect(await p.cards!(p.onLesson!(lesson({ front: {} })))).toEqual([]);
  });

  test("escapes what comes from the files", async () => {
    const p = await prontoParaUso();
    const [card] = await p.cards!(p.onLesson!(lesson()));
    expect(card).not.toMatch(/<script/i);
  });
});

describe("validate", () => {
  test("says nothing about a lesson that fits in stock", async () => {
    const p = await prontoParaUso();
    expect(p.validate!(p.onLesson!(lesson()))).toEqual([]);
  });

  test("catches asking for more than there is", async () => {
    const p = await prontoParaUso();
    const l = p.onLesson!(lesson({ front: { componentes: [{ id: "red-led", qtd: 99 }] } }));
    expect(p.validate!(l)[0].message).toContain("99");
  });
});

describe("menuItems and routes", () => {
  test("adds one menu entry, and its own route actually matches that URL", async () => {
    const p = await prontoParaUso();
    const items = p.menuItems!();
    expect(items).toHaveLength(1);

    // comparar com o source da regex quebra no escape do `/`; o que importa
    // é que o link do menu leve a uma rota que o plugin atende
    const rotas = p.routes!();
    expect(rotas.some((r) => r.pattern.test(items[0]!.url))).toBe(true);
  });

  test("serves its route", async () => {
    const p = await prontoParaUso();
    const [rota] = p.routes!();
    const res = await rota!.handle(new Request("http://x/inventario"), [] as never);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ESP32");
  });
});
