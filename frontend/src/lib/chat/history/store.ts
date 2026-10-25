// 대화 저장소 (IndexedDB). 브라우저에만 있고 서버로 가지 않는다.
//
//   DB      mcpc-chat
//   저장소  conversations  키 id, 전체 기록(StoredConversation)
//           meta           키 id, 목록용 요약(ConversationMeta). 본문을 열지 않고 목록, 검색, 크기 합계를 만든다.
//   인덱스  meta.updatedAt
// 쓰기는 두 저장소를 한 트랜잭션으로 묶는다. 버전은 MIGRATIONS 로 올린다 (lib/storage/idb.ts).
//
// IndexedDB 를 쓸 수 없는 환경 (시크릿 모드의 일부 브라우저, 정책으로 막힘): open 이 실패하고 UI 는 안내만 보인다.
// 변경이 있으면 BroadcastChannel 로 다른 탭에 알린다 (없으면 포커스 때 새로 읽는다).

import { isQuotaError, openDatabase, requestToPromise, transactionDone, type IdbMigration } from "@/lib/storage/idb";

import { deriveMeta, upgradeRecord, type ConversationMeta, type StoredConversation } from "./schema";

export const DB_NAME = "mcpc-chat";
export const STORE_CONVERSATIONS = "conversations";
export const STORE_META = "meta";
export const CHANNEL_NAME = "mcpc-conversations";

// 새 버전이 필요하면 항목을 더한다 (이미 배포된 항목은 고치지 않는다).
export const MIGRATIONS: readonly IdbMigration[] = [
  {
    version: 1,
    migrate: (db) => {
      db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
      const meta = db.createObjectStore(STORE_META, { keyPath: "id" });
      meta.createIndex("updatedAt", "updatedAt");
    },
  },
];

export type PutResult = { ok: true; meta: ConversationMeta } | { ok: false; reason: "quota" | "error" };

export class ConversationStore {
  // 열기 결과. 실패(오류, 다른 탭 때문에 막힘)는 담아 두지 않고 다음 호출에서 다시 연다.
  private openPromise: Promise<IDBDatabase> | null = null;
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly factory?: IDBFactory,
    private readonly migrations: readonly IdbMigration[] = MIGRATIONS,
    private readonly name: string = DB_NAME,
    private readonly notifyOthers: boolean = true,
  ) {
    void this.open().catch(() => {});
  }

  private open(): Promise<IDBDatabase> {
    if (!this.openPromise) {
      const pending = openDatabase(this.name, this.migrations, this.factory);
      this.openPromise = pending;
      pending.catch(() => {
        if (this.openPromise === pending) this.openPromise = null;
      });
    }
    return this.openPromise;
  }

  private get dbPromise(): Promise<IDBDatabase> {
    return this.open();
  }

  // 열 수 있으면 true. 열 수 없으면 false (다음 호출에서 다시 시도한다).
  async available(): Promise<boolean> {
    try {
      await this.dbPromise;
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    const pending = this.openPromise;
    this.openPromise = null;
    try {
      if (pending) (await pending).close();
    } catch {
      /* 열리지 않았으면 닫을 것이 없다 */
    }
    this.channel?.close();
    this.channel = null;
  }

  private announce() {
    if (!this.notifyOthers || typeof BroadcastChannel === "undefined") return;
    try {
      this.channel ??= new BroadcastChannel(CHANNEL_NAME);
      this.channel.postMessage({ type: "changed" });
    } catch {
      /* 알림은 편의 기능이다 */
    }
  }

  async listMeta(): Promise<ConversationMeta[]> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_META, "readonly");
    const all = await requestToPromise(tx.objectStore(STORE_META).getAll() as IDBRequest<ConversationMeta[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // 기록 하나. 없거나 읽을 수 없는(모르는 버전, 깨짐) 기록이면 null.
  async get(id: string): Promise<StoredConversation | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_CONVERSATIONS, "readonly");
    const raw = await requestToPromise(tx.objectStore(STORE_CONVERSATIONS).get(id));
    return upgradeRecord(raw);
  }

  async has(id: string): Promise<boolean> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_META, "readonly");
    return (await requestToPromise(tx.objectStore(STORE_META).getKey(id))) !== undefined;
  }

  async put(record: StoredConversation, options: { announce?: boolean } = {}): Promise<PutResult> {
    try {
      const db = await this.dbPromise;
      const size = JSON.stringify(record).length;
      const meta = deriveMeta(record, size);
      const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
      tx.objectStore(STORE_CONVERSATIONS).put(record);
      tx.objectStore(STORE_META).put(meta);
      await transactionDone(tx);
      if (options.announce !== false) this.announce();
      return { ok: true, meta };
    } catch (error) {
      return { ok: false, reason: isQuotaError(error) ? "quota" : "error" };
    }
  }

  async putMany(records: readonly StoredConversation[]): Promise<{ saved: number; failed: number }> {
    let saved = 0;
    let failed = 0;
    for (const record of records) {
      const result = await this.put(record, { announce: false });
      if (result.ok) saved += 1;
      else failed += 1;
    }
    if (saved > 0) this.announce();
    return { saved, failed };
  }

  // 제목을 직접 바꾼다 (이후 자동 제목으로 덮어쓰지 않는다).
  async rename(id: string, title: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    const result = await this.put({ ...record, title, titleAuto: false });
    return result.ok;
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
    tx.objectStore(STORE_CONVERSATIONS).delete(id);
    tx.objectStore(STORE_META).delete(id);
    await transactionDone(tx);
    this.announce();
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction([STORE_CONVERSATIONS, STORE_META], "readwrite");
    tx.objectStore(STORE_CONVERSATIONS).clear();
    tx.objectStore(STORE_META).clear();
    await transactionDone(tx);
    this.announce();
  }

  async stats(): Promise<{ count: number; bytes: number }> {
    const metas = await this.listMeta();
    return { count: metas.length, bytes: metas.reduce((sum, m) => sum + m.size, 0) };
  }

  // 전체 기록 (내보내기). 읽을 수 없는 기록은 건너뛰고 개수를 알린다.
  async getAll(): Promise<{ records: StoredConversation[]; skipped: number }> {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE_CONVERSATIONS, "readonly");
    const raws = await requestToPromise(tx.objectStore(STORE_CONVERSATIONS).getAll());
    const records: StoredConversation[] = [];
    let skipped = 0;
    for (const raw of raws) {
      const record = upgradeRecord(raw);
      if (record) records.push(record);
      else skipped += 1;
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return { records, skipped };
  }
}

let shared: ConversationStore | null = null;

// 브라우저의 공용 저장소. IndexedDB 가 없으면 null.
export function getConversationStore(): ConversationStore | null {
  if (typeof indexedDB === "undefined") return null;
  shared ??= new ConversationStore();
  return shared;
}

// 설정 화면의 "로컬 데이터"가 쓴다: 개수와 크기, 전부 지우기. 저장소를 열 수 없으면 null / false.
export async function conversationStats(): Promise<{ count: number; bytes: number } | null> {
  const store = getConversationStore();
  if (!store || !(await store.available())) return null;
  try {
    return await store.stats();
  } catch {
    return null;
  }
}

export async function clearConversations(): Promise<boolean> {
  const store = getConversationStore();
  if (!store || !(await store.available())) return false;
  try {
    await store.clear();
    return true;
  } catch {
    return false;
  }
}

// 테스트 전용
export function __resetSharedStoreForTests() {
  void shared?.close();
  shared = null;
}
