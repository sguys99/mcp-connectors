# NL2SQL 스키마 대응표: 카드 도메인 원본에서 Pagila로

> [update-plan.md](../update-plan.md)의 Phase 1-C 산출물입니다. NL2SQL Mock 백엔드를 카드 도메인 원본 테이블에서 PostgreSQL Pagila 샘플 스키마(public)로 교체하면서 만든 대응표입니다.
> 다음 단계에서 `docs/oracle-nl2sql-mcp-test-data/` 의 YAML 시나리오 280건을 치환할 때 이 표를 기준으로 삼습니다.

## 1. 기본 규칙

| 항목 | 규칙 |
|---|---|
| 스키마 owner | 원본의 모든 owner 이름(두 종류)을 `public` 으로 바꿉니다. Mock 응답의 `owner` 값도 `public` 입니다. |
| 식별자 대소문자 | Mock 카탈로그와 응답은 Pagila 원본처럼 소문자입니다. 입력 SQL은 대소문자를 구분하지 않으므로(가드레일과 Mock이 모두 대문자로 정규화해 비교합니다) 새 SQL은 소문자로 씁니다. |
| SQL 문법 | 서버 dialect 는 이번 단계에서 Oracle 그대로입니다(`DATE '2026-01-01'`, `FETCH FIRST n ROWS ONLY`, `SYSDATE`, `ADD_MONTHS`). 식별자만 Pagila로 바꾸고 문법은 건드리지 않습니다. dialect 어댑터는 Phase 2-D에서 다룹니다. |
| 오류 코드 | `WRITE_BLOCKED`, `PII_COLUMN_BLOCKED`, `MASS_SCAN_BLOCKED` 등은 그대로입니다. |
| Mock 카탈로그 | Pagila 테이블 15개, 뷰 7개, 구체화 뷰 1개(rental_by_category)로 모두 23개입니다. 원본은 22개였고, P2-4에서 실 샘플 DB 카탈로그와 맞추며 구체화 뷰를 더했습니다. 둘 다 기본 limit 20을 넘으므로 `search_tables_schema(pattern="%")` 의 `TOO_MANY_TABLES` 동작은 그대로입니다. |
| 행 수 | Mock `estimated_rows` 는 Pagila 3.x 실제 행 수입니다(rental 16044, payment 16049). 원본의 수백만 건 규모와는 다릅니다. |

## 2. 테이블 대응 (원본 22개 에서 Pagila)

여러 원본 테이블이 같은 Pagila 테이블로 모일 수 있습니다. Pagila가 원본보다 테이블 수가 적고 도메인이 달라 일대일 대응이 불가능하기 때문입니다.

| 원본 테이블 | 역할 | Pagila 테이블 | 대응 방식 |
|---|---|---|---|
| CUSTOMERS | 고객 마스터, PII 보유 | customer | 직접 |
| CARDS | 고객이 보유한 상품 인스턴스, 기간 보유 | rental | 근사 (고객이 재고 품목을 대여) |
| CARD_PRODUCTS | 상품 마스터, 가격 | film | 근사 (영화가 상품, rental_rate가 가격) |
| CARD_LIMITS | 상품에 딸린 대량 하위 테이블 | film_actor | 근사 (연결 테이블, 5462건) |
| CARD_LOANS | 금액, 시작일이 있는 거래 | payment | 근사 |
| AUTHORIZATIONS | 대량 거래 테이블, 금액과 일시 | payment | 근사 (날짜 가드레일의 주 대상) |
| CANCELLATIONS | 거래의 종료 이벤트 | rental | 근사 (return_date가 종료 시점) |
| MERCHANTS | 거래 상대방 | staff | 근사 (payment.staff_id로 직접 조인) |
| MERCHANT_CATEGORIES | 소형 코드 마스터 | category | 직접 |
| STATEMENTS | 고객별 기간 단위 청구 | rental | 근사 (return_date가 납부기한) |
| STATEMENT_ITEMS | 청구 하위 항목, 금액 | payment | 근사 (payment.rental_id로 rental과 조인) |
| PAYMENTS | 납부 내역, 금액과 일시 | payment | 직접 |
| CAMPAIGNS | 소형 마스터 | film | 근사 |
| CAMPAIGN_TARGETS | 마스터와 고객의 연결 | film_actor | 근사 |
| CREDIT_SCORES | 고객별 수치 이력 | payment | 근사 (SCORE를 amount로) |
| POINT_LEDGER | 날짜 컬럼 없는 대형 원장 | inventory | 근사 (날짜 없는 대형 테이블 특성 보존) |
| DELINQUENCIES | 해소일이 NULL 허용인 이력 | rental | 근사 (return_date NULL이 미해소) |
| ADDRESSES | 주소 | address | 직접 |
| INSTALLMENTS | 기간과 월 금액 | film | 근사 (rental_duration, rental_rate) |
| CASH_ADVANCES | 금액과 신청일시 | payment | 근사 |
| REWARDS_REDEMPTIONS | 고객별 사용 이력 | rental | 근사 |
| PRODUCT_BENEFITS | 상품 하위 속성 | film_category | 근사 |

