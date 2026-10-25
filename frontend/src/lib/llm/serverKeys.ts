// 서버 env 의 LLM API key (서버 전용).
// Chat 요청 body 에 apiKey 가 없으면 이 값을 쓴다. Docker 에서는 루트 .env 의 값이 compose 로 들어온다.
// Frontend 에 접속할 수 있는 누구나 이 키로 LLM 을 호출하게 되므로 CHAT_ALLOW_SERVER_KEYS=true 일 때만 쓴다.
// 브라우저에는 키 값이 아닌 "있음/없음" 만 내려준다 (serverKeyAvailability).

import "server-only";

// process.env 와 같은 모양. 테스트에서 일부 키만 넘길 수 있게 NodeJS.ProcessEnv 대신 사용.
type Env = Record<string, string | undefined>;

export type LLMProvider = "anthropic" | "openai" | "openrouter";

const ENV_NAMES: Record<LLMProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function getServerApiKey(
  provider: LLMProvider,
  env: Env = process.env,
): string | undefined {
  if (!serverKeysAllowed(env)) return undefined;
  const value = env[ENV_NAMES[provider]]?.trim();
  return value ? value : undefined;
}

export function serverKeysAllowed(env: Env = process.env): boolean {
  return env.CHAT_ALLOW_SERVER_KEYS?.trim().toLowerCase() === "true";
}

export function serverKeyAvailability(
  env: Env = process.env,
): Record<LLMProvider, boolean> {
  return {
    anthropic: getServerApiKey("anthropic", env) !== undefined,
    openai: getServerApiKey("openai", env) !== undefined,
    openrouter: getServerApiKey("openrouter", env) !== undefined,
  };
}
