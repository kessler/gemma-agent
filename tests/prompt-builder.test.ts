import { describe, it, expect } from 'vitest'
import { buildPrompt, appendToolCallAndResponse } from '../src/prompt-builder.js'
import { image, audio } from '../src/types.js'

const TOOL = {
  name: 'read_file',
  description: 'Read a file',
  parameters: {
    type: 'object' as const,
    properties: { path: { type: 'string', description: 'File path' } },
    required: ['path'],
  },
  execute: async () => ({}),
}

describe('buildPrompt', () => {
  it('builds a basic prompt with system and user message', () => {
    const prompt = buildPrompt('You are helpful.', [TOOL], [
      { role: 'user', content: 'Hello' },
    ], false)

    expect(prompt).toContain('<|turn>system\nYou are helpful.')
    expect(prompt).toContain('<|tool>declaration:read_file')
    expect(prompt).toContain('<|turn>user\nHello<turn|>')
    expect(prompt.endsWith('<|turn>model')).toBe(true)
  })

  it('adds think token when thinking enabled', () => {
    const prompt = buildPrompt('System.', [], [
      { role: 'user', content: 'Hi' },
    ], true)

    expect(prompt).toContain('<|think|>System.')
  })

  it('includes tool call and response in history', () => {
    const prompt = buildPrompt('System.', [TOOL], [
      { role: 'user', content: 'Read foo' },
      {
        role: 'model',
        content: '',
        toolCalls: [{ name: 'read_file', arguments: { path: 'foo.txt' } }],
        toolResponses: [{ name: 'read_file', result: { content: 'hello' } }],
      },
    ], false)

    expect(prompt).toContain('<|tool_call>call:read_file{path:<|"|>foo.txt<|"|>}<tool_call|>')
    expect(prompt).toContain('response:read_file{content:<|"|>hello<|"|>}<tool_response|>')
  })
})

describe('appendToolCallAndResponse', () => {
  it('appends tool call and response to existing prompt', () => {
    const result = appendToolCallAndResponse(
      'existing prompt',
      [{ name: 'read_file', arguments: { path: 'a.txt' } }],
      [{ name: 'read_file', result: { content: 'data' } }],
    )

    expect(result.startsWith('existing prompt\n')).toBe(true)
    expect(result).toContain('call:read_file{path:<|"|>a.txt<|"|>}')
    expect(result).toContain('response:read_file{content:<|"|>data<|"|>}')
  })
})

describe('media values in tool responses', () => {
  it('renders ToolResultImage as <|image|> token', () => {
    const result = appendToolCallAndResponse(
      'prompt',
      [{ name: 'screenshot', arguments: {} }],
      [{ name: 'screenshot', result: { screenshot: image('data:image/png;base64,abc') } }],
    )

    expect(result).toContain('screenshot:<|"|><|image|><|"|>')
  })

  it('renders ToolResultAudio as <|audio|> token', () => {
    const result = appendToolCallAndResponse(
      'prompt',
      [{ name: 'record', arguments: {} }],
      [{ name: 'record', result: { recording: audio('data:audio/wav;base64,xyz') } }],
    )

    expect(result).toContain('recording:<|"|><|audio|><|"|>')
  })

  it('renders mixed text and media values', () => {
    const result = appendToolCallAndResponse(
      'prompt',
      [{ name: 'capture', arguments: {} }],
      [{
        name: 'capture',
        result: {
          screenshot: image('data:image/png;base64,abc'),
          width: 1920,
          status: 'ok',
        },
      }],
    )

    expect(result).toContain('screenshot:<|"|><|image|><|"|>')
    expect(result).toContain('width:1920')
    expect(result).toContain('status:<|"|>ok<|"|>')
  })
})
