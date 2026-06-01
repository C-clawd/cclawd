/**
 * AI Security Gateway - OpenAI Chat Completions API handler
 *
 * Handles POST /v1/chat/completions requests in OpenAI's format.
 * Also compatible with OpenAI-compatible APIs (Kimi, DeepSeek, etc.)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BackendConfig, MappingTable } from "../types.js";
import { sanitize } from "../sanitizer.js";
import { restore, createStreamRestorer } from "../restorer.js";
import { generateRequestId, logSanitizeEvent, logRestoreEvent } from "../activity.js";

/**
 * Handle OpenAI API request
 *
 * @param backend - Config for OpenAI-compatible backend
 * @param extraHeaders - Optional additional headers (e.g., OpenRouter attribution)
 */
export async function handleOpenAIRequest(
  req: IncomingMessage,
  res: ServerResponse,
  backend: BackendConfig,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  try {
    const requestId = generateRequestId();
    const sanitizeStart = Date.now();

    // 1. Parse request body
    const body = await readBody(req);
    const requestData = JSON.parse(body);

    const {
      model,
      messages,
      tools,
      tool_choice,
      temperature,
      max_tokens,
      stream = false,
      ...rest
    } = requestData;

    // 2. Sanitize messages
    const { sanitized: sanitizedMessages, mappingTable, redactionCount } = sanitize(messages);

    // Debug: log what was sanitized
    console.log(`[ai-security-gateway] Sanitized ${redactionCount} items`);
    if (mappingTable.size > 0) {
      for (const [placeholder, original] of mappingTable.entries()) {
        console.log(`[ai-security-gateway]   ${placeholder} <- (${original.length} chars)`);
      }
    }

    // Log sanitization event
    if (redactionCount > 0) {
      logSanitizeEvent({
        requestId,
        backend: "openai",
        endpoint: "/v1/chat/completions",
        model,
        mappingTable,
        redactionCount,
        durationMs: Date.now() - sanitizeStart,
      });
    }

    // 3. Build sanitized request
    const sanitizedRequest = {
      model,
      messages: sanitizedMessages,
      ...(tools && { tools }),
      ...(tool_choice && { tool_choice }),
      ...(temperature !== undefined && { temperature }),
      ...(max_tokens && { max_tokens }),
      stream,
      ...rest,
    };

    // 4. Use provided backend config
    // Note: baseUrl already includes the full path prefix (e.g., /v1 or /v1/coding)
    const apiUrl = `${backend.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${backend.apiKey}`,
    };
    // Merge extra headers (e.g., OpenRouter attribution headers)
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(sanitizedRequest),
    });

    if (!response.ok) {
      // Forward error response
      res.writeHead(response.status, { "Content-Type": "application/json" });
      const errorBody = await response.text();
      res.end(errorBody);
      return;
    }

    // 6. Handle streaming or non-streaming response
    if (stream) {
      await handleOpenAIStream(response, res, mappingTable, requestId, model);
    } else {
      await handleOpenAINonStream(response, res, mappingTable, requestId, model);
    }
  } catch (error) {
    console.error("[ai-security-gateway] OpenAI handler error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Internal gateway error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Handle streaming response (SSE) with smart placeholder restoration
 *
 * Uses StreamRestorer to detect `__` and buffer potential placeholders.
 * Only buffers when necessary, maintaining streaming UX.
 */
async function handleOpenAIStream(
  response: Response,
  res: ServerResponse,
  mappingTable: MappingTable,
  requestId: string,
  model?: string,
): Promise<void> {
  const restoreStart = Date.now();

  // Debug: log mapping table
  if (mappingTable.size > 0) {
    console.log(`[ai-security-gateway] Streaming with ${mappingTable.size} placeholders to restore`);
  }

  // Set SSE headers
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

  // Create stream restorer for text content
  const streamRestorer = createStreamRestorer(mappingTable);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode chunk
      lineBuffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) {
          res.write("\n");
          continue;
        }

        if (!line.startsWith("data: ")) {
          res.write(line + "\n");
          continue;
        }

        const dataContent = line.slice(6);
        const outputLine = processOpenAIStreamDataLine(dataContent, mappingTable, streamRestorer);
        if (outputLine !== null) {
          res.write(outputLine + "\n");
        }
      }
    }

    // Write any remaining line buffer
    if (lineBuffer.trim()) {
      res.write(lineBuffer + "\n");
    }

    // Finalize stream restorer - flush any remaining buffered content
    const finalContent = streamRestorer.finalize();
    if (finalContent.length > 0) {
      // Create a final chunk with remaining content
      const finalChunk: OpenAISSEChunk = {
        choices: [{ delta: { content: finalContent }, index: 0, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n`);
    }

    // Log restoration event
    if (mappingTable.size > 0) {
      logRestoreEvent({
        requestId,
        backend: "openai",
        endpoint: "/v1/chat/completions",
        model,
        mappingTable,
        restorationCount: mappingTable.size,
        durationMs: Date.now() - restoreStart,
      });
    }

    res.end();
  } catch (error) {
    console.error("[ai-security-gateway] Stream error:", error);
    res.end();
  }
}

/**
 * OpenAI SSE chunk structure
 */
interface OpenAISSEDelta {
  content?: string;
  role?: string;
  tool_calls?: unknown[];
  function_call?: unknown;
  reasoning_content?: string;
}

interface OpenAISSEChunk {
  choices: Array<{
    delta: OpenAISSEDelta;
    index: number;
    finish_reason: string | null;
  }>;
  [key: string]: unknown;
}

/**
 * Delta fields that must not go through content-only StreamRestorer
 * (tool_calls would be dropped if we only rewrite delta.content).
 */
function deltaHasNonContentFields(delta: OpenAISSEDelta | undefined): boolean {
  if (!delta) return false;
  return (
    delta.tool_calls !== undefined ||
    delta.function_call !== undefined ||
    delta.reasoning_content !== undefined ||
    delta.role !== undefined
  );
}

/**
 * Process one OpenAI SSE data payload for streaming restoration.
 * Returns the full `data: ...` line to write, or null to skip (buffering empty content).
 */
export function processOpenAIStreamDataLine(
  dataContent: string,
  mappingTable: MappingTable,
  streamRestorer: ReturnType<typeof createStreamRestorer>,
): string | null {
  if (dataContent === "[DONE]") {
    return "data: [DONE]";
  }

  if (mappingTable.size === 0) {
    return `data: ${dataContent}`;
  }

  try {
    const parsed = JSON.parse(dataContent) as OpenAISSEChunk;
    const delta = parsed.choices?.[0]?.delta;

    // tool_calls / reasoning / role chunks: restore whole JSON, preserve structure
    if (deltaHasNonContentFields(delta)) {
      const restored = restore(parsed, mappingTable) as OpenAISSEChunk;
      return `data: ${JSON.stringify(restored)}`;
    }

    const textContent = delta?.content;
    if (textContent !== undefined) {
      const restoredContent = streamRestorer.process(textContent);
      if (restoredContent.length === 0) {
        return null;
      }
      const restoredChunk = {
        ...parsed,
        choices: parsed.choices.map((c, i) =>
          i === 0 ? { ...c, delta: { ...c.delta, content: restoredContent } } : c,
        ),
      };
      return `data: ${JSON.stringify(restoredChunk)}`;
    }

    // finish_reason / usage chunks without content
    const restored = restore(parsed, mappingTable) as OpenAISSEChunk;
    return `data: ${JSON.stringify(restored)}`;
  } catch {
    return `data: ${dataContent}`;
  }
}

/**
 * Handle non-streaming response
 */
async function handleOpenAINonStream(
  response: Response,
  res: ServerResponse,
  mappingTable: MappingTable,
  requestId: string,
  model?: string,
): Promise<void> {
  const restoreStart = Date.now();
  const responseBody = await response.text();
  const responseData = JSON.parse(responseBody);

  // Restore placeholders in response
  const restoredData = restore(responseData, mappingTable);

  // Log restoration event
  if (mappingTable.size > 0) {
    logRestoreEvent({
      requestId,
      backend: "openai",
      endpoint: "/v1/chat/completions",
      model,
      mappingTable,
      restorationCount: mappingTable.size,
      durationMs: Date.now() - restoreStart,
    });
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(restoredData));
}

/**
 * Read request body as string
 */
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
