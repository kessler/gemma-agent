// ---- Model backend ----

export interface GenerateOptions {
  maxTokens?: number
  onChunk?: (text: string) => void
  onThinkingChunk?: (text: string) => void
  imageDataUrl?: string
}

export interface ModelBackend {
  generateRaw(prompt: string, options?: GenerateOptions): Promise<string>
  countTokens(text: string): number
  readonly contextLimit: number
  abort(): void
}

// ---- Logger ----

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

// ---- Tool types ----

export interface ToolParameterDef {
  type: string
  description: string
  enum?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters?: {
    type: 'object'
    properties: Record<string, ToolParameterDef>
    required?: string[]
  }
  /** Execute this tool with the parsed arguments. Return the result object. */
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResponse {
  name: string
  result: unknown
}

// ---- Agent types ----

export interface AgentOptions {
  /** Model backend (must be loaded and ready) */
  model: ModelBackend
  /** System prompt for the agent */
  systemPrompt: string
  /** Tools available to the agent */
  tools: ToolDefinition[]
  /** Max agent iterations. Default 10 */
  maxIterations?: number
  /** Enable thinking mode */
  thinking?: boolean
  /** Optional logger. Default no-op. */
  logger?: Logger
  /** Callback for streamed text chunks */
  onChunk?: (text: string) => void
  /** Callback for thinking chunks */
  onThinkingChunk?: (text: string) => void
  /** Callback when a tool is called */
  onToolCall?: (call: ToolCall) => void
  /** Callback when a tool returns */
  onToolResponse?: (response: ToolResponse) => void
}

export interface AgentRunResult {
  response: string
  toolCallCount: number
  iterations: number
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'model'
  content: string
  toolCalls?: ToolCall[]
  toolResponses?: ToolResponse[]
}
