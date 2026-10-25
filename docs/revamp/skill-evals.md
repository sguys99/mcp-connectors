# 스킬 evals 결과 (P5-9)

> 작성: 2026-10-23, Phase 5 묶음 P5-9. 대상은 `.claude/skills/mcp-spec-writer`와 `.claude/skills/mcp-server-builder`입니다.

## 1. 실행 방법

저장소에 eval 러너 스크립트가 없어서, eval마다 새 subagent 하나가 처음 받은 요청처럼 `SKILL.md`를 읽고 그대로 따르게 했습니다. 비대화형이라 AskUserQuestion은 "물었을 질문 묶음"을 보고서에 적고 스킬이 정한 기본값으로 진행하게 했어요.

- 작업 위치: 세션 scratchpad의 `p5-9-evals/<eval>/`. 저장소 루트의 `pyproject.toml`, `Makefile`, `configs/`, `scripts/`, `src/mcp-servers/`(`_common`과 기존 서버 3종), `docs/scenario-format.md`를 복사한 사본이며, 저장소 `src/`에는 아무것도 쓰지 않았습니다.
- builder 채점: 생성 코드에 저장소 `.venv`로 `ruff check`, `ruff format --check`, `pytest tests/<snake>`, `scripts/mcp_cli.py test tests/scenarios/<kebab>.yaml`(실제 stdio 서버 기동)을 직접 돌렸습니다. 그 밖에 `evals.json`의 `shared_assertions` 16개(파일 배치, `tests/<snake>/__init__.py` 없음, `_common` 무변경, `from _common` import, 순환 import 없음, HTTP 분기 `build_http_middleware`, `--transport stdio|http`, `env_files(__file__)`, `[CODE]` 태그, LLM 노출 문자열의 한글 유무(AST 검사), 레지스트리 항목, Makefile 타깃, `known-first-party`)를 스크립트로 확인했습니다.
- spec 채점: 헤딩, 포함 문자열, 정규식, 한글 비율, em dash와 가운뎃점 부재를 스크립트로 보고, rubric 항목은 정의서를 읽어 판정했습니다.
- 모델: eval 실행 subagent는 Sonnet입니다.

## 2. 수정 전 기준선 (before)

수정 전 스킬 사본으로 builder eval 2(sales-dw)를 한 번 돌렸습니다.

| 항목 | 결과 |
|---|---|
| shared_assertions | **2/16** |
| pytest | 수집 단계 실패. 스킬이 만들라고 한 `tests/sales_dw_mcp/__init__.py`가 `src/mcp-servers/sales_dw_mcp`와 이름이 겹쳐 `ModuleNotFoundError: No module named 'sales_dw_mcp.client'` |
| ruff | I001 2건 (`known-first-party` 안내 없음) |
| import | `from mcp_servers._common...` (존재하지 않는 경로), `config.py`만 `from _common.env` |
| 구조 | `tools.py`가 `server.py`의 `mcp`를 import하고 `server.py`가 다시 `tools`를 import하는 순환, `# noqa: E402` |
| 누락 | `state.py`, HTTP 미들웨어 연결, `--transport` 인자, 레지스트리 항목, 시나리오 YAML |
| 언어 | 도구 docstring과 에러 메시지가 한국어, `[CODE]` 태그 없음 |
| Makefile | `run-sales_dw_mcp` (기존 타깃은 kebab-case) |

즉 수정 전 스킬을 그대로 따르면 테스트가 한 건도 실행되지 않는 서버가 나왔습니다.

## 3. 결과 요약 (after)

