/**
 * LLM client — uses byok-llm for key resolution, makes direct API calls.
 *
 * Supports tool use (function calling) for agent loops.
 */

import {
  resolveWithFallback,
  getProviderHeaders,
  getProviderBaseUrl,
  type ResolvedProvider,
} from "byok-llm";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

let resolvedProvider: ResolvedProvider | null = null;

async function getProvider(): Promise<ResolvedProvider> {
  if (!resolvedProvider) {
    resolvedProvider = await resolveWithFallback();
    if (!resolvedProvider) {
      throw new Error(
        "No LLM provider configured. Run the setup wizard first.",
      );
    }
    console.log(`🤖 Using LLM provider: ${resolvedProvider.providerId}`);
  }
  return resolvedProvider;
}

/**
 * Run a full agent loop: send messages + tools, execute tool calls,
 * repeat until the agent stops calling tools.
 */
export async function runAgentLoop(
  messages: Message[],
  tools: ToolDefinition[],
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  const provider = await getProvider();

  let currentMessages = [...messages];
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const response = await chatCompletion(provider, currentMessages, tools);

    // If the agent produced text and no tool calls, we're done
    if (response.toolCalls.length === 0) {
      return response.content || "";
    }

    // Add assistant message with tool calls
    currentMessages.push({
      role: "assistant",
      content: response.content || "",
      tool_calls: response.toolCalls,
    });

    // Execute each tool call and add results
    for (const tc of response.toolCalls) {
      const args = JSON.parse(tc.function.arguments);
      const result = await executeToolCall(tc.function.name, args);
      currentMessages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }
  }

  throw new Error(`Agent loop exceeded ${MAX_ITERATIONS} iterations`);
}

async function chatCompletion(
  provider: ResolvedProvider,
  messages: Message[],
  tools?: ToolDefinition[],
): Promise<LLMResponse> {
  const baseUrl = await getProviderBaseUrl(provider.providerId);
  const headers = await getProviderHeaders(provider.providerId);

  if (!headers) throw new Error("Failed to get provider headers");

  const body: Record<string, unknown> = {
    model: getDefaultModel(provider.providerId),
    messages,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  // Use OpenAI-compatible chat completions endpoint
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: { content?: string; tool_calls?: ToolCall[] };
      finish_reason: string;
    }>;
  };

  const choice = data.choices[0];
  return {
    content: choice.message.content || null,
    toolCalls: choice.message.tool_calls || [],
    finishReason: choice.finish_reason,
  };
}

function getDefaultModel(providerId: string): string {
  const models: Record<string, string> = {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    groq: "llama-3.3-70b-versatile",
    openrouter: "anthropic/claude-sonnet-4-20250514",
    google: "gemini-2.0-flash",
    xai: "grok-3",
    mistral: "mistral-large-latest",
    deepseek: "deepseek-chat",
  };
  return models[providerId] || "gpt-4o";
}
