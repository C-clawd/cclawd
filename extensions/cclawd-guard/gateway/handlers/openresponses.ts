/**
 * AI Security Gateway - OpenAI Responses API handler
 *
 * Handles POST /v1/responses requests in OpenAI Responses format.
 * Also compatible with OpenAI-compatible APIs exposing /responses.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BackendConfig, MappingTable } from "../types.js";
import { sanitize } from "../sanitizer.js";
import { restore, restoreSSELine } from "../restorer.js";
import { generateRequestId, logSanitizeEvent, logRestoreEvent } from "../activity.js";

/**
 * Handle OpenAI Responses API request.
 *
 * @param backend - Config for OpenAI-compatible backend
 * @param extraHeaders - Optional additional headers (e.g., OpenRouter attribution)
 */
export async function handleOpenResponsesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backend: BackendConfig,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  try {
    const requestId = generateRequestId();
    const sanitizeStart = Date.now();

    const body = await readBody(req);
    const requestData = JSON.parse(body) as Record<string, unknown>;

    const model = typeof requestData.model === "string" ? requestData.model : undefined;
    const stream = requestData.stream === true;

    // Responses payload shape is flexible; sanitize recursively.
    const { sanitized, mappingTable, redactionCount } = sanitize(requestData);

    if (redactionCount > 0) {
      logSanitizeEvent({
        requestId,
        backend: "openai",
        endpoint: "/v1/responses",
        model,
        mappingTable,
        redactionCount,
        durationMs: Date.now() - sanitizeStart,
      });
    }

    const apiUrl = `${backend.baseUrl}/responses`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${backend.apiKey}`,
    };
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(sanitized),
    });

    if (!response.ok) {
      res.writeHead(response.status, { "Content-Type": "application/json" });
      const errorBody = await response.text();
      res.end(errorBody);
      return;
    }

    if (stream) {
      await handleResponsesStream(response, res, mappingTable, requestId, model);
    } else {
      await handleResponsesNonStream(response, res, mappingTable, requestId, model);
    }
  } catch (error) {
    console.error("[ai-security-gateway] OpenResponses handler error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Internal gateway error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function handleResponsesStream(
  response: Response,
  res: ServerResponse,
  mappingTable: MappingTable,
  requestId: string,
  model?: string,
): Promise<void> {
  const restoreStart = Date.now();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const reader = response.body?.getReader();
  if (!reader) {
    res.end();
    return;
  }

  const decoder = new TextDecoder();
  let lineBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) {
          res.write("\n");
          continue;
        }
        if (line.startsWith("data: ")) {
          res.write(restoreSSELine(line, mappingTable) + "\n");
        } else {
          res.write(line + "\n");
        }
      }
    }

    if (lineBuffer.trim()) {
      if (lineBuffer.startsWith("data: ")) {
        res.write(restoreSSELine(lineBuffer, mappingTable) + "\n");
      } else {
        res.write(lineBuffer + "\n");
      }
    }

    if (mappingTable.size > 0) {
      logRestoreEvent({
        requestId,
        backend: "openai",
        endpoint: "/v1/responses",
        model,
        mappingTable,
        restorationCount: mappingTable.size,
        durationMs: Date.now() - restoreStart,
      });
    }

    res.end();
  } catch (error) {
    console.error("[ai-security-gateway] OpenResponses stream error:", error);
    res.end();
  }
}

async function handleResponsesNonStream(
  response: Response,
  res: ServerResponse,
  mappingTable: MappingTable,
  requestId: string,
  model?: string,
): Promise<void> {
  const restoreStart = Date.now();
  const responseBody = await response.text();
  const responseData = JSON.parse(responseBody);
  const restoredData = restore(responseData, mappingTable);

  if (mappingTable.size > 0) {
    logRestoreEvent({
      requestId,
      backend: "openai",
      endpoint: "/v1/responses",
      model,
      mappingTable,
      restorationCount: mappingTable.size,
      durationMs: Date.now() - restoreStart,
    });
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(restoredData));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