| Eval | 이름 | 1차 실행 | 수정 후 재실행 | 비고 |
|---|---|---|---|---|
| builder 1 | code-repo-3tools-reference-spec | 15/16 (시나리오 YAML 파싱 오류) | **16/16**, pytest 37, 시나리오 6/6 | 3도구, TODO 8개 |
| builder 2 | sales-dw-3tools-small-spec | 15/16 (E501 4건) | **16/16**, pytest 25, 시나리오 8/8 | 기본 transport stdio, Bearer, `mask_pii` |
| builder 3 | incomplete-spec-triggers-askuserquestion | **16/16**, pytest 20, 시나리오 5/5 | (재실행 불필요) | 질문 4개를 우선순위대로 한 묶음, TODO 7개 |
| builder 4 | multi-backend-spec | 15/16 (E501 2건), Oracle extra 안내 누락 | **16/16**, pytest 21, 시나리오 4/4 | `state.db`/`state.api`, README에 `uv sync --extra oracle` |
| builder 5 (신규) | english-spec-input | **16/16**, pytest 22, 시나리오 5/5 | (재실행 불필요) | 영어 헤딩 수용, LLM Description 원문 그대로, `X-API-Key`, timeout 3초, `Literal["table", "dashboard"]` |
| spec 1 | code-repo-mcp | 7/8 (한글 비율 0.262, Tool 9개) | **8/8** + rubric 통과, 한글 0.427, Tool 6개 | |
| spec 2 | oracle-db-mcp | **7/7** + rubric 통과 | | 마스킹, Read-only 계정 명시 |
| spec 3 | snowflake-dw-mcp | **6/6** + rubric 통과 | | `run_query` row limit, timeout, 비용 가드 |
| spec 4 (신규) | english-request-ticket-mcp | **6/6** + rubric 통과 | | 영어 요청 감지, 영어 헤딩 15개 일치, 한글 0%, `**TBD`, `untrusted_content` |
| spec 5 (신규) | korean-request-english-option | **2/2** + rubric 통과 | | "영어로" 명시가 요청 언어보다 우선, 한글 0% |

최종: builder 5/5, spec 5/5 통과. builder는 다섯 건 모두 ruff 0건, pytest 전부 통과, 범용 시나리오 러너 `Result: OK`입니다.

## 4. 실패에서 고친 것

| 발견 (eval) | 원인 | 스킬 수정 |
|---|---|---|
| 시나리오 YAML 파싱 오류로 파일 전체 미실행 (builder 1) | 한 줄 표기 `{field: repositories[0].id, ...}`의 `[` | `server_skeleton.md` 파일 9와 SKILL Phase 5에 "`[`가 든 경로는 반드시 따옴표" 명시 |
| E501 (builder 2, 4) | `ruff format`은 긴 문자열과 주석을 줄이지 않는데 스킬은 `ruff format`만 자동 실행 | Phase 5를 자동 실행으로 바꿈: `ruff format`, `ruff check` 0건, `make test-<kebab>`, `make test-scenarios-<kebab>`까지 통과한 상태로 마침 (`uv add`가 필요 없어져 수동 안내 이유가 사라짐) |
| Oracle 드라이버 안내 누락 (builder 4) | 안내 위치가 모호 | README 실행 절과 생성 요약 둘 다에 `uv sync --extra oracle`, 드라이버는 지연 import |
| 한국어 정의서에 영어 LLM Description (spec 1) | "한국어로 써도 된다"는 허용 표현이 모호 | 정의서 언어로 쓰고 빌더가 영어로 옮긴다고 명확히, 섞지 않음 |
| Tool 9개 (spec 1) | Tool 개수 기준 없음 | PoC는 3~6개 권장, 나머지는 제외 범위(다음 단계)로 |
| 5.1 표 칼럼 불일치 (spec 2, 3) | 템플릿 예시는 `Read/Write`, 모범 예시와 스킬은 Hint 3칼럼 | 템플릿 예시를 Hint 3칼럼으로 통일, "사람용 설명"도 "설명"으로 |
| 검색 Tool idempotent 기준 충돌 (spec 4) | 기본값 표 "모두 read-only"와 `fastmcp_patterns.md §2` | 표 아래에 "비결정적 검색은 `idempotent: false`" 주석 |
| 평평한 출력 예시와 `wrap_untrusted` 충돌 (builder 2, 3, 4) | 언제 감싸는지 기준 없음 | 자유 텍스트가 있으면 그 필드만 `untrusted_content`로 옮기고 README에 모양 변경을 적음, 구조 값만 있으면 스펙 모양 유지, `mask_pii`는 문자열에만 |
| env 키 이름과 인증 헤더 (builder 2, 5) | 템플릿 `_backend_token`과 스펙 §6.2 키 이름 충돌 | 스펙이 정한 키 이름과 헤더가 우선, 확정 URL은 기본값이 아니라 `.env.example`과 README 예시로 |
| 무응답 처리 충돌 (builder 3) | `question_bank.md` "마커 남기지 않음"과 SKILL "TODO" | 무응답과 비대화형 모두 기본값 + TODO 마커로 통일 |

## 5. `_common` 설명과 실제 코드의 차이 (수정 전)

