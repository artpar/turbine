import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { Effect, Event, State, ArtifactId, Artifact, TestResult } from '../core/types.js'
import { v4 as uuid } from 'uuid'

// ═══════════════════════════════════════════════════════════════════════════
// EFFECT RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EffectResult =
  | { kind: 'LLMResponse'; content: string; toolUses: any[]; tokensUsed: number }
  | { kind: 'FileWritten'; path: string; hash: string }
  | { kind: 'FileRead'; path: string; content: string }
  | { kind: 'FileDeleted'; path: string }
  | { kind: 'DirectoryListed'; path: string; files: string[] }
  | { kind: 'TestsRan'; result: TestResult }
  | { kind: 'TypesChecked'; passed: boolean; errors: string[] }
  | { kind: 'SchemaValidated'; valid: boolean; errors: string[] }
  | { kind: 'SpanStarted'; spanId: string }
  | { kind: 'SpanEnded'; spanId: string }
  | { kind: 'MetricRecorded'; name: string }
  | { kind: 'Logged'; level: string; message: string }
  | { kind: 'CheckpointEmitted'; checkpointId: string }
  | { kind: 'ApprovalReceived'; approved: boolean; reason?: string }
  | { kind: 'EventPersisted'; eventIndex: number }
  | { kind: 'SnapshotCreated'; atEventIndex: number }
  | { kind: 'Void' }

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface LLMAdapter {
  invoke(params: {
    prompt: string
    systemPrompt?: string
    maxTokens: number
    temperature?: number
  }): Promise<{ content: string; toolUses: any[]; tokensUsed: number }>
}

export interface TelemetryAdapter {
  startSpan(name: string, attributes: Record<string, unknown>): string
  endSpan(spanId: string, status: 'ok' | 'error', error?: string): void
  recordMetric(name: string, value: number, tags: Record<string, string>): void
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, context: Record<string, unknown>): void
}

export interface EventStoreAdapter {
  appendEvent(event: Event): Promise<number>
  getEvents(from?: number, to?: number): Promise<Event[]>
  createSnapshot(state: State, atEventIndex: number): Promise<void>
  getLatestSnapshot(): Promise<{ state: State; atEventIndex: number } | null>
}

export interface CheckpointAdapter {
  emitCheckpoint(summary: any): Promise<void>
  waitForApproval(checkpointId: string, timeoutMs: number): Promise<{ approved: boolean; reason?: string }>
}

export interface TestRunnerAdapter {
  runTests(pattern?: string, coverage?: boolean): Promise<TestResult>
  checkTypes(): Promise<{ passed: boolean; errors: string[] }>
  validateSchema(schemaPath: string, dataPath: string): Promise<{ valid: boolean; errors: string[] }>
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERPRETER CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export interface InterpreterContext {
  workDir: string
  llm: LLMAdapter
  telemetry: TelemetryAdapter
  eventStore: EventStoreAdapter
  checkpoint: CheckpointAdapter
  testRunner: TestRunnerAdapter
}

// ═══════════════════════════════════════════════════════════════════════════
// EFFECT INTERPRETER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a single effect and return the result.
 * This is the imperative shell - all I/O happens here.
 */
export async function executeEffect(
  effect: Effect,
  ctx: InterpreterContext
): Promise<EffectResult> {
  const spanId = ctx.telemetry.startSpan(`effect.${effect.kind}`, {
    effectKind: effect.kind,
  })

  const startTime = performance.now()

  try {
    const result = await executeEffectImpl(effect, ctx)

    ctx.telemetry.endSpan(spanId, 'ok')
    ctx.telemetry.recordMetric('effect_duration_ms', performance.now() - startTime, {
      kind: effect.kind,
      status: 'success',
    })

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    ctx.telemetry.endSpan(spanId, 'error', message)
    ctx.telemetry.recordMetric('effect_duration_ms', performance.now() - startTime, {
      kind: effect.kind,
      status: 'error',
    })

    throw error
  }
}

async function executeEffectImpl(
  effect: Effect,
  ctx: InterpreterContext
): Promise<EffectResult> {
  switch (effect.kind) {
    // ─────────────────────────────────────────────────────────────────────
    // LLM Effects
    // ─────────────────────────────────────────────────────────────────────
    case 'InvokeLLM': {
      ctx.telemetry.log('info', 'Invoking LLM', {
        promptLength: effect.prompt.length,
        maxTokens: effect.maxTokens,
      })

      const response = await ctx.llm.invoke({
        prompt: effect.prompt,
        systemPrompt: effect.systemPrompt,
        maxTokens: effect.maxTokens,
        temperature: effect.temperature,
      })

      ctx.telemetry.recordMetric('llm_tokens_used', response.tokensUsed, {})

      return {
        kind: 'LLMResponse',
        content: response.content,
        toolUses: response.toolUses,
        tokensUsed: response.tokensUsed,
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // File System Effects
    // ─────────────────────────────────────────────────────────────────────
    case 'WriteFile': {
      const fullPath = path.resolve(ctx.workDir, effect.path)
      const dir = path.dirname(fullPath)

      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true })

      // Write file
      await fs.writeFile(fullPath, effect.content, 'utf-8')

      // Calculate hash
      const hash = createHash('sha256').update(effect.content).digest('hex')

      ctx.telemetry.log('info', 'File written', { path: effect.path, hash })

      return { kind: 'FileWritten', path: effect.path, hash }
    }

    case 'ReadFile': {
      const fullPath = path.resolve(ctx.workDir, effect.path)
      const content = await fs.readFile(fullPath, 'utf-8')

      return { kind: 'FileRead', path: effect.path, content }
    }

    case 'DeleteFile': {
      const fullPath = path.resolve(ctx.workDir, effect.path)
      await fs.unlink(fullPath)

      ctx.telemetry.log('info', 'File deleted', { path: effect.path })

      return { kind: 'FileDeleted', path: effect.path }
    }

    case 'ListDirectory': {
      const fullPath = path.resolve(ctx.workDir, effect.path)

      const listDir = async (dir: string, recursive: boolean): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const files: string[] = []

        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name)
          const relativePath = path.relative(ctx.workDir, entryPath)

          if (entry.isDirectory()) {
            if (recursive) {
              files.push(...(await listDir(entryPath, true)))
            }
          } else {
            files.push(relativePath)
          }
        }

        return files
      }

