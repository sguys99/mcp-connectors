# 역사 문서 (History)

> MVP(v0.1)를 만들 때 쓴 설계 기록입니다. 지금 코드와 다를 수 있으니 참고용으로만 읽어 주세요.
> 현재 기준은 코드와 [docs/update-plan.md](../update-plan.md)이며, 내용이 충돌하면 그쪽을 따릅니다.

공개 저장소에 맞게 개인 정보, 로컬 경로, 사내 고유명사는 일반 명칭으로 바꿨습니다. 구조와 의미는 원문 그대로 두었습니다.

| 문서 | 내용 |
|---|---|
| [PRD.md](PRD.md) | MVP 요구사항 정의서. 기능 목록(F-1~F-8), 디렉터리 구조, 서버 레지스트리, Chat 시스템 프롬프트, 인수 기준을 담고 있습니다. |
| [task-plan.md](task-plan.md) | PRD를 기능 의존성 순서로 나눈 Phase별 실행 계획과 각 단계의 완료 기록입니다. |
| [meta-prompt.md](meta-prompt.md) | PRD를 생성할 때 Claude Code에 넣은 메타 프롬프트입니다. |
| [nl2sql-mcp-plan.md](nl2sql-mcp-plan.md) | NL2SQL MCP 서버를 Oracle 전용으로 만들던 MVP 시기의 개발 계획입니다. 지금 구조는 [서버 README](../../src/mcp-servers/nl2sql_mcp/README.md)를 보세요. |
