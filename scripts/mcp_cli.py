"""MCP server CLI client (F-3).

Reads `configs/mcp_servers.yaml`, auto-routes between stdio and Streamable HTTP
transports, and exposes these subcommands:

* list-servers, list-tools, call: tools
* list-resources, read-resource: resources
* list-prompts, get-prompt: prompts
* test: run scenario YAML files (see docs/scenario-format.md)

Streamable HTTP 요청 헤더:

* 레지스트리 항목의 ``headers`` (선택) 를 그대로 보냅니다. 값 안의 ``${VAR}`` 는 환경 변수로 치환하고,
  치환 결과가 빈 헤더는 보내지 않아요.
* ``X-MCP-API-Key`` 가 ``headers`` 에 없으면 ``MCP_API_KEY`` (OS 환경 변수, 없으면 루트 ``.env``)
  값을 자동으로 붙입니다. 서버와 같은 키를 읽으므로 키를 설정해도 ``make cli-*`` 가 그대로 동작합니다.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Annotated, Any

import typer
import yaml
from fastmcp import Client
from fastmcp.client.transports import StdioTransport, StreamableHttpTransport
from pydantic_settings import BaseSettings, SettingsConfigDict

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcp_ops  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = REPO_ROOT / "configs" / "mcp_servers.yaml"
MCP_SERVERS_CWD = REPO_ROOT / "src" / "mcp-servers"
API_KEY_HEADER = "X-MCP-API-Key"
_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class _CliSettings(BaseSettings):
    """CLI 가 읽는 값. 우선순위는 OS 환경 변수 > 루트 .env 입니다 (패키지 .env 는 읽지 않음)."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mcp_api_key: str = ""


app = typer.Typer(help="MCP server CLI client (F-3).", no_args_is_help=True)


def _load_registry() -> dict[str, dict[str, Any]]:
    try:
        with REGISTRY_PATH.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        typer.echo(f"Registry not found: {REGISTRY_PATH}", err=True)
        raise typer.Exit(code=2) from None
    except yaml.YAMLError as e:
        typer.echo(f"Invalid YAML in {REGISTRY_PATH}: {e}", err=True)
        raise typer.Exit(code=2) from None

    servers = data.get("servers") if isinstance(data, dict) else None
    if not isinstance(servers, list) or not servers:
        typer.echo(
            "Registry malformed: top-level 'servers' must be a non-empty list",
            err=True,
        )
        raise typer.Exit(code=2)
    return {entry["name"]: entry for entry in servers if isinstance(entry, dict) and "name" in entry}


def _resolve_server(name: str, registry: dict[str, dict[str, Any]]) -> dict[str, Any]:
    entry = registry.get(name)
    if entry is None:
        available = ", ".join(registry.keys())
        typer.echo(f"Unknown server '{name}'. Available: {available}", err=True)
        raise typer.Exit(code=2)
    return entry


def _resolve_headers(entry: dict[str, Any], api_key: str | None = None) -> dict[str, str]:
    """레지스트리 ``headers`` 의 ``${VAR}`` 를 치환하고, 없으면 ``X-MCP-API-Key`` 를 보탭니다."""
    raw = entry.get("headers") or {}
    if not isinstance(raw, dict):
        typer.echo(f"Registry entry '{entry.get('name')}' has non-mapping 'headers'", err=True)
        raise typer.Exit(code=2)

    headers: dict[str, str] = {}
    for name, value in raw.items():
        resolved = _ENV_REF.sub(lambda m: os.environ.get(m.group(1), ""), str(value))
        if resolved:
            headers[str(name)] = resolved

    if not any(name.lower() == API_KEY_HEADER.lower() for name in raw):
        key = _CliSettings().mcp_api_key if api_key is None else api_key
        if key:
            headers[API_KEY_HEADER] = key
    return headers


def _build_client(entry: dict[str, Any], extra_env: dict[str, str] | None = None) -> Client:
    """``extra_env`` 는 stdio 서버 프로세스에만 덧씌웁니다 (HTTP 서버는 이미 떠 있어요)."""
    transport_name = entry.get("transport")
    if transport_name == "stdio":
        cmd = entry.get("command") or []
        if not cmd:
            typer.echo(
                f"Registry entry '{entry.get('name')}' is missing 'command'",
                err=True,
            )
            raise typer.Exit(code=2)
        # MCP SDK 는 env 를 주지 않으면 HOME, PATH 같은 최소 변수만 하위 프로세스에 넘깁니다.
        # 그러면 `NL2SQL_DB_BACKEND=real python scripts/mcp_cli.py ...` 처럼 OS 환경 변수로 준
        # 서버 설정이 무시되므로 현재 환경을 그대로 물려줍니다 (서버의 우선순위 규칙과 일치).
        transport = StdioTransport(
            command=cmd[0],
            args=list(cmd[1:]),
            env={**os.environ, **(extra_env or {})},
            cwd=str(MCP_SERVERS_CWD),
        )
    elif transport_name == "streamable_http":
        url = entry.get("url")
        if not url:
            typer.echo(
                f"Registry entry '{entry.get('name')}' is missing 'url'",
                err=True,
            )
            raise typer.Exit(code=2)
        transport = StreamableHttpTransport(url=url, headers=_resolve_headers(entry) or None)
    else:
        typer.echo(
            f"Unsupported transport '{transport_name}' in registry entry "
            f"'{entry.get('name', '<unknown>')}'",
            err=True,
        )
        raise typer.Exit(code=2)
    return Client(transport)


