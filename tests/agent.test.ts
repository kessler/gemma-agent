import { describe, it, expect, vi } from 'vitest'
import { Agent } from '../src/agent.js'
import type { ModelBackend, ToolDefinition, Logger } from '../src/types.js'

function createMockBackend(responses: string[]): ModelBackend {
  let i = 0
  return {
    generateRaw: async () => responses[i++] ?? '',
    countTokens: (text: string) => text.length,
    contextLimit: 100_000,
    abort: () => {},
  }
}

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes the input',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string', description: 'Message to echo' } },
    required: ['message'],
  },
  execute: async (args) => ({ echoed: args.message as string }),
}

const failingTool: ToolDefinition = {
  name: 'fail',
  description: 'Always fails',
  execute: async () => { throw new Error('Tool exploded') },
}

const screenshotTool: ToolDefinition = {
  name: 'take_screenshot',
  description: 'Takes a screenshot',
  execute: async () => ({ screenshot: 'data:image/png;base64,abc123' }),
}

describe('Agent', () => {
  it('returns a plain text response when model outputs no tool calls', async () => {
    const backend = createMockBackend(['Hello there!'])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'You are helpful.',
      tools: [echoTool],
    })

    const result = await agent.run('Hi')
    expect(result.response).toBe('Hello there!')
    expect(result.toolCallCount).toBe(0)
    expect(result.iterations).toBe(1)
  })

  it('executes a tool call and returns final response', async () => {
    const backend = createMockBackend([
      '<|tool_call>call:echo{message:<|"|>hello<|"|>}<tool_call|>',
      'The echo said: hello',
    ])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'You are helpful.',
      tools: [echoTool],
    })

    const result = await agent.run('Echo hello')
    expect(result.response).toBe('The echo said: hello')
    expect(result.toolCallCount).toBe(1)
    expect(result.iterations).toBe(2)
  })

  it('handles unknown tools gracefully', async () => {
    const backend = createMockBackend([
      '<|tool_call>call:nonexistent{}<tool_call|>',
      'That tool does not exist.',
    ])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [echoTool],
    })

    const result = await agent.run('Use nonexistent')
    expect(result.response).toBe('That tool does not exist.')
    expect(result.toolCallCount).toBe(1)
  })

  it('catches tool execution errors and continues', async () => {
    const backend = createMockBackend([
      '<|tool_call>call:fail{}<tool_call|>',
      'The tool failed but I recovered.',
    ])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [failingTool],
    })

    const result = await agent.run('Do something')
    expect(result.response).toBe('The tool failed but I recovered.')
    expect(result.toolCallCount).toBe(1)
  })

  it('stops after maxIterations', async () => {
    // Model always returns tool calls, never a plain response
    const backend = createMockBackend(
      Array(20).fill('<|tool_call>call:echo{message:<|"|>hi<|"|>}<tool_call|>'),
    )
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [echoTool],
      maxIterations: 3,
    })

    const result = await agent.run('Loop forever')
    expect(result.iterations).toBe(3)
    expect(result.response).toContain('maximum number of tool calls')
  })

  it('returns abort message when aborted during run', async () => {
    let callCount = 0
    // First call returns a tool call (so the loop continues), second call would happen
    // but abort fires during the first generateRaw, so the loop stops at iteration 2
    const backend: ModelBackend = {
      generateRaw: async () => {
        callCount++
        if (callCount === 1) {
          // First iteration: return a tool call so the loop continues
          agent.abort()
          return '<|tool_call>call:echo{message:<|"|>hi<|"|>}<tool_call|>'
        }
        return 'Should not reach this'
      },
      countTokens: () => 0,
      contextLimit: 100_000,
      abort: () => {},
    }
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [echoTool],
    })

    const result = await agent.run('Hi')
    expect(result.response).toBe('Generation stopped.')
  })

  it('cleans up dangling user message on error', async () => {
    const backend: ModelBackend = {
      generateRaw: async () => { throw new Error('Model crashed') },
      countTokens: () => 0,
      contextLimit: 100_000,
      abort: () => {},
    }
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [],
    })

    await expect(agent.run('Hello')).rejects.toThrow('Model crashed')

    // The user message should have been removed from history
    const history = agent.getHistory()
    expect(history).toHaveLength(0)
  })

  it('calls logger at key points', async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const backend = createMockBackend(['Plain response'])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [],
      logger,
    })

    await agent.run('Hi')
    expect(logger.debug).toHaveBeenCalled()
  })

  it('calls logger.error on failure', async () => {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const backend: ModelBackend = {
      generateRaw: async () => { throw new Error('Boom') },
      countTokens: () => 0,
      contextLimit: 100_000,
      abort: () => {},
    }
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [],
      logger,
    })

    await expect(agent.run('Hi')).rejects.toThrow('Boom')
    expect(logger.error).toHaveBeenCalledWith('Agent run error:', expect.any(Error))
  })

  it('fires onToolCall and onToolResponse callbacks', async () => {
    const onToolCall = vi.fn()
    const onToolResponse = vi.fn()
    const backend = createMockBackend([
      '<|tool_call>call:echo{message:<|"|>test<|"|>}<tool_call|>',
      'Done.',
    ])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [echoTool],
      onToolCall,
      onToolResponse,
    })

    await agent.run('Echo test')
    expect(onToolCall).toHaveBeenCalledWith({ name: 'echo', arguments: { message: 'test' } })
    expect(onToolResponse).toHaveBeenCalledWith({ name: 'echo', result: { echoed: 'test' } })
  })

  it('handles screenshot tool responses', async () => {
    const backend = createMockBackend([
      '<|tool_call>call:take_screenshot{}<tool_call|>',
      'Here is what I see on the page.',
    ])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [screenshotTool],
    })

    const result = await agent.run('Take a screenshot')
    expect(result.response).toBe('Here is what I see on the page.')

    // Verify the screenshot was replaced in history
    const history = agent.getHistory()
    const modelTurn = history.find(m => m.toolResponses?.length)
    expect(modelTurn?.toolResponses?.[0].result).toEqual({ screenshot: 'captured' })
  })

  it('maintains conversation history across multiple runs', async () => {
    const backend = createMockBackend(['First response', 'Second response'])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [],
    })

    await agent.run('First message')
    await agent.run('Second message')

    const history = agent.getHistory()
    expect(history).toHaveLength(4) // 2 user + 2 model
    expect(history[0]).toEqual({ role: 'user', content: 'First message' })
    expect(history[2]).toEqual({ role: 'user', content: 'Second message' })
  })

  it('clearHistory resets conversation', async () => {
    const backend = createMockBackend(['Response'])
    const agent = new Agent({
      model: backend,
      systemPrompt: 'System.',
      tools: [],
    })

    await agent.run('Hi')
    expect(agent.getHistory()).toHaveLength(2)

    agent.clearHistory()
    expect(agent.getHistory()).toHaveLength(0)
  })
})
