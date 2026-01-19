import { Command, Event, State, createInitialState, hasConverged } from './core/types.js'
import { decide } from './core/decide.js'
import { evolve, replay } from './core/evolve.js'
import { executeEffects, resultToEvents, InterpreterContext, EffectResult } from './shell/interpreter.js'
import { SQLiteEventStore, DefaultSnapshotPolicy } from './persistence/event-log.js'
import { createLLMAdapter, LLMAdapterType } from './shell/llm-adapter.js'
import { createTelemetryAdapter, TelemetryType, AggregatingTelemetryAdapter } from './shell/telemetry.js'
import path from 'path'

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR OPTIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface OrchestratorOptions {
  workDir: string
  prompt: string
  maxTurns?: number
  llmType?: LLMAdapterType
  llmCommand?: string
  telemetryType?: TelemetryType
  dbPath?: string
  checkpointCallback?: (summary: any) => Promise<{ approved: boolean; reason?: string }>
  onProgress?: (state: State, event: Event) => void
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main orchestration loop for Turbine.
 *
 * Implements the Functional Core / Imperative Shell pattern:
 * 1. Process commands through decide() (pure)
 * 2. Execute effects through interpreter (impure)
 * 3. Convert results to events
 * 4. Apply events through evolve() (pure)
 * 5. Persist events
 * 6. Loop until convergence
 */
export class Orchestrator {
  private state: State
  private eventStore: SQLiteEventStore
  private snapshotPolicy: DefaultSnapshotPolicy
  private ctx: InterpreterContext
  private telemetry: AggregatingTelemetryAdapter
  private options: Required<OrchestratorOptions>

  constructor(options: OrchestratorOptions) {
    this.options = {
      maxTurns: 20000,
      llmType: 'claude-code',
      llmCommand: 'claude',
      telemetryType: 'console',
      dbPath: path.join(options.workDir, '.turbine', 'events.db'),
      checkpointCallback: async () => ({ approved: true }),
      onProgress: () => {},
      ...options,
    }

    // Initialize state
    this.state = createInitialState(this.options.prompt)

    // Initialize event store
    this.eventStore = new SQLiteEventStore(this.options.dbPath)
    this.snapshotPolicy = new DefaultSnapshotPolicy(100)

    // Initialize telemetry with aggregation
    const baseTelemetry = createTelemetryAdapter(this.options.telemetryType)
    this.telemetry = new AggregatingTelemetryAdapter(baseTelemetry)

    // Initialize interpreter context
    this.ctx = {
      workDir: this.options.workDir,
      llm: createLLMAdapter(this.options.llmType, {
        workDir: this.options.workDir,
        cliCommand: this.options.llmCommand,
      }),
      telemetry: this.telemetry,
      eventStore: this.eventStore,
      checkpoint: {
        emitCheckpoint: async (summary) => {
          this.telemetry.log('info', 'Checkpoint emitted', summary)
        },
        waitForApproval: async (checkpointId, _timeoutMs) => {
          return this.options.checkpointCallback({ checkpointId })
        },
      },
      testRunner: {
        runTests: async (pattern, coverage) => {
          // TODO: Implement actual test runner
          return {
            passed: true,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            coverage: coverage ? 0 : undefined,
            failures: [],
          }
        },
        checkTypes: async () => {
          // TODO: Implement actual type checker
          return { passed: true, errors: [] }
        },
        validateSchema: async (_schemaPath, _dataPath) => {
          // TODO: Implement actual schema validation
          return { valid: true, errors: [] }
        },
      },
    }
  }

  /**
   * Run the main orchestration loop until convergence or budget exhaustion.
   */
  async run(): Promise<{ state: State; summary: ReturnType<AggregatingTelemetryAdapter['getSummary']> }> {
    this.telemetry.log('info', 'Starting Turbine orchestration', {
      prompt: this.options.prompt.slice(0, 100),
      maxTurns: this.options.maxTurns,
    })

    // Try to resume from existing state
    await this.tryResume()

    // Initialize if fresh start
    if (this.state.turn === 0) {
      await this.processCommand({ kind: 'Initialize', prompt: this.options.prompt })
    }

    // Main loop
    while (!this.shouldStop()) {
      await this.runTurn()
    }

    // Final summary
    const summary = this.telemetry.getSummary()

    this.telemetry.log('info', 'Turbine orchestration complete', {
      finalConfidence: this.state.confidence.overallScore,
      totalTurns: this.state.turn,
      converged: this.state.converged,
      errorCount: summary.errorCount,
    })

    return { state: this.state, summary }
  }

  /**
   * Run a single turn of the orchestration loop.
   */
  private async runTurn(): Promise<void> {
    // 1. Start turn
    await this.processCommand({ kind: 'StartTurn' })

    // Wait for effects to complete (LLM invocation happens here)
    // The effects were already executed in processCommand

    // 2. Check if we should request a checkpoint (every 10 turns or phase change)
    if (this.state.turn % 10 === 0) {
      await this.processCommand({ kind: 'RequestCheckpoint' })
    }

    // 3. Check for phase advancement
    await this.checkPhaseAdvancement()

    // 4. Progress callback
    const latestEvent = await this.getLatestEvent()
    if (latestEvent) {
      this.options.onProgress(this.state, latestEvent)
    }
  }

  /**
   * Process a command through the full cycle:
   * decide() → execute effects → evolve() → persist
   */
  private async processCommand(command: Command): Promise<void> {
    const spanId = this.telemetry.startSpan('command.process', { kind: command.kind })

    try {
      // 1. Decide what effects to produce
      const effects = decide(command, this.state)

      // 2. Execute effects
      const results = await executeEffects(effects, this.ctx)

      // 3. Convert results to events
      const events = this.resultsToEvents(effects, results)

      // 4. Apply events and persist
      for (const event of events) {
        await this.applyEvent(event)
      }

      this.telemetry.endSpan(spanId, 'ok')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.telemetry.endSpan(spanId, 'error', message)

      // Record error event
      await this.applyEvent({
        kind: 'ErrorOccurred',
        message,
        recoverable: true,
        timestamp: new Date(),
      })
    }
  }

  /**
   * Apply an event: evolve state, persist, maybe snapshot.
   */
  private async applyEvent(event: Event): Promise<void> {
    // 1. Evolve state
    this.state = evolve(this.state, event)

    // 2. Persist event
    const eventIndex = await this.eventStore.appendEvent(event)

    // 3. Maybe create snapshot
    if (this.snapshotPolicy.shouldSnapshot(eventIndex, event)) {
      await this.eventStore.createSnapshot(this.state, eventIndex)
    }

    // 4. Record metric
    this.telemetry.recordMetric('events_persisted', 1, { kind: event.kind })
  }

  /**
   * Convert effect results to events.
   */
  private resultsToEvents(effects: readonly any[], results: EffectResult[]): Event[] {
    const events: Event[] = []

    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i]
      const result = results[i]

      if (effect && result) {
        const resultEvents = resultToEvents(effect, result, this.state)
        events.push(...resultEvents)
      }
    }

    return events
  }

  /**
   * Check if we should advance to the next phase.
   */
  private async checkPhaseAdvancement(): Promise<void> {
    const phaseItems = this.state.checklist.filter((i) => i.phase === this.state.phase)
    const allComplete = phaseItems.length > 0 && phaseItems.every((i) => i.completed)

    if (allComplete) {
      await this.processCommand({ kind: 'AdvancePhase' })
    }
  }

  /**
   * Determine if we should stop the orchestration loop.
   */
  private shouldStop(): boolean {
    // Stop if converged
    if (hasConverged(this.state)) {
      this.telemetry.log('info', 'Convergence reached')
      return true
    }

    // Stop if max turns reached
    if (this.state.turn >= this.options.maxTurns) {
      this.telemetry.log('warn', 'Max turns reached', { maxTurns: this.options.maxTurns })
      return true
    }

    // Stop if already marked converged
    if (this.state.converged) {
      return true
    }

    return false
  }

  /**
   * Try to resume from existing event store.
   */
  private async tryResume(): Promise<void> {
    const snapshot = await this.eventStore.getLatestSnapshot()

    if (snapshot) {
      this.telemetry.log('info', 'Resuming from snapshot', {
        atEventIndex: snapshot.atEventIndex,
        turn: snapshot.state.turn,
      })

      // Replay events after snapshot
      const events = await this.eventStore.getEvents(snapshot.atEventIndex + 1)
      this.state = replay(events, snapshot.state)
    }
  }

  /**
   * Get the latest event from the store.
   */
  private async getLatestEvent(): Promise<Event | null> {
    const index = await this.eventStore.getLatestEventIndex()
    if (index === 0) return null

    const events = await this.eventStore.getEvents(index, index)
    return events[0] ?? null
  }

  /**
   * Clean up resources.
   */
  close(): void {
    this.eventStore.close()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export async function runTurbine(options: OrchestratorOptions): Promise<{
  state: State
  summary: ReturnType<AggregatingTelemetryAdapter['getSummary']>
}> {
  const orchestrator = new Orchestrator(options)

  try {
    return await orchestrator.run()
  } finally {
    orchestrator.close()
  }
}
