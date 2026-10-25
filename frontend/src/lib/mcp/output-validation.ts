// 도구 outputSchema 검증 (진짜 ajv). 브라우저에서는 이 모듈을 처음 검증이 필요할 때 dynamic import 로만 불러온다.
//
// next.config.ts 가 SDK 가 쓰는 `ajv`, `ajv-formats` 를 브라우저 번들에서 빈 모듈로 바꾸므로, 여기서는 하위 경로
// (`ajv/dist/ajv.js`, `ajv-formats/dist/index.js`)로 같은 라이브러리를 직접 가져와 별칭을 피한다.
// 옵션은 SDK 의 기본 검증기(AjvJsonSchemaValidator)와 같게 맞춰, 서버 쪽 SDK 검증과 결과가 같다.
// 오류 문구도 SDK Client.callTool 이 던지던 것과 같은 McpError 를 던진다.

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import Ajv from "ajv/dist/ajv.js";
import addFormats from "ajv-formats/dist/index.js";

let ajvInstance: InstanceType<typeof Ajv> | null = null;

function getAjv() {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ strict: false, validateFormats: true, validateSchema: false, allErrors: true });
    (addFormats as unknown as (ajv: unknown) => void)(ajvInstance);
  }
  return ajvInstance;
}

export interface ToolCallOutput {
  structuredContent?: unknown;
  isError?: boolean;
}

// SDK Client.callTool 과 같은 규칙: outputSchema 가 있으면 (오류 결과가 아닌 한) structuredContent 가 있어야 하고,
// 있으면 스키마와 맞아야 한다. 어긋나면 McpError 를 던진다.
export function assertToolOutput(toolName: string, outputSchema: Record<string, unknown>, result: ToolCallOutput): void {
  if (!result.structuredContent && !result.isError) {
    throw new McpError(ErrorCode.InvalidRequest, `Tool ${toolName} has an output schema but did not return structured content`);
  }
  if (!result.structuredContent) return;
  try {
    const validate = getAjv().compile(outputSchema);
    if (!validate(result.structuredContent)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Structured content does not match the tool's output schema: ${getAjv().errorsText(validate.errors)}`,
      );
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InvalidParams,
      `Failed to validate structured content: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
