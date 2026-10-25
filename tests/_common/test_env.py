"""_common.env: .env 경로가 실행 디렉터리(CWD)와 무관하게 해석되는지 검증."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest
from pydantic_settings import BaseSettings, SettingsConfigDict

from _common.env import REPO_ROOT, env_files

SERVER_PACKAGES = ["starter_mcp", "mock_repo_mcp", "nl2sql_mcp"]


def test_repo_root_points_to_repository() -> None:
    assert (REPO_ROOT / "pyproject.toml").is_file()
    assert (REPO_ROOT / ".env.example").is_file()


@pytest.mark.parametrize("package", SERVER_PACKAGES)
def test_server_settings_use_absolute_env_paths(package: str) -> None:
    config = importlib.import_module(f"{package}.config")
    root_env, package_env = config.Settings.model_config["env_file"]
    assert root_env == REPO_ROOT / ".env"
    assert package_env == REPO_ROOT / "src" / "mcp-servers" / package / ".env"
    assert root_env.is_absolute() and package_env.is_absolute()


def test_env_files_load_independent_of_cwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "repo"
    package_dir = repo / "src" / "mcp-servers" / "demo_mcp"
    package_dir.mkdir(parents=True)
    (repo / ".env").write_text("MCP_API_KEY=from-root\nDEMO_PORT=9001\n", encoding="utf-8")
    (package_dir / ".env").write_text("DEMO_PORT=9002\n", encoding="utf-8")

    class DemoSettings(BaseSettings):
        model_config = SettingsConfigDict(
            env_file=env_files(package_dir / "config.py", repo_root=repo),
            extra="ignore",
        )
        mcp_api_key: str | None = None
        demo_port: int = 8000

    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.delenv("MCP_API_KEY", raising=False)
    monkeypatch.delenv("DEMO_PORT", raising=False)

    settings = DemoSettings()
    assert settings.mcp_api_key == "from-root"  # 루트 .env
    assert settings.demo_port == 9002  # 패키지 .env 가 루트를 덮어씀

    monkeypatch.setenv("DEMO_PORT", "9003")
    assert DemoSettings().demo_port == 9003  # OS 환경 변수가 최우선
