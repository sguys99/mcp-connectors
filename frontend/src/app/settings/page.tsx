// Settings 진입점 (서버 컴포넌트).
// 서버 env 에 LLM 키가 있는지와 서버 키 사용 허용 여부만 클라이언트로 넘긴다. 키 값 자체는 내려가지 않는다.

import { serverKeyAvailability, serverKeysAllowed } from "@/lib/llm/serverKeys";

import pkg from "../../../package.json";
import SettingsView from "./SettingsView";

export default function SettingsPage() {
  return (
    <SettingsView
      serverKeys={serverKeyAvailability()}
      serverKeysEnabled={serverKeysAllowed()}
      version={pkg.version}
      sdkVersion={pkg.dependencies["@modelcontextprotocol/sdk"]}
    />
  );
}