Mock 카탈로그에만 있고 원본 대응이 없는 Pagila 테이블은 actor, city, country, language, store 와 뷰 7개(actor_info, customer_list, film_list, nicer_but_slower_film_list, sales_by_film_category, sales_by_store, staff_list), 구체화 뷰 rental_by_category 입니다. 처음에는 22개를 맞추려고 포함했고, 구체화 뷰는 P2-4에서 실 DB와 맞추려고 더했습니다.

## 3. 컬럼 대응

표기는 "원본 컬럼 → Pagila 컬럼" 입니다. "없음"은 대응 컬럼이 없다는 뜻이며, 오른쪽에 대체 규칙을 적었습니다. 컬럼 치환은 반드시 테이블과 함께 이루어져야 하므로(`ID`, `NAME`, `STATUS`, `AMOUNT` 같은 이름이 여러 테이블에 있습니다) 치환 스크립트는 FROM 절의 테이블을 먼저 바꾸고 그 테이블의 컬럼 표를 적용해야 합니다.

### CUSTOMERS → customer
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | customer_id | |
| CUSTOMER_NO | store_id | 비PII 정수 컬럼으로 대체 |
| NAME | address_id | 비PII 대체 컬럼. 자연어 "이름" 요청 시나리오는 first_name, last_name 을 쓰고 기대값을 PII 차단으로 바꿉니다 |
| EMAIL | email | PII |
| PHONE | address.phone | PII. 컬럼이 다른 테이블에 있으므로 FROM 을 address 로 바꾸거나 customer 와 address 를 조인합니다 |
| BIRTH_DATE | last_name | PII 차단 시나리오용 대체 |
| ANNUAL_INCOME | create_date | 비PII 시나리오용 대체 |
| OCCUPATION | activebool | 비PII 대체 |
| JOINED_AT | create_date | 날짜 컬럼 |
| STATUS | active | 값 대응은 4장 참고 |

### CARDS → rental
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | rental_id | |
| CUSTOMER_ID | customer_id | |
| PRODUCT_ID | inventory_id | film 으로 가려면 inventory 를 거칩니다 |
| CARD_NO_MASKED | 없음 | PII 차단 시나리오는 customer.email 조회로 바꿉니다 |
| ISSUED_AT | rental_date | 날짜 컬럼 |
| EXPIRES_AT | return_date | 날짜 컬럼, NULL 허용 |
| STATUS | 없음 | `return_date IS NULL`(진행 중), `IS NOT NULL`(종료)로 대체 |
| IS_PRIMARY | staff_id | 구분용 정수 대체 |

### CARD_PRODUCTS → film
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | film_id | |
| NAME, PRODUCT_NAME | title | |
| PRODUCT_CODE | rating | 코드 문자열 |
| IS_ACTIVE | language_id | `IS_ACTIVE = 1` 은 `language_id = 1` |
| ANNUAL_FEE | rental_rate | 가격 |

### CARD_LIMITS → film_actor
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | 없음 | 복합 PK 이므로 film_id 로 대체 |
| CARD_ID | film_id | |
| LIMIT_TYPE | actor_id | 구분용 정수 |
| AMOUNT | 없음 | 금액 시나리오는 payment.amount 로 옮깁니다 |

### CARD_LOANS → payment
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | payment_id | |
| CARD_ID | rental_id | |
| PRINCIPAL | amount | |
| INTEREST_RATE | 없음 | staff_id 로 대체 |
| STARTED_AT | payment_date | 날짜 컬럼 |