| 항목 | 수정 전 스킬 | 실제 코드 (정본) |
|---|---|---|
| 모듈 수 | 계획서에 "7개 모듈", 스킬 본문은 목록이 섞여 있음 | **8개** (auth, cors, env, errors, logging, masking, retry, trust) + `__init__.py` |
| import 경로 | 템플릿 다수가 `from mcp_servers._common...` | `from _common.<module> import ...` |
| 생성 여부 | "없으면 1회 생성" | 이미 있으므로 import만. `common_module.md` 코드 블록을 실제 파일에서 다시 만들어 글자 단위로 일치시킴 |
| 로그 출력 | stdout | **stderr** (stdio transport가 stdout을 JSON-RPC에 씀) |
| 401 본문 | 한국어 | 영어 (`Authentication failed: ...`, P4-4a) |
| 미들웨어 | 도구 안 검사 또는 설명만 | HTTP 분기에서만 `build_http_middleware(settings.mcp_api_key)`, `[CORS, Auth]` 순서 |
| 도구 등록 | `@mcp.tool` 데코레이터 + 순환 import | 평범한 함수 + `mcp.tool(fn, annotations=...)` (`register_tools`), `state.py` |
| transport | `settings.transport`, SSE 분기, `/health` 라우트 | `--transport stdio|http` 인자, `/health` 없음 |
| config | `env_prefix`, `use_mock_backend` | 접두사 없는 필드(`<snake>_port`), URL이 비면 Mock |
| 테스트 | `tests/<snake>/__init__.py` 생성 | 만들지 않음 (importlib 모드) |
| pytest 설정 | `pythonpath`만 안내 | `pythonpath`, `--import-mode=importlib`, `asyncio_mode = "auto"` 모두 이미 설정됨 |
| ruff | 언급 없음 | `known-first-party`에 새 패키지 추가 필요 (I001) |
| Makefile | `run-<snake_name>` | `run-<kebab>`, `test-<kebab>`, `test-scenarios-<kebab>`, `.PHONY` |
| 레지스트리 | 언급 없음 | `configs/mcp_servers.yaml`에 stdio와 `-http` 항목, `description`/`description_ko`, 필요할 때만 `internalUrl`, `headers` |
| 의존성 | `uv add fastmcp httpx ...` | 모두 이미 있음. 새 드라이버만 안내 |
| Phase 5 기능 | 없음 | 시나리오 YAML(`mcp_cli.py test`, `docs/scenario-format.md`), Resources/Prompts 정본 `starter_mcp/primitives.py` |
| LLM 노출 언어 | 스펙 그대로(한국어) | 영어 (P4-4a 결정). 주석과 로그는 한국어 허용 |

수정한 템플릿은 코드 블록을 그대로 풀어 만든 서버로 `ruff check`, `ruff format --check`, pytest 13건을 통과하는 것을 확인했습니다 (FastMCP 3.3.1).

## 6. 비식별화와 표기

- 1-C 치환 목록 기준 grep(회사명, 시스템명, 내부 도메인, 개인 정보, `사내`, 카드 도메인 잔재)은 두 스킬과 evals, fixtures에서 0건입니다. 남아 있던 카드 도메인 예시(`card_core`, `card_%`)는 `billing_%` 등으로 바꿨어요.
- 두 스킬의 em dash와 가운뎃점은 모두 걷어냈습니다. 남은 것은 작성 규칙을 설명하는 두 줄과, 실제 `_common/cors.py` 독스트링을 글자 그대로 옮긴 `common_module.md`의 3건(정본 코드라 고치지 않음)입니다.

## 7. 남은 일

- 대화형 경로(AskUserQuestion 실제 응답, 기존 폴더 덮어쓰기 분기)는 이번 비대화형 실행으로 검증하지 못했습니다. 실제 사용자 세션에서 한 번 확인이 필요합니다.
- 스킬 트리거 정확도(영어, 한국어 문장으로 실제로 스킬이 호출되는지)는 description만 이중 언어로 바꿨고 측정하지 않았습니다.
- 영어 모범 예시 문서(`example_code_repo.md`의 영어판)는 만들지 않았습니다. 영어 정의서도 한국어 예시의 디테일을 참고하도록 안내만 했어요.
- 비대화형 실행에서 정의서 파일이 이미 있을 때의 처리(덮어쓰기 대신 새 버전 이름)는 규칙이 없습니다.
