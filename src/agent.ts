import type {
  AgentOptions,
  AgentRunResult,
  ConversationMessage,
  Logger,
  ToolCall,
  ToolResponse,
  ToolDefinition,
  MediaAttachment,
} from './types.js'
import { ToolResultImage, ToolResultAudio } from './types.js'
import { buildPrompt, appendToolCallAndResponse } from './prompt-builder.js'
import { parseToolCalls, hasToolCalls, extractThinking, extractFinalResponse } from './parser.js'

const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_TOKENS = 1024
const MIN_OUTPUT_BUDGET = 256

const NO_OP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

function collectMedia(responses: ToolResponse[]): MediaAttachment[] {
  const media: MediaAttachment[] = []
  for (const resp of responses) {
    for (const v of Object.values(resp.result)) {
      if (v instanceof ToolResultImage || v instanceof ToolResultAudio) {
        media.push(v)
      }
    }
  }
  return media
}

export class Agent {
  private options: AgentOptions
  private history: ConversationMessage[] = []
  private aborted = false
  private toolMap: Map<string, ToolDefinition>
  private logger: Logger

  constructor(options: AgentOptions) {
    this.options = options
    this.toolMap = new Map(options.tools.map(t => [t.name, t]))
    this.logger = options.logger ?? NO_OP_LOGGER
  }

  abort(): void {
    this.aborted = true
    this.options.model.abort()
  }

  async run(userMessage: string): Promise<AgentRunResult> {
    const { model, systemPrompt, tools, thinking = false } = this.options
    const maxIterations = this.options.maxIterations ?? DEFAULT_MAX_ITERATIONS

    this.aborted = false
    this.history.push({ role: 'user', content: userMessage })

    let prompt = buildPrompt(systemPrompt, tools, this.history, thinking)
    let iterations = 0
    let toolCallCount = 0
    let pendingMedia: MediaAttachment[] = []

    try {
      while (iterations < maxIterations) {
        if (this.aborted) {
          const response = 'Generation stopped.'
          this.history.push({ role: 'model', content: response })
          return { response, toolCallCount, iterations }
        }
        iterations++

        this.logger.debug('Agent iteration', iterations, 'prompt length:', prompt.length)

        let output = await model.generateRaw(prompt, {
          maxTokens: DEFAULT_MAX_TOKENS,
          onChunk: this.options.onChunk,
          onThinkingChunk: this.options.onThinkingChunk,
          media: pendingMedia.length > 0 ? pendingMedia : undefined,
        })

        // Handle truncated tool calls
        if (output.includes('<|tool_call>') && !output.includes('<tool_call|>')) {
          const fullPrompt = prompt + output
          const promptTokens = model.countTokens(fullPrompt)
          const remaining = model.contextLimit - promptTokens

          if (remaining > MIN_OUTPUT_BUDGET) {
            this.logger.info('Truncated tool call, continuing with', remaining, 'token budget')
            const continuation = await model.generateRaw(fullPrompt, {
              maxTokens: remaining,
              onChunk: this.options.onChunk,
              onThinkingChunk: this.options.onThinkingChunk,
            })
            output += continuation
          } else {
            this.logger.info('Truncated tool call, context nearly full — stripping thinking')
            const stripped = extractThinking(output).rest
            const strippedPrompt = prompt + stripped
            const strippedTokens = model.countTokens(strippedPrompt)
            const strippedRemaining = model.contextLimit - strippedTokens

            if (strippedRemaining > MIN_OUTPUT_BUDGET) {
              const continuation = await model.generateRaw(strippedPrompt, {
                maxTokens: strippedRemaining,
                onChunk: this.options.onChunk,
                onThinkingChunk: this.options.onThinkingChunk,
              })
              output = stripped + continuation
            } else {
              this.logger.warn('Context exhausted — cannot complete tool call')
            }
          }
        }
        pendingMedia = []

        const { rest } = extractThinking(output)

        if (!hasToolCalls(rest)) {
          const response = extractFinalResponse(output)
          this.history.push({ role: 'model', content: response })
          return { response, toolCallCount, iterations }
        }

        // Parse and execute tool calls
        const calls = parseToolCalls(rest)
        const responses: ToolResponse[] = []

        for (const call of calls) {
          this.options.onToolCall?.(call)

          const tool = this.toolMap.get(call.name)
          if (!tool) {
            responses.push({
              name: call.name,
              result: { error: `Unknown tool: ${call.name}` },
            })
            continue
          }

          try {
            const result = await tool.execute(call.arguments)
            const response: ToolResponse = { name: call.name, result }
            responses.push(response)
            this.options.onToolResponse?.(response)
          } catch (e) {
            const response: ToolResponse = {
              name: call.name,
              result: { error: String(e) },
            }
            responses.push(response)
            this.options.onToolResponse?.(response)
          }
        }

        toolCallCount += calls.length
        pendingMedia = collectMedia(responses)

        this.history.push({
          role: 'model',
          content: '',
          toolCalls: calls,
          toolResponses: responses,
        })

        prompt = appendToolCallAndResponse(prompt, calls, responses)
      }

      const response = `I've reached the maximum number of tool calls (${maxIterations}). Here's what I found so far based on the tools I've used.`
      this.history.push({ role: 'model', content: response })
      return { response, toolCallCount, iterations }
    } catch (e) {
      this.logger.error('Agent run error:', e)
      const last = this.history[this.history.length - 1]
      if (last?.role === 'user') {
        this.history.pop()
      }
      throw e
    }
  }

  updateOptions(partial: Partial<Pick<AgentOptions, 'thinking' | 'maxIterations'>>): void {
    if (partial.thinking !== undefined) this.options.thinking = partial.thinking
    if (partial.maxIterations !== undefined) this.options.maxIterations = partial.maxIterations
  }

  clearHistory(): void {
    this.history = []
  }

  getHistory(): ConversationMessage[] {
    return [...this.history]
  }
}