### AUTHORIZATIONS → payment
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | payment_id | |
| CARD_ID | rental_id | FK 의미를 보존합니다 |
| CUSTOMER_ID | customer_id | 일부 시나리오에서만 쓰입니다 |
| MERCHANT_ID | staff_id | |
| AMOUNT | amount | |
| APPROVED_AT | payment_date | 날짜 컬럼 |
| STATUS | 없음 | 조건을 삭제하거나 `staff_id = 1` 같은 구분 조건으로 대체 |

### CANCELLATIONS → rental
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | rental_id | |
| AUTHORIZATION_ID | inventory_id | 정수 대체. 결제와 조인이 필요하면 `payment.rental_id = rental.rental_id` |
| AMOUNT | 없음 | payment.amount 를 조인해서 사용 |
| CANCELLED_AT, CANCELED_AT | return_date | 날짜 컬럼 |

### MERCHANTS → staff
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | staff_id | |
| NAME | username | 비PII 문자열 (first_name, last_name 은 PII) |
| CATEGORY_ID | store_id | category 와 직접 조인되지 않으므로 업종 조인 시나리오는 재작성합니다 |
| BUSINESS_NO | address_id | 정수 대체 |

### MERCHANT_CATEGORIES → category
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | category_id | |
| NAME | name | |
| CODE | 없음 | name 으로 대체 |

### STATEMENTS → rental
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | rental_id | |
| CUSTOMER_ID | customer_id | |
| BILLING_MONTH | rental_date | 월 단위 필터는 `TO_CHAR(rental_date, 'YYYYMM')` |
| DUE_DATE | return_date | 날짜 컬럼 |
| TOTAL_AMOUNT | 없음 | payment.amount 를 조인해서 사용 |
| GENERATED_AT | rental_date | |

### STATEMENT_ITEMS → payment
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | payment_id | |
| STATEMENT_ID | rental_id | |
| AUTHORIZATION_ID | customer_id | 정수 대체 |
| AMOUNT | amount | |

### PAYMENTS → payment
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | payment_id | |
| STATEMENT_ID | rental_id | |
| CUSTOMER_ID | customer_id | |
| AMOUNT | amount | |
| PAID_AT | payment_date | 날짜 컬럼 |

### CAMPAIGNS → film
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | film_id | |
| NAME | title | |
| CHANNEL | rating | 코드 문자열 |
| STARTS_AT, ENDS_AT | 없음 | film 에는 날짜 컬럼이 없습니다. 기간 시나리오는 rental_date 또는 payment_date 로 옮깁니다 |
| BUDGET | replacement_cost | |

### CAMPAIGN_TARGETS → film_actor
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | 없음 | film_id 로 대체 |
| CAMPAIGN_ID | film_id | |
| CUSTOMER_ID | actor_id | |

### CREDIT_SCORES → payment
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | payment_id | |
| CUSTOMER_ID | customer_id | |
| BUREAU | staff_id | 구분용 정수 |
| SCORE | amount | 수치 컬럼 |
| GRADE | 없음 | rental_id 로 대체 |
| EVALUATED_AT | payment_date | 날짜 컬럼 |

### POINT_LEDGER → inventory
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | inventory_id | |
| CUSTOMER_ID | store_id | |
| AUTHORIZATION_ID | film_id | |
| EVENT_TYPE, POINTS, BALANCE_AFTER | 없음 | 집계 시나리오는 COUNT(*) 로 단순화합니다 |

### DELINQUENCIES → rental
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | rental_id | |
| CUSTOMER_ID | customer_id | |
| STATEMENT_ID | inventory_id | 정수 대체 |
| OVERDUE_AMOUNT | 없음 | payment.amount 를 조인해서 사용 |
| OVERDUE_DAYS | 없음 | film.rental_duration 으로 대체 |
| OCCURRED_AT | rental_date | 날짜 컬럼 |
| RESOLVED_AT | return_date | NULL 이 미해소(미반납)에 대응합니다 |

### ADDRESSES → address
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | address_id | |
| CUSTOMER_ID | 없음 | Pagila 는 customer.address_id 가 주소를 가리킵니다. 조인 방향이 반대입니다 |
| ADDRESS_TYPE, SIDO | district | |
| CITY | city_id | 도시명은 city.city 조인 |
| POSTAL_CODE | postal_code | |

### INSTALLMENTS → film
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | film_id | |
| AUTHORIZATION_ID | language_id | 정수 대체 |
| INSTALLMENT_COUNT | rental_duration | |
| MONTHLY_AMOUNT | rental_rate | |

