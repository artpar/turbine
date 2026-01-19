import { spawn, ChildProcess } from 'child_process'
import { LLMAdapter } from './interpreter.js'

// ═══════════════════════════════════════════════════════════════════════════
// LLM RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolUse {
  tool: string
  input: Record<string, unknown>
  result?: unknown
}

export interface LLMInvokeParams {
  prompt: string
  systemPrompt?: string
  maxTokens: number
  temperature?: number
}

export interface LLMResponse {
  content: string
  toolUses: ToolUse[]
  tokensUsed: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE CODE CLI ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adapter for Claude Code CLI (claude-code or open-code as fallback).
 *
 * Invokes the CLI as a subprocess and captures the response.
 */
export class ClaudeCodeAdapter implements LLMAdapter {
  private cliCommand: string
  private workDir: string

  constructor(options: {
    cliCommand?: string
    workDir: string
  }) {
    this.cliCommand = options.cliCommand ?? 'claude'
    this.workDir = options.workDir
  }

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    const { prompt, systemPrompt, maxTokens } = params

    // Build the CLI command
    const args: string[] = [
      '--print', // Non-interactive mode
      '--output-format', 'json', // JSON output for parsing
    ]

    if (maxTokens) {
      args.push('--max-turns', '1') // Single turn for now
    }

    // Add the prompt
    args.push(prompt)

    return new Promise((resolve, reject) => {
      const proc = spawn(this.cliCommand, args, {
        cwd: this.workDir,
        env: {
          ...process.env,
          // Pass system prompt via environment if supported
          CLAUDE_SYSTEM_PROMPT: systemPrompt ?? '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('error', (error) => {
        reject(new LLMInvocationError(`Failed to spawn CLI: ${error.message}`, error))
      })

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new LLMInvocationError(`CLI exited with code ${code}: ${stderr}`, null))
          return
        }

        try {
          const response = this.parseResponse(stdout)
          resolve(response)
        } catch (error) {
          reject(new LLMInvocationError(`Failed to parse response: ${error}`, error))
        }
      })
    })
  }

  private parseResponse(stdout: string): LLMResponse {
    // Try to parse as JSON first
    try {
      const json = JSON.parse(stdout)

      return {
        content: json.result ?? json.content ?? json.message ?? stdout,
        toolUses: this.extractToolUses(json),
        tokensUsed: json.usage?.total_tokens ?? this.estimateTokens(stdout),
      }
    } catch {
      // Fall back to treating the output as plain text
      return {
        content: stdout.trim(),
        toolUses: [],
        tokensUsed: this.estimateTokens(stdout),
      }
    }
  }

  private extractToolUses(json: unknown): ToolUse[] {
    if (!json || typeof json !== 'object') return []

    const obj = json as Record<string, unknown>

    // Check for tool_uses array
    if (Array.isArray(obj.tool_uses)) {
      return obj.tool_uses.map((tu: unknown) => {
        if (typeof tu !== 'object' || tu === null) {
          return { tool: 'unknown', input: {} }
        }
        const toolUse = tu as Record<string, unknown>
        return {
          tool: String(toolUse.name ?? toolUse.tool ?? 'unknown'),
          input: (toolUse.input ?? toolUse.parameters ?? {}) as Record<string, unknown>,
          result: toolUse.result,
        }
      })
    }

    // Check for content blocks with tool_use type
    if (Array.isArray(obj.content)) {
      return obj.content
        .filter((c: unknown) => {
          if (typeof c !== 'object' || c === null) return false
          return (c as Record<string, unknown>).type === 'tool_use'
        })
        .map((c: unknown) => {
          const block = c as Record<string, unknown>
          return {
            tool: String(block.name ?? 'unknown'),
            input: (block.input ?? {}) as Record<string, unknown>,
          }
        })
    }

    return []
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAMING ADAPTER (for real-time output)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Streaming adapter for real-time LLM output.
 * Useful for showing progress during long generations.
 */
export class StreamingClaudeCodeAdapter implements LLMAdapter {
  private cliCommand: string
  private workDir: string
  private onChunk?: (chunk: string) => void

  constructor(options: {
    cliCommand?: string
    workDir: string
    onChunk?: (chunk: string) => void
  }) {
    this.cliCommand = options.cliCommand ?? 'claude'
    this.workDir = options.workDir
    this.onChunk = options.onChunk
  }

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    const { prompt, systemPrompt } = params

    const args: string[] = [
      '--print',
      prompt,
    ]

    return new Promise((resolve, reject) => {
      const proc = spawn(this.cliCommand, args, {
        cwd: this.workDir,
        env: {
          ...process.env,
          CLAUDE_SYSTEM_PROMPT: systemPrompt ?? '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let fullContent = ''
      const toolUses: ToolUse[] = []

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString()
        fullContent += chunk

        // Emit chunk for streaming display
        if (this.onChunk) {
          this.onChunk(chunk)
        }

        // Try to extract tool uses from streaming output
        this.tryExtractToolUse(chunk, toolUses)
      })

      proc.stderr.on('data', (data: Buffer) => {
        // Log stderr but don't fail
        console.error('[LLM stderr]:', data.toString())
      })

      proc.on('error', (error) => {
        reject(new LLMInvocationError(`Failed to spawn CLI: ${error.message}`, error))
      })

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new LLMInvocationError(`CLI exited with code ${code}`, null))
          return
        }

        resolve({
          content: fullContent.trim(),
          toolUses,
          tokensUsed: Math.ceil(fullContent.length / 4),
        })
      })
    })
  }

  private tryExtractToolUse(chunk: string, toolUses: ToolUse[]): void {
    // Look for tool use patterns in streaming output
    // This is a simplified heuristic - real implementation would need
    // to parse the actual Claude Code output format

    const toolUseMatch = chunk.match(/Running tool: (\w+)/i)
    if (toolUseMatch) {
      toolUses.push({
        tool: toolUseMatch[1]!,
        input: {},
      })
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK ADAPTER (for testing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mock adapter for testing without actual LLM invocation.
 */
export class MockLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[] = []
  private callIndex = 0

  constructor(responses?: LLMResponse[]) {
    if (responses) {
      this.responses = responses
    }
  }

  addResponse(response: LLMResponse): void {
    this.responses.push(response)
  }

  async invoke(_params: LLMInvokeParams): Promise<LLMResponse> {
    if (this.callIndex >= this.responses.length) {
      return {
        content: 'Mock response - no more responses configured',
        toolUses: [],
        tokensUsed: 100,
      }
    }

    const response = this.responses[this.callIndex]!
    this.callIndex++
    return response
  }

  reset(): void {
    this.callIndex = 0
  }

  getCallCount(): number {
    return this.callIndex
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export class LLMInvocationError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown
  ) {
    super(message)
    this.name = 'LLMInvocationError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

export type LLMAdapterType = 'claude-code' | 'streaming' | 'mock'

export function createLLMAdapter(
  type: LLMAdapterType,
  options: {
    workDir: string
    cliCommand?: string
    onChunk?: (chunk: string) => void
    mockResponses?: LLMResponse[]
  }
): LLMAdapter {
  switch (type) {
    case 'claude-code':
      return new ClaudeCodeAdapter({
        workDir: options.workDir,
        cliCommand: options.cliCommand,
      })

    case 'streaming':
      return new StreamingClaudeCodeAdapter({
        workDir: options.workDir,
        cliCommand: options.cliCommand,
        onChunk: options.onChunk,
      })

    case 'mock':
      return new MockLLMAdapter(options.mockResponses)
  }
}
