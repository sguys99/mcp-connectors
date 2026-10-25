// 도구별 예시 입력. 지금은 nl2sql-mcp 의 run_sql_query 가드레일 4종만 있다.
//
// 날짜는 샘플 DB(Pagila)의 실제 데이터 기간에 맞췄다. rental 은 2022-02 ~ 2022-08 이라 7월 조회가 결과를 돌려준다.
// 아래 SQL 은 모두 Mock 백엔드로 실행해 확인한 결과(차단 코드 또는 정상)와 일치한다.
//   blocked  rental 은 약 16,000 행이라 WHERE 없는 조회는 MASS_SCAN_BLOCKED
//   top      날짜 하한과 상한을 모두 준 정상 조회
//   pii      customer.email 은 SELECT 목록에 둘 수 없다 (PII_COLUMN_BLOCKED)
//   write    SELECT 가 아닌 문장은 WRITE_BLOCKED

import type { TKey } from "@/lib/i18n/translate";

export type ExampleTone = "ok" | "blocked";

export interface SqlExample {
  id: "blocked" | "top" | "pii" | "write";
  labelKey: TKey;
  tone: ExampleTone;
  sql: string;
}

export const SQL_EXAMPLES: readonly SqlExample[] = [
  {
    id: "blocked",
    labelKey: "inspector.exBlocked",
    tone: "blocked",
    sql: "SELECT rental_id, rental_date, customer_id\nFROM rental\nORDER BY rental_date DESC",
  },
  {
    id: "top",
    labelKey: "inspector.exTop",
    tone: "ok",
    sql: [
      "SELECT f.title, COUNT(*) AS rentals",
      "FROM rental r",
      "JOIN inventory i ON i.inventory_id = r.inventory_id",
      "JOIN film f ON f.film_id = i.film_id",
      "WHERE r.rental_date >= '2022-07-01'",
      "  AND r.rental_date < '2022-08-01'",
      "GROUP BY f.title",
      "ORDER BY rentals DESC, f.title",
      "LIMIT 5",
    ].join("\n"),
  },
  {
    id: "pii",
    labelKey: "inspector.exPii",
    tone: "blocked",
    sql: "SELECT customer_id, email\nFROM customer\nWHERE store_id = 1",
  },
  {
    id: "write",
    labelKey: "inspector.exWrite",
    tone: "blocked",
    sql: "DELETE FROM rental\nWHERE rental_date < '2022-03-01'",
  },
];

// 예시 칩을 보일 (도구, 필드). run_sql_query 의 sql 입력칸에만 붙는다.
export function examplesFor(toolName: string, fieldName: string): readonly SqlExample[] {
  return toolName === "run_sql_query" && fieldName === "sql" ? SQL_EXAMPLES : [];
}
