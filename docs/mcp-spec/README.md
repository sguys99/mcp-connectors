# MCP 서버 정의서

> `/mcp-spec-writer` 스킬이 만든 MCP 서버 요구사항 정의서를 모아 두는 곳입니다.

## 정의서 템플릿과 예시의 정본

템플릿과 모범 예시는 스킬 안에 하나만 둡니다. 이 폴더에 사본을 두지 마세요.

| 용도 | 정본 위치 |
|---|---|
| 10섹션 정의서 템플릿 | [.claude/skills/mcp-spec-writer/references/template_v2.md](../../.claude/skills/mcp-spec-writer/references/template_v2.md) |
| 완성된 모범 예시 (`code-repo-mcp`) | [.claude/skills/mcp-spec-writer/references/example_code_repo.md](../../.claude/skills/mcp-spec-writer/references/example_code_repo.md) |

## 파일 규칙

- 파일명은 `<server-name>_v0.X.md` 형식입니다. 서버명은 kebab-case를 씁니다.
- 새 버전이 나오면 이전 버전 파일은 삭제하고 변경 이력은 git으로 추적합니다.
