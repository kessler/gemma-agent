# 🤖 @kessler/gemma-agent

Agent reasoning loop with tool calling for Gemma 4 models. Handles prompt construction, tool call parsing, execution, and multi-turn conversation management.

This module is model-backend agnostic — bring your own `ModelBackend` implementation (Node.js with onnxruntime, browser with WebGPU, etc).

## Install

```bash
npm install @kessler/gemma-agent
```

## Usage

```ts
import { Agent } from '@kessler/gemma-agent'

const agent = new Agent({
  model: myModelBackend, // implements ModelBackend
  systemPrompt: 'You are a helpful assistant.',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from disk',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const content = await fs.readFile(args.path as string, 'utf-8')
        return { content }
      },
    },
  ],
})

const result = await agent.run('What is in package.json?')
console.log(result.response)
```

## ModelBackend

Implement this interface to plug in your model:

```ts
interface ModelBackend {
  generateRaw(prompt: string, options?: GenerateOptions): Promise<string>
  countTokens(text: string): number
  readonly contextLimit: number
  abort(): void
}

interface GenerateOptions {
  maxTokens?: number
  onChunk?: (text: string) => void
  onThinkingChunk?: (text: string) => void
  media?: MediaAttachment[]
}
```

## Multimodal Tool Results

Tools can return images and audio alongside text data using the `image()` and `audio()` factory functions:

```ts
import { image, audio } from '@kessler/gemma-agent'

const screenshotTool = {
  name: 'take_screenshot',
  description: 'Capture a screenshot of the current page',
  execute: async () => ({
    screenshot: image('data:image/png;base64,...'),
    width: 1920,
    height: 1080,
  }),
}

const recordTool = {
  name: 'record_audio',
  description: 'Record audio from the microphone',
  execute: async () => ({
    recording: audio('data:audio/wav;base64,...'),
    duration: '3.2s',
  }),
}
```

Media values are rendered as `<|image|>` / `<|audio|>` tokens in the prompt and routed through the multimodal processor path via `GenerateOptions.media`. The model sees the actual image/audio content, while the text prompt stays compact.

## Agent Options

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `ModelBackend` | required | Model backend instance |
| `systemPrompt` | `string` | required | System prompt |
| `tools` | `ToolDefinition[]` | required | Available tools |
| `maxIterations` | `number` | `10` | Max tool call loop iterations |
| `thinking` | `boolean` | `false` | Enable thinking/reasoning mode |
| `logger` | `Logger` | no-op | Optional logger (`debug`, `info`, `warn`, `error`) |
| `onChunk` | `(text: string) => void` | — | Streaming text callback |
| `onThinkingChunk` | `(text: string) => void` | — | Streaming thinking callback |
| `onToolCall` | `(call: ToolCall) => void` | — | Called when a tool is invoked |
| `onToolResponse` | `(resp: ToolResponse) => void` | — | Called when a tool returns |

## Agent Methods

```ts
agent.run(userMessage: string): Promise<AgentRunResult>
agent.abort(): void
agent.clearHistory(): void
agent.getHistory(): ConversationMessage[]
agent.updateOptions(partial: { thinking?: boolean, maxIterations?: number }): void
```

## Parser & Lexer

The module also exports lower-level utilities for working with Gemma 4 model output directly:

```ts
import {
  parseToolCalls,   // extract ToolCall[] from raw model output
  hasToolCalls,     // quick check for <|tool_call> token
  extractThinking,  // separate thinking content from the rest
  extractFinalResponse, // strip all special tokens, return clean text
  tokenize,         // single-pass lexer for Gemma 4 special tokens
} from '@kessler/gemma-agent'
```

The parser handles both JSON-format arguments (`{"key":"value"}`) and Gemma's custom format with `<|"|>` string delimiters.

## License

Apache-2.0
