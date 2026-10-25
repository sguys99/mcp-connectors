#!/bin/sh
# NL2SQL 읽기 전용 계정 생성 (postgres 이미지 initdb 단계에서 superuser 로 한 번만 실행)
#
# 계정 이름과 비밀번호는 compose 가 넘기는 NL2SQL_PG_USER, NL2SQL_PG_PASSWORD 를 씁니다.
# 서버(.env)와 같은 변수라 값을 한 곳에서만 바꾸면 됩니다.
#
# 권한 경계
#   - LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS
#   - 데이터베이스 CONNECT, public 스키마 USAGE, public 의 테이블/뷰/시퀀스 SELECT
#   - 앞으로 superuser 가 만드는 public 객체에도 SELECT (ALTER DEFAULT PRIVILEGES)
#   - public 스키마 CREATE 회수 (Pagila 스키마가 GRANT ALL ON SCHEMA public TO PUBLIC 을 하므로)
#   - 데이터베이스 TEMP 회수, 다른 데이터베이스(postgres, template1) CONNECT 회수
#   - 세션 기본값: default_transaction_read_only=on, statement_timeout=30s
#     (커넥터도 접속 옵션으로 같은 값을 걸지만, 다른 클라이언트로 접속해도 읽기 전용이 되도록 이중으로 둡니다)
set -eu

: "${NL2SQL_PG_USER:=nl2sql_ro}"
if [ -z "${NL2SQL_PG_PASSWORD:-}" ]; then
    echo "nl2sql: NL2SQL_PG_PASSWORD 가 비어 있어 읽기 전용 계정을 만들 수 없습니다" >&2
    exit 1
fi
: "${NL2SQL_PG_STATEMENT_TIMEOUT:=30s}"

psql -v ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=ro_user="$NL2SQL_PG_USER" \
    --set=ro_pw="$NL2SQL_PG_PASSWORD" \
    --set=ro_timeout="$NL2SQL_PG_STATEMENT_TIMEOUT" \
    --set=db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"ro_user" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD :'ro_pw';

ALTER ROLE :"ro_user" SET default_transaction_read_only = on;
ALTER ROLE :"ro_user" SET statement_timeout = :'ro_timeout';
ALTER ROLE :"ro_user" SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE :"ro_user" SET search_path = public;

-- 데이터베이스: 샘플 DB 접속만 허용
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"ro_user";
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;

-- 스키마: 객체 생성 금지, 조회만
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"ro_user";

-- 객체: SELECT 만 (시퀀스는 currval 류 조회용 SELECT)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"ro_user";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO :"ro_user";
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT SELECT ON TABLES TO :"ro_user";
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO :"ro_user";
SQL

echo "nl2sql: 읽기 전용 계정 '${NL2SQL_PG_USER}' 생성 완료"
