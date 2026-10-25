// IndexedDB 를 Promise 로 감싼 아주 작은 래퍼 (의존성 없음). 버전 있는 스키마와 단계별 마이그레이션만 책임진다.
//
// 마이그레이션: version 은 1부터 오르는 정수이고, 열 때 저장소의 현재 버전보다 높은 것만 순서대로 실행한다.
//   DB 의 목표 버전은 마이그레이션 중 가장 큰 version 이다. 예전 브라우저 DB 가 더 높은 버전이면 (앱을 되돌린 경우) 열기가 실패하고,
//   호출 쪽은 "저장소를 쓸 수 없음"으로 처리한다 (데이터를 건드리지 않는다).
// 이 함수는 결과를 담아 두지 않는다. 담아 두는 쪽은 실패한 Promise 를 버리고 다음 접근에서 다시 열어야 한다 (store.ts 참고).

export interface IdbMigration {
  version: number;
  migrate: (db: IDBDatabase, tx: IDBTransaction, oldVersion: number) => void;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openDatabase(
  name: string,
  migrations: readonly IdbMigration[],
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error("IndexedDB is not available"));
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const target = ordered.length > 0 ? ordered[ordered.length - 1]!.version : 1;
  return new Promise((resolve, reject) => {
    // 막힘(onblocked)으로 이미 거부한 뒤에 열기가 성공하면 그 연결은 아무도 쓰지 않으므로 닫는다 (다른 탭의 업그레이드를 막지 않게).
    let rejected = false;
    const fail = (error: unknown) => {
      rejected = true;
      reject(error);
    };
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, target);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      for (const m of ordered) {
        if (m.version > event.oldVersion) m.migrate(db, tx, event.oldVersion);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) {
        db.close();
        return;
      }
      // 다른 탭이 더 높은 버전으로 올리려 하면 연결을 닫아 막지 않는다.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => fail(new Error("IndexedDB open blocked by another tab"));
  });
}

export function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" || name === "QuotaExceeded";
}
