import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { COMPOSE_SERVICES, classifyProbeError, recoveryCommands } from "./offline";

describe("recoveryCommands", () => {
  it("-http 쌍둥이는 compose 서비스 이름에서 -http 를 떼고, make 대상은 레지스트리 이름 그대로", () => {
    expect(recoveryCommands("starter-mcp-http")).toEqual({
      compose: "docker compose up -d starter-mcp",
      make: "make run-starter-mcp-http",
    });
  });

  it("-http 가 없는 이름도 그대로 쓴다", () => {
    expect(recoveryCommands("mock-repo-mcp")).toEqual({
      compose: "docker compose up -d mock-repo-mcp",
      make: "make run-mock-repo-mcp",
    });
  });

  it("nl2sql-mcp-http 도 compose 서비스(nl2sql-mcp)로 복구한다", () => {
    expect(recoveryCommands("nl2sql-mcp-http")).toEqual({
      compose: "docker compose up -d nl2sql-mcp",
      make: "make run-nl2sql-mcp-http",
    });
  });

  it("compose 에 서비스가 없으면 docker 명령을 내지 않는다", () => {
    expect(recoveryCommands("external-mcp-http")).toEqual({ compose: null, make: "make run-external-mcp-http" });
  });

  it("COMPOSE_SERVICES 가 실제 docker-compose.yaml 과 Makefile 에 맞는다", () => {
    const root = resolve(__dirname, "../../../..");
    const compose = parse(readFileSync(resolve(root, "docker-compose.yaml"), "utf8")) as {
      services: Record<string, unknown>;
    };
    for (const service of COMPOSE_SERVICES) expect(Object.keys(compose.services), service).toContain(service);

    const registry = parse(readFileSync(resolve(root, "configs/mcp_servers.yaml"), "utf8")) as {
      servers: { name: string; transport: string }[];
    };
    const makefile = readFileSync(resolve(root, "Makefile"), "utf8");
    for (const s of registry.servers.filter((x) => x.transport === "streamable_http")) {
      expect(makefile, s.name).toMatch(new RegExp(`^run-${s.name}:`, "m"));
    }
  });
});

describe("classifyProbeError", () => {
  it("프록시의 502 JSON-RPC 오류에서 안쪽 메시지를 꺼내 unreachable 로 분류", () => {
    const raw =
      'Error POSTing to endpoint (HTTP 502): {"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"MCP server \'nl2sql-mcp-http\' is unreachable: fetch failed"}}';
    expect(classifyProbeError(raw)).toEqual({
      kind: "unreachable",
      detail: "MCP server 'nl2sql-mcp-http' is unreachable: fetch failed",
    });
  });

  it("UI 타임아웃", () => {
    expect(classifyProbeError("ping timeout (5s)").kind).toBe("timeout");
  });

  it("401 과 403 은 auth", () => {
    expect(classifyProbeError("Error POSTing to endpoint (HTTP 401): Unauthorized").kind).toBe("auth");
    expect(classifyProbeError("HTTP 403 Forbidden").kind).toBe("auth");
  });

  it("그 밖은 other 이고 긴 메시지는 자른다", () => {
    const g = classifyProbeError("x".repeat(500));
    expect(g.kind).toBe("other");
    expect(g.detail.length).toBe(240);
    expect(g.detail.endsWith("…")).toBe(true);
  });
});
