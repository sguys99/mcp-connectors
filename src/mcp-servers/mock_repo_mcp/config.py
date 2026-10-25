"""mock-repo-mcp 설정. pydantic-settings 최소 셋."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

from _common.env import env_files


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # 저장소 루트 .env 와 이 패키지의 .env(선택 override)를 CWD 와 무관하게 읽음
        env_file=env_files(__file__),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mock_repo_mcp_port: int = 8002
    # 비어 있으면 fixtures/ 기반 MockBackendClient, 값이 있으면 HttpBackendClient 로 실 API 호출
    mock_repo_backend_url: str = ""
    mcp_api_key: str | None = None


settings = Settings()
