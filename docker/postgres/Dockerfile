# NL2SQL 샘플 DB: PostgreSQL 17 + Pagila (스키마와 데이터는 빌드 때 upstream 고정 커밋에서 받습니다)
#
# Pagila SQL(약 3.4MB)을 저장소에 넣지 않으려고 빌드 시점에 내려받고 sha256 으로 검증합니다.
# 커밋이나 체크섬을 바꾸면 빌드가 실패하니, 갱신할 때는 세 값을 함께 고칩니다.
#   upstream: https://github.com/devrimgunduz/pagila (PostgreSQL License, NOTICE 참고)
#
# 5ba5a57 을 고른 이유: 이후 커밋(2026-07~)은 pgvector 확장과 PostgreSQL 18 이상을 요구하고
# 샘플 데이터도 바뀌어, Mock 백엔드와 시나리오가 기준으로 삼은 Pagila 3.x 와 달라집니다.
FROM postgres:17.10-alpine

ARG PAGILA_COMMIT=5ba5a57aeb159f75f02aca2432d3c262186d13d3

# initdb.d 는 파일 이름 순서로 실행됩니다 (postgres 이미지 규칙, 볼륨이 비어 있을 때 한 번만)
ADD --chmod=644 \
    --checksum=sha256:8ce358e4c8014087b85296694a0893887bd7a4190e3ce407f2721b86b98e5707 \
    https://raw.githubusercontent.com/devrimgunduz/pagila/${PAGILA_COMMIT}/pagila-schema.sql \
    /docker-entrypoint-initdb.d/01-pagila-schema.sql
ADD --chmod=644 \
    --checksum=sha256:880580fb2cd4daaa99f290ced264988cdd657b3158be63cd281466f796f6dbf2 \
    https://raw.githubusercontent.com/devrimgunduz/pagila/${PAGILA_COMMIT}/pagila-data.sql \
    /docker-entrypoint-initdb.d/02-pagila-data.sql

# 03: 테이블/컬럼 코멘트와 구체화 뷰 갱신, 04: 읽기 전용 계정
COPY --chmod=755 initdb/ /docker-entrypoint-initdb.d/
