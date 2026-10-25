// 저장소 루트 configs/ 아래 파일의 실제 경로를 찾는다 (서버 전용).
//
// 우선순위:
//   1. 환경 변수 값 (상대 경로면 process.cwd() 기준). 예: MCP_REGISTRY_PATH, CHAT_SYSTEM_PROMPT_PATH
//   2. <cwd>/configs/<relative>     ← Docker standalone 이미지 (/app/configs)
//   3. <cwd>/../configs/<relative>  ← 로컬 `npm run dev`, `npm run build` (cwd = frontend/)
//
// 후보가 하나도 없으면 마지막 후보를 돌려줘서, 읽기 실패 메시지에 기대 경로가 드러나게 한다.

import "server-only";

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function resolveConfigFile(
  envValue: string | undefined,
  relative: string,
  cwd: string = process.cwd(),
): string {
  const fromEnv = envValue?.trim();
  if (fromEnv) return resolve(cwd, fromEnv);

  const candidates = [join(cwd, "configs", relative), join(cwd, "..", "configs", relative)];
  return candidates.find((p) => existsSync(p)) ?? candidates[candidates.length - 1]!;
}
