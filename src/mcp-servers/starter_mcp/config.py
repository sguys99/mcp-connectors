"""starter-mcp 설정. pydantic-settings 최소 셋."""

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

    starter_mcp_port: int = 8001
    mcp_api_key: str | None = None


settings = Settings()