### CASH_ADVANCES → payment
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | payment_id | |
| CARD_ID | rental_id | |
| AMOUNT | amount | |
| REQUESTED_AT | payment_date | 날짜 컬럼 |

### REWARDS_REDEMPTIONS → rental
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | rental_id | |
| CUSTOMER_ID | customer_id | |
| POINTS_USED | inventory_id | 정수 대체 |
| REDEEMED_AT | rental_date | 날짜 컬럼 |

### PRODUCT_BENEFITS → film_category
| 원본 | Pagila | 비고 |
|---|---|---|
| ID | 없음 | film_id 로 대체 |
| PRODUCT_ID | film_id | |
| BENEFIT_TYPE | category_id | |
| DESCRIPTION | 없음 | film.description 을 조인해서 사용 |

### 시나리오에만 나오는 기타 컬럼

| 원본 | Pagila |
|---|---|
| MCC_CODE | category_id |
| REASON | 없음 (조건 삭제 또는 title 로 대체) |

## 4. 값, 조건 대응

| 원본 | Pagila |
|---|---|
| `STATUS = 'ACTIVE'` (고객) | `active = 1` |
| `STATUS = 'INACTIVE'` 또는 `'DORMANT'` (고객) | `active = 0` |
| 거래 STATUS (`APPROVED`, `CANCELLED` 등) | 대응 없음. 조건 삭제 또는 `staff_id` 구분 조건 |
| 카드 STATUS (`ACTIVE`) | rental 에서 `return_date IS NULL` |
| 기준일 `2026-06-18` 부근 날짜 리터럴 | 그대로 둡니다. 가드레일은 리터럴 간격만 계산하고 Mock 은 날짜 조건을 평가하지 않습니다 |
| 원본 스키마 owner 접두사 (두 종류) | `public.` |
| 서버명, 포트, `base_url` | 변경 없음 (Phase 2-D 몫) |

조인 조건은 의미가 바뀌는 곳이 있습니다. 예를 들어 원본의 `CUSTOMERS C JOIN AUTHORIZATIONS A ON C.ID = A.CARD_ID` 는 Pagila에서 `customer c JOIN payment p ON c.customer_id = p.customer_id` 로 씁니다. 기계 치환만 하면 `c.customer_id = p.rental_id` 가 되어 의미가 틀어지므로 이런 JOIN 은 수동으로 확인해 주세요.

## 5. 가드레일 특성이 Pagila에서 재현되는지

| 가드레일 테스트가 필요로 하는 특성 | Pagila 재현 | 근거 |
|---|---|---|
| PII 컬럼 직접 SELECT 차단 | 재현됨 | 테이블 인지형 카탈로그(`nl2sql_mcp/pii_catalog.py`)의 block 컬럼. customer.email/first_name/last_name, address.address/address2/phone, staff.email/password/picture 와 이를 결합한 뷰 컬럼입니다 (P2-5) |
| PII 컬럼 마스킹 조회 | 재현됨 | 카탈로그의 mask 컬럼(staff.first_name/last_name/username, address.postal_code, 뷰의 zip code, sales_by_store.manager)은 조회되고 값이 `M***` 처럼 가려집니다 |
| 비PII 컬럼 통과 | 재현됨 | customer_id, store_id, active, create_date 등 |
| WHERE 절의 PII 컬럼은 통과 | 재현됨 | 가드레일이 SELECT 절만 검사합니다 |
| 출력 단계 PII 값 마스킹 | 부분 재현 | Pagila에는 카드번호, 주민번호 컬럼이 없습니다. 값 패턴 마스킹은 정규식 기반이라 단위 테스트의 문자열 입력으로 검증하고, 전화번호(하이픈 없는 11자리)는 실제 Pagila 값 형식으로 검증합니다 |
| 날짜 컬럼 감지(`_AT`, `_DT`, `_DATE`, `_TIME` 접미사) | 재현됨 | rental_date, return_date, payment_date, create_date. `last_update` 는 접미사에 해당하지 않아 감지되지 않습니다 |
| 12개월 초과 차단, 기간 자동 주입 | 재현됨 | rental, payment 로 검증 |
| 날짜 컬럼 없는 대형 테이블 | 재현됨 | inventory (4581건), film_actor (5462건) |
| 대형 거래 테이블 | 재현됨 | rental 16044건, payment 16049건 (원본보다 규모는 작음) |
| 다수 테이블 조인 | 재현됨 | customer, rental, inventory, film, film_category, category 로 5회 조인 |
| 카티시안 조인 | 재현됨 | 어떤 두 테이블이든 가능 |
| NULL 허용 날짜 컬럼 | 재현됨 | rental.return_date |
| 소형 코드 마스터 | 재현됨 | category (16건), language (6건) |
| `TOO_MANY_TABLES` (`%` 검색) | 재현됨 | 23개 (테이블 15, 뷰 7, 구체화 뷰 1) 가 기본 limit 20 초과 |
| `TOO_MANY_COLUMNS` (`%` 검색) | 재현됨 | 전체 컬럼 수가 기본 limit 50 초과 |
| 날짜 컬럼이 있는 소형 마스터 | 재현 불가 | CAMPAIGNS 처럼 날짜가 있는 소형 테이블이 Pagila에 없습니다. 해당 시나리오는 rental/payment 로 옮깁니다 |

