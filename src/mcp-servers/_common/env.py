"""서버 설정용 `.env` 파일 경로 해석.

pydantic-settings 의 ``env_file=".env"`` 는 실행 디렉터리(CWD) 기준이라, IDE 의 stdio 실행,
``cd src/mcp-servers`` 실행, 저장소 루트의 pytest 실행마다 서로 다른 파일을 읽었습니다.
이 모듈은 ``Path(__file__).resolve()`` 로 절대 경로를 계산해 어디서 실행하든 같은 파일을 읽게 합니다.

읽는 순서 (뒤가 앞을 덮어씀, OS 환경 변수는 항상 최우선):

1. 저장소 루트 ``.env`` (단일 사실 출처, 정본 항목은 루트 ``.env.example``)
2. 서버 패키지 안의 ``.env`` (선택, 해당 서버만 값을 바꾸고 싶을 때 쓰는 override)

없는 파일은 pydantic-settings 가 조용히 건너뛰므로 둘 다 없어도 기본값으로 동작해요.
"""

from __future__ import annotations

from pathlib import Path

# src/mcp-servers/_common/env.py 기준 parents[3] = 저장소 루트 (Docker 에서는 /app)
REPO_ROOT = Path(__file__).resolve().parents[3]


def env_files(config_file: str | Path, repo_root: Path | None = None) -> tuple[Path, Path]:
    """``(루트 .env, 패키지 .env)`` 절대 경로 튜플을 반환한다.

    Args:
        config_file: 호출하는 서버의 ``config.py`` 경로. 보통 ``__file__`` 을 넘깁니다.
        repo_root: 저장소 루트. 테스트에서만 지정하고, 생략하면 :data:`REPO_ROOT` 를 씁니다.
    """
    root = (repo_root or REPO_ROOT).resolve()
    package_dir = Path(config_file).resolve().parent
    return (root / ".env", package_dir / ".env")