      const files = await listDir(fullPath, effect.recursive ?? false)

      return { kind: 'DirectoryListed', path: effect.path, files }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Verification Effects
    // ─────────────────────────────────────────────────────────────────────
    case 'RunTests': {
      const result = await ctx.testRunner.runTests(effect.pattern, effect.coverage)

      ctx.telemetry.recordMetric('tests_total', result.totalTests, {})
      ctx.telemetry.recordMetric('tests_passed', result.passedTests, {})
      ctx.telemetry.recordMetric('tests_failed', result.failedTests, {})

      if (result.coverage !== undefined) {
        ctx.telemetry.recordMetric('coverage', result.coverage, {})
      }

      return { kind: 'TestsRan', result }
    }

    case 'CheckTypes': {
      const result = await ctx.testRunner.checkTypes()

      ctx.telemetry.recordMetric('type_check_passed', result.passed ? 1 : 0, {})

      return { kind: 'TypesChecked', passed: result.passed, errors: result.errors }
    }

    case 'ValidateSchema': {
      const result = await ctx.testRunner.validateSchema(effect.schemaPath, effect.dataPath)

      return { kind: 'SchemaValidated', valid: result.valid, errors: result.errors }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Observability Effects
    // ─────────────────────────────────────────────────────────────────────
    case 'StartSpan': {
      const spanId = ctx.telemetry.startSpan(effect.name, effect.attributes)

      return { kind: 'SpanStarted', spanId }
    }

    case 'EndSpan': {
      ctx.telemetry.endSpan(effect.spanId, effect.status, effect.error)

      return { kind: 'SpanEnded', spanId: effect.spanId }
    }

    case 'RecordMetric': {
      ctx.telemetry.recordMetric(effect.name, effect.value, effect.tags)

      return { kind: 'MetricRecorded', name: effect.name }
    }

    case 'Log': {
      ctx.telemetry.log(effect.level, effect.message, effect.context)

      return { kind: 'Logged', level: effect.level, message: effect.message }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Checkpoint Effects
    // ─────────────────────────────────────────────────────────────────────
    case 'EmitCheckpoint': {
      await ctx.checkpoint.emitCheckpoint(effect.summary)

      return { kind: 'CheckpointEmitted', checkpointId: effect.summary.id }
    }

    case 'WaitForApproval': {
      const result = await ctx.checkpoint.waitForApproval(effect.checkpointId, effect.timeoutMs)

      return { kind: 'ApprovalReceived', approved: result.approved, reason: result.reason }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Persistence Effects
    // ─────────────────────────────────────────────────────────────────────
    case 'PersistEvent': {
      const eventIndex = await ctx.eventStore.appendEvent(effect.event)

      return { kind: 'EventPersisted', eventIndex }
    }

    case 'CreateSnapshot': {
      await ctx.eventStore.createSnapshot(effect.state, effect.atEventIndex)

      return { kind: 'SnapshotCreated', atEventIndex: effect.atEventIndex }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH EFFECT EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute multiple effects in sequence, collecting results.
 * Stops on first error.
 */
export async function executeEffects(
  effects: Effect[],
  ctx: InterpreterContext
): Promise<EffectResult[]> {
  const results: EffectResult[] = []

  for (const effect of effects) {
    const result = await executeEffect(effect, ctx)
    results.push(result)
  }

  return results
}

/**
 * Execute multiple independent effects in parallel where possible.
 * Groups effects by dependency and executes groups in sequence.
 */
export async function executeEffectsParallel(
  effects: Effect[],
  ctx: InterpreterContext
): Promise<EffectResult[]> {
  // For now, simple sequential execution
  // TODO: Implement dependency analysis for parallel execution
  return executeEffects(effects, ctx)
}

// ═══════════════════════════════════════════════════════════════════════════
// EFFECT TO EVENT CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert effect results to events for the event log.
 * This bridges the imperative shell back to the functional core.
 */
export function resultToEvents(
  effect: Effect,
  result: EffectResult,
  state: State
): Event[] {
  const timestamp = new Date()

  switch (result.kind) {
    case 'FileWritten':
      const existingArtifact = state.artifacts.find((a) => a.path === result.path)

      if (existingArtifact) {
        return [{
          kind: 'ArtifactUpdated',
          artifactId: existingArtifact.id,
          newHash: result.hash,
          timestamp,
        }]
      }

      const artifact: Artifact = {
        id: uuid() as ArtifactId,
        path: result.path,
        hash: result.hash,
        phase: state.phase,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      return [{
        kind: 'ArtifactCreated',
        artifact,
        timestamp,
      }]

    case 'TestsRan':
      if (result.result.passed) {
        return [{
          kind: 'TestsPassed',
          result: result.result,
          timestamp,
        }]
      }
      return [{
        kind: 'TestsFailed',
        result: result.result,
        timestamp,
      }]

    case 'TypesChecked':
      if (result.passed) {
        return [{
          kind: 'TypeCheckPassed',
          timestamp,
        }]
      }
      return [{
        kind: 'TypeCheckFailed',
        errors: result.errors,
        timestamp,
      }]

    default:
      return []
  }
}
