import "fake-indexeddb/auto";

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type IdbMigration } from "@/lib/storage/idb";

import { sampleConversation, userTurn } from "./fixtures";
import { MIGRATIONS, STORE_CONVERSATIONS, STORE_META, ConversationStore } from "./store";

let factory: IDBFactory;
let store: ConversationStore;

beforeEach(() => {
  factory = new IDBFactory();
  store = new ConversationStore(factory, MIGRATIONS, "test-db", false);
});
afterEach(async () => {
  await store.close();
});

describe("ConversationStore", () => {
  it("saves, lists newest first, and reads back a record", async () => {
    await store.put(sampleConversation({ id: "a", updatedAt: 100 }));
    await store.put(sampleConversation({ id: "b", updatedAt: 300 }));
    await store.put(sampleConversation({ id: "c", updatedAt: 200 }));
    const metas = await store.listMeta();
    expect(metas.map((m) => m.id)).toEqual(["b", "c", "a"]);
    const record = await store.get("a");
    expect(record?.turns).toHaveLength(2);
    expect(await store.get("missing")).toBeNull();
  });

  it("overwrites by id and keeps list and record in step", async () => {
    await store.put(sampleConversation({ id: "a", title: "one" }));
    await store.put(sampleConversation({ id: "a", title: "two" }));
    expect((await store.listMeta()).map((m) => m.title)).toEqual(["two"]);
    expect((await store.get("a"))?.title).toBe("two");
  });

  it("renames and marks the title as manual", async () => {
    await store.put(sampleConversation({ id: "a", title: "auto", titleAuto: true }));
    expect(await store.rename("a", "My name")).toBe(true);
    const record = await store.get("a");
    expect(record?.title).toBe("My name");
    expect(record?.titleAuto).toBe(false);
    expect((await store.listMeta())[0]!.title).toBe("My name");
    expect(await store.rename("nope", "x")).toBe(false);
  });

  it("removes one and clears all", async () => {
    await store.put(sampleConversation({ id: "a" }));
    await store.put(sampleConversation({ id: "b" }));
    await store.remove("a");
    expect((await store.listMeta()).map((m) => m.id)).toEqual(["b"]);
    expect(await store.get("a")).toBeNull();
    await store.clear();
    expect(await store.listMeta()).toEqual([]);
  });

  it("reports count and approximate bytes", async () => {
    await store.put(sampleConversation({ id: "a" }));
    const stats = await store.stats();
    expect(stats.count).toBe(1);
    expect(stats.bytes).toBeGreaterThan(500);
  });

  it("skips records it cannot read when exporting everything", async () => {
    await store.put(sampleConversation({ id: "a" }));
    const db = await openDatabase("test-db", MIGRATIONS, factory);
    const tx = db.transaction(STORE_CONVERSATIONS, "readwrite");
    tx.objectStore(STORE_CONVERSATIONS).put({ id: "future", v: 99, turns: [] });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
    const { records, skipped } = await store.getAll();
    expect(records.map((r) => r.id)).toEqual(["a"]);
    expect(skipped).toBe(1);
    expect(await store.get("future")).toBeNull();
  });

  it("putMany counts saved records", async () => {
    const result = await store.putMany([sampleConversation({ id: "a" }), sampleConversation({ id: "b" })]);
    expect(result).toEqual({ saved: 2, failed: 0 });
    expect(await store.has("b")).toBe(true);
  });

  it("is unavailable when IndexedDB cannot open", async () => {
    const broken = { open: () => { throw new Error("blocked"); } } as unknown as IDBFactory;
    const bad = new ConversationStore(broken, MIGRATIONS, "x", false);
    expect(await bad.available()).toBe(false);
    await expect(bad.listMeta()).rejects.toThrow();
    expect((await bad.put(sampleConversation())).ok).toBe(false);
  });
});