def _endpoint_summary(entry: dict[str, Any]) -> str:
    if entry.get("transport") == "stdio":
        return " ".join(entry.get("command", []))
    return entry.get("url", "")


@app.command(name="list-servers")
def list_servers() -> None:
    """Print the registry as a plain-text table (NAME / TRANSPORT / ENDPOINT)."""
    registry = _load_registry()
    rows = [(e["name"], e.get("transport", "?"), _endpoint_summary(e)) for e in registry.values()]
    headers = ("NAME", "TRANSPORT", "ENDPOINT")
    widths = [max(len(headers[i]), *(len(r[i]) for r in rows)) for i in range(3)]
    fmt = f"{{:<{widths[0]}}}  {{:<{widths[1]}}}  {{:<{widths[2]}}}"
    typer.echo(fmt.format(*headers))
    for r in rows:
        typer.echo(fmt.format(*r))


async def _async_list_tools(client: Client) -> list[Any]:
    async with client:
        return await client.list_tools()


@app.command(name="list-tools")
def list_tools(
    server: str = typer.Option(..., "--server", help="Server name from configs/mcp_servers.yaml"),
) -> None:
    """List tools registered on the given server."""
    registry = _load_registry()
    entry = _resolve_server(server, registry)
    # 레지스트리 항목 오류(typer.Exit, 종료 코드 2)가 아래 except 에 잡혀 1 이 되지 않도록 먼저 만듭니다
    client = _build_client(entry)
    try:
        tools = asyncio.run(_async_list_tools(client))
    except Exception as e:  # noqa: BLE001
        typer.echo(f"{type(e).__name__}: {e}", err=True)
        raise typer.Exit(code=1) from None

    for t in tools:
        schema = getattr(t, "inputSchema", None) or {}
        required = schema.get("required", []) if isinstance(schema, dict) else []
        req_str = ", ".join(required) if required else "(no required fields)"
        typer.echo(f"- {t.name}: {t.description or ''}")
        typer.echo(f"    required: {req_str}")


def _extract_error_code(message: str) -> str:
    """메시지에서 [UPPER_CODE] 패턴을 추출한다."""
    return mcp_ops.extract_error_code(message)


def _tool_error_dict(message: str) -> dict[str, Any]:
    return mcp_ops.error_dict(message)


async def _async_call_tool(client: Client, tool: str, params: dict[str, Any]) -> Any:
    async with client:
        return await mcp_ops.call_tool(client, tool, params)


