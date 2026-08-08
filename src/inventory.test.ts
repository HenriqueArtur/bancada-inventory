import { describe, expect, test } from "bun:test";
import { checkRunningLow, checkStock, type Item, readInventory, usedBy } from "./inventory.ts";

const path = new URL("../test/inventory.yml", import.meta.url).pathname;
const inventory = await readInventory(path);

const item = (over: Partial<Item> = {}): Item => ({
  id: "led",
  name: "Red LED",
  qty: 5,
  extra: {},
  ...over,
});
const inv = (...items: Item[]) => new Map(items.map((i) => [i.id, i]));
const msgs = (f: { message: string }[]) => f.map((x) => x.message).join(" | ");

describe("readInventory", () => {
  test("reads this repository's inventory", () => {
    expect(inventory.size).toBeGreaterThan(0);
  });

  test("keys by id and maps the shared fields", () => {
    const esp = inventory.get("esp32")!;
    expect(esp.name).toContain("ESP32");
    expect(typeof esp.qty).toBe("number");
  });

  test("subject-specific fields survive in `extra`, untouched", () => {
    // voltage belongs to electronics, not to the idea of a stock
    expect(inventory.get("esp32")!.extra.voltage).toBe("3v3");
    expect(inventory.get("esp32")!.extra.interface).toBeDefined();
  });

  test("nothing a subject wrote is dropped on the floor", () => {
    for (const i of inventory.values()) {
      expect(i.id, "id").toBeTruthy();
      expect(i.name, i.id).toBeTruthy();
    }
  });

  test("a blocked item always says why", () => {
    for (const i of inventory.values()) {
      if (i.blocked) expect(i.blockedReason, i.id).toBeTruthy();
    }
  });

  test("a missing file fails loudly instead of pretending to be empty", async () => {
    await expect(readInventory("/tmp/no-such-inventory.yml")).rejects.toThrow();
  });
});

describe("checkStock", () => {
  test("accepts a quantity within stock", () => {
    expect(checkStock("03-x", [{ id: "led", qty: 3 }], inv(item()))).toEqual([]);
  });

  test("accepts using the whole stock", () => {
    expect(checkStock("03-x", [{ id: "led", qty: 5 }], inv(item()))).toEqual([]);
  });

  test("catches asking for more than there is", () => {
    const f = checkStock("03-x", [{ id: "led", qty: 6 }], inv(item()));
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("6");
  });

  test("catches an item that is not in the inventory", () => {
    expect(msgs(checkStock("03-x", [{ id: "servo", qty: 1 }], inv(item())))).toContain("servo");
  });

  test("catches a blocked item even when there is stock", () => {
    const rp = item({
      id: "rp",
      name: "RP2040",
      blocked: true,
      blockedReason: "no headers",
    });
    expect(msgs(checkStock("03-x", [{ id: "rp", qty: 1 }], inv(rp)))).toContain("blocked");
  });

  test("one unknown item does not swallow the other findings", () => {
    const uses = [
      { id: "nope", qty: 1 },
      { id: "led", qty: 99 },
    ];
    expect(checkStock("03-x", uses, inv(item({ qty: 1 })))).toHaveLength(2);
  });
});

describe("checkRunningLow", () => {
  test("warns about a consumable at the floor", () => {
    expect(checkRunningLow(inv(item({ qty: 1, consumable: true })))).toHaveLength(1);
  });

  test("is a warning, never an error — low stock does not break a build", () => {
    expect(checkRunningLow(inv(item({ qty: 1, consumable: true })))[0]!.level).toBe("warning");
  });

  test("says nothing about a non-consumable with low stock", () => {
    expect(checkRunningLow(inv(item({ qty: 1, consumable: false })))).toEqual([]);
  });

  test("says nothing when there is plenty", () => {
    expect(checkRunningLow(inv(item({ qty: 10, consumable: true })))).toEqual([]);
  });
});

describe("usedBy", () => {
  const lessons = [
    { id: "02", title: "LED", items: [{ id: "led", qty: 1 }] },
    { id: "03", title: "Traffic light", items: [{ id: "led", qty: 3 }] },
    { id: "04", title: "Button", items: [{ id: "button", qty: 1 }] },
  ];

  test("finds every lesson that uses the item", () => {
    expect(usedBy("led", lessons).map((u) => u.id)).toEqual(["02", "03"]);
  });

  test("reports how many each one asks for", () => {
    expect(usedBy("led", lessons).map((u) => u.qty)).toEqual([1, 3]);
  });

  test("an unused item yields an empty list", () => {
    expect(usedBy("nothing", lessons)).toEqual([]);
  });
});