describe("open failures are not cached", () => {
  it("retries opening on the next access after a failed open", async () => {
    let calls = 0;
    const flaky = {
      open: (name: string, version?: number) => {
        calls += 1;
        if (calls === 1) {
          const req = { error: new Error("boom") } as unknown as IDBOpenDBRequest;
          setTimeout(() => req.onerror?.(new Event("error")));
          return req;
        }
        return factory.open(name, version);
      },
    } as unknown as IDBFactory;
    const retrying = new ConversationStore(flaky, MIGRATIONS, "flaky-db", false);
    expect(await retrying.available()).toBe(false);
    expect(await retrying.available()).toBe(true);
    expect((await retrying.put(sampleConversation({ id: "a" }))).ok).toBe(true);
    expect((await retrying.listMeta()).map((m) => m.id)).toEqual(["a"]);
    expect(calls).toBe(2);
    await retrying.close();
  });

  it("reuses a successful open", async () => {
    let calls = 0;
    const counting = { open: (name: string, version?: number) => { calls += 1; return factory.open(name, version); } } as unknown as IDBFactory;
    const s = new ConversationStore(counting, MIGRATIONS, "count-db", false);
    await s.available();
    await s.listMeta();
    expect(calls).toBe(1);
    await s.close();
  });

  it("rejects a blocked open, then closes the late connection so a later open succeeds", async () => {
    const v1 = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open("blocky", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("one");
      req.onsuccess = () => resolve(req.result);
    });
    // v1 연결은 versionchange 를 무시해 업그레이드를 막는다
    const v2: IdbMigration[] = [
      { version: 1, migrate: (db) => { db.createObjectStore("one"); } },
      { version: 2, migrate: (db) => { db.createObjectStore("two"); } },
    ];
    await expect(openDatabase("blocky", v2, factory)).rejects.toThrow(/blocked/);
    v1.close();
    // 막혔던 요청이 뒤늦게 성공해도 그 연결은 닫히므로, 이후 더 높은 버전 열기가 막히지 않는다
    await new Promise((r) => setTimeout(r, 20));
    const v3 = await openDatabase("blocky", [...v2, { version: 3, migrate: () => {} }], factory);
    expect(v3.version).toBe(3);
    v3.close();
  });
});

describe("migrations", () => {
  it("runs only the steps above the stored version, in order", async () => {
    const calls: number[] = [];
    const v1: IdbMigration = { version: 1, migrate: (db) => { calls.push(1); db.createObjectStore("one", { keyPath: "id" }); } };
    const v2: IdbMigration = { version: 2, migrate: (db) => { calls.push(2); db.createObjectStore("two", { keyPath: "id" }); } };
    const v3: IdbMigration = { version: 3, migrate: (_db, tx) => { calls.push(3); tx.objectStore("one").createIndex("by", "by"); } };

    const first = await openDatabase("mig", [v1], factory);
    expect([...first.objectStoreNames]).toEqual(["one"]);
    first.close();
    expect(calls).toEqual([1]);

    const second = await openDatabase("mig", [v3, v1, v2], factory);
    expect(calls).toEqual([1, 2, 3]);
    expect([...second.objectStoreNames].sort()).toEqual(["one", "two"]);
    expect(second.version).toBe(3);
    second.close();
  });

  it("refuses to open a database written by a newer app", async () => {
    const newer = await openDatabase("future", [{ version: 5, migrate: (db) => { db.createObjectStore("x"); } }], factory);
    newer.close();
    await expect(openDatabase("future", MIGRATIONS, factory)).rejects.toBeTruthy();
  });

  it("creates the production stores at version 1", async () => {
    const db = await openDatabase("prod", MIGRATIONS, factory);
    expect([...db.objectStoreNames].sort()).toEqual([STORE_CONVERSATIONS, STORE_META].sort());
    db.close();
  });
});

describe("unused import guard", () => {
  it("keeps the fixtures exported", () => {
    expect(userTurn("x").role).toBe("user");
  });
});