@app.command(name="call")
def call(
    server: str = typer.Option(..., "--server", help="Server name from configs/mcp_servers.yaml"),
    tool: str = typer.Option(..., "--tool", help="Tool name to call"),
    params: str = typer.Option(..., "--params", help="JSON-encoded params object"),
) -> None:
    """Call a tool and print the result as JSON."""
    try:
        params_dict = json.loads(params)
    except json.JSONDecodeError as e:
        typer.echo(f"Invalid JSON in --params: {e}", err=True)
        raise typer.Exit(code=2) from None
    if not isinstance(params_dict, dict):
        typer.echo(
            f"--params must be a JSON object, got {type(params_dict).__name__}",
            err=True,
        )
        raise typer.Exit(code=2)

    registry = _load_registry()
    entry = _resolve_server(server, registry)
    client = _build_client(entry)
    try:
        result = asyncio.run(_async_call_tool(client, tool, params_dict))
    except Exception as e:  # noqa: BLE001
        typer.echo(f"{type(e).__name__}: {e}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(json.dumps(result, indent=2, ensure_ascii=False, default=str))


def _run_client(entry: dict[str, Any], op: Any) -> Any:
    """클라이언트를 열어 ``op(client)`` 를 실행합니다. 연결 실패 같은 오류는 종료 코드 1 로 끝내요."""

    async def _session() -> Any:
        async with client:
            return await op(client)

    # 레지스트리 항목 오류(typer.Exit, 종료 코드 2)가 아래 except 에 잡히지 않도록 먼저 만듭니다
    client = _build_client(entry)
    try:
        return asyncio.run(_session())
    except Exception as e:  # noqa: BLE001
        typer.echo(f"{type(e).__name__}: {e}", err=True)
        raise typer.Exit(code=1) from None


def _parse_json_object(raw: str, option: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as e:
        typer.echo(f"Invalid JSON in {option}: {e}", err=True)
        raise typer.Exit(code=2) from None
    if not isinstance(value, dict):
        typer.echo(f"{option} must be a JSON object, got {type(value).__name__}", err=True)
        raise typer.Exit(code=2)
    return value


@app.command(name="list-resources")
def list_resources(
    server: str = typer.Option(..., "--server", help="Server name from configs/mcp_servers.yaml"),
) -> None:
    """List resources and resource templates exposed by the given server."""
    entry = _resolve_server(server, _load_registry())

    async def op(client: Client) -> tuple[list[Any], list[Any]]:
        resources = await client.list_resources()
        try:
            templates = await client.list_resource_templates()
        except Exception:  # noqa: BLE001  (템플릿 미지원 서버는 목록만 보여 줍니다)
            templates = []
        return resources, templates

    resources, templates = _run_client(entry, op)
    for r in resources:
        mime = f" [{r.mimeType}]" if getattr(r, "mimeType", None) else ""
        typer.echo(f"- {r.uri}: {r.name}{mime}")
        if r.description:
            typer.echo(f"    {r.description}")
    for t in templates:
        typer.echo(f"- {t.uriTemplate}: {t.name} (template)")
        if t.description:
            typer.echo(f"    {t.description}")


@app.command(name="read-resource")
def read_resource(
    server: str = typer.Option(..., "--server", help="Server name from configs/mcp_servers.yaml"),
    uri: str = typer.Option(..., "--uri", help="Resource URI to read"),
) -> None:
    """Read a resource and print the contents as JSON."""
    entry = _resolve_server(server, _load_registry())
    result = _run_client(entry, lambda client: mcp_ops.read_resource(client, uri))
    typer.echo(json.dumps(result, indent=2, ensure_ascii=False, default=str))


@app.command(name="list-prompts")
def list_prompts(
    server: str = typer.Option(..., "--server", help="Server name from configs/mcp_servers.yaml"),
) -> None:
    """List prompts registered on the given server."""
    entry = _resolve_server(server, _load_registry())
    prompts = _run_client(entry, lambda client: client.list_prompts())
    for p in prompts:
        typer.echo(f"- {p.name}: {p.description or ''}")
        args = [f"{a.name}{' (required)' if a.required else ''}" for a in (p.arguments or [])]
        typer.echo(f"    arguments: {', '.join(args) if args else '(none)'}")


@app.command(name="get-prompt")
def get_prompt(
    server: str = typer.Option(..., "--server", help="Server name from configs/mcp_servers.yaml"),
    name: str = typer.Option(..., "--name", help="Prompt name"),
    args: str = typer.Option("{}", "--args", help="JSON-encoded arguments object"),
) -> None:
    """Render a prompt with arguments and print the messages as JSON."""
    arguments = _parse_json_object(args, "--args")
    entry = _resolve_server(server, _load_registry())
    result = _run_client(entry, lambda client: mcp_ops.get_prompt(client, name, arguments))
    typer.echo(json.dumps(result, indent=2, ensure_ascii=False, default=str))


@app.command(name="test")
def test(
    path: Annotated[Path, typer.Argument(help="Scenario YAML file or a directory of them")],
    server: Annotated[
        str | None,
        typer.Option(
            "--server", help="Run against this registry server (overrides 'server' in the YAML)"
        ),
    ] = None,
    junit: Annotated[
        Path | None, typer.Option("--junit", help="Write a JUnit XML report to this path")
    ] = None,
    case_id: Annotated[
        list[str] | None, typer.Option("--id", help="Only cases whose id matches (glob, repeatable)")
    ] = None,
    tag: Annotated[list[str] | None, typer.Option("--tag", help="Only cases with this tag")] = None,
    min_pass_rate: Annotated[
        float, typer.Option("--min-pass-rate", help="Fail when PASS / (PASS+FAIL+ERROR) is below this %")
    ] = 100.0,
    timeout: Annotated[
        float | None, typer.Option("--timeout", help="Per-case timeout in seconds")
    ] = None,
    jobs: Annotated[int, typer.Option("--jobs", "-j", min=1, help="Cases to run concurrently")] = 1,
) -> None:
    """Run scenario YAML files against a registry server. Exit 1 on failures, 2 on bad input."""
    import scenario_runner

    registry = _load_registry()
    if server is not None:
        _resolve_server(server, registry)
    raise typer.Exit(
        code=scenario_runner.run_cli(
            path,
            registry=registry,
            client_factory=_build_client,
            server_override=server,
            junit_path=junit,
            ids=case_id or [],
            tags=tag or [],
            min_pass_rate=min_pass_rate,
            timeout=timeout,
            jobs=jobs,
            echo=typer.echo,
        )
    )


if __name__ == "__main__":
    app()