## 6. Mock 이 응답하는 SQL 패턴

`MockOracleBackend.execute_query` 는 가드레일을 통과한 SQL을 대문자로 정규화한 뒤 아래 순서로 분기합니다. 테이블은 FROM 절의 첫 테이블만 봅니다.

1. `COUNT(*)` 가 있고 `GROUP BY` 가 없으면 한 행짜리 집계를 반환합니다. 값은 `ROWNUM <= N` 또는 `FETCH FIRST N ROWS` 의 N, 없으면 해당 테이블 `estimated_rows` 와 `max_rows` 중 작은 값, 알 수 없는 테이블이면 42 입니다.
2. `GROUP BY` 가 있으면 SELECT 절 컬럼 이름으로 합성 행 3개를 반환합니다 (`VAL_1`, `VAL_2`, ...).
3. 샘플이 있는 테이블의 일반 SELECT 는 샘플 행을 반환하고 SELECT 절의 컬럼으로 필터링합니다. 샘플이 있는 테이블은 customer, film, category, language, film_category, inventory, rental, payment, store, actor, staff, address, city, country 입니다.
4. 그 밖의 테이블은 빈 결과를 반환합니다. 예를 들어 film_actor, 뷰 7개가 해당합니다.

샘플 행에는 block 컬럼을 넣지 않았습니다. 가드레일이 SELECT 단계에서 막기 때문입니다. mask 컬럼(staff 이름과 username)은 원본 값을 넣어 두고 도구가 결과에서 가려요.

## 7. 주의점

- **PII 판정은 `(테이블, 컬럼)` 기준**입니다(P2-5). 같은 `first_name` 이라도 customer 는 차단, staff 는 마스킹, actor 는 그대로 조회됩니다. 별칭, JOIN, 서브쿼리, CTE 를 따라가 테이블을 풉니다.
- **customer 에는 phone 컬럼이 없습니다.** 원본의 `CUSTOMERS.PHONE` 시나리오는 address 테이블이나 customer 와 address 의 조인으로 다시 써야 합니다.
- **`SELECT *` 는 펼쳐지는 컬럼에 block 컬럼이 있을 때만 차단**됩니다. film 같은 테이블의 `SELECT *` 는 통과해요(P2-5 이전에는 항상 차단).
- **날짜 자동 주입은 대문자 컬럼명을 만듭니다.** 예: `RENTAL_DATE >= ADD_MONTHS(SYSDATE, -3)`. Oracle과 PostgreSQL 모두 따옴표 없는 식별자는 대소문자를 구분하지 않으므로 문제가 없지만, 결과 SQL 문자열을 비교하는 시나리오는 대소문자에 유의해야 합니다.
- **GROUP BY 합성 결과의 컬럼 이름은 소문자**입니다. `COUNT(*)` 단독 집계의 컬럼 이름은 기존대로 `COUNT(*)` 입니다.
- **Pagila 샘플 데이터의 날짜는 버전에 따라 다릅니다.** Mock 샘플은 2005년 날짜를 쓰며 어떤 날짜 조건도 평가하지 않습니다. 실 DB 통합(Phase 2)에서 실제 기간을 확인해야 합니다.
- **dialect 는 Oracle 그대로**입니다. Pagila 소문자 테이블을 Oracle 문법으로 질의하는 형태이며, 이는 Mock 전용 구성입니다.
