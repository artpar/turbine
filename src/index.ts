// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Public API
// ═══════════════════════════════════════════════════════════════════════════

// Core types
export {
  // Domain types
  Phase,
  PHASE_ORDER,
  State,
  Command,
  Event,
  Effect,

  // Entity types
  ChecklistItem,
  Artifact,
  TurnBudget,
  TestResult,
  LLMResponse,
  CheckpointSummary,

  // Branded IDs
  TurnId,
  CheckpointId,
  ArtifactId,
  ChecklistItemId,

  // Utilities
  createInitialState,
  calculateOverallConfidence,
  hasConverged,
  CONVERGENCE_THRESHOLD,
  CONVERGENCE_STREAK_REQUIRED,
} from './core/types.js'

// Core logic (pure functions)
export { decide } from './core/decide.js'
export { evolve, replay, replayUntil, debugReplay } from './core/evolve.js'

// Shell (I/O adapters)
export {
  executeEffect,
  executeEffects,
  resultToEvents,
  type InterpreterContext,
  type EffectResult,
  type LLMAdapter,
  type TelemetryAdapter,
  type EventStoreAdapter,
  type CheckpointAdapter,
  type TestRunnerAdapter,
} from './shell/interpreter.js'

export {
  ClaudeCodeAdapter,
  StreamingClaudeCodeAdapter,
  MockLLMAdapter,
  createLLMAdapter,
  LLMInvocationError,
  type LLMAdapterType,
  type ToolUse,
  type LLMInvokeParams,
} from './shell/llm-adapter.js'

export {
  ConsoleTelemetryAdapter,
  OpenTelemetryAdapter,
  NoopTelemetryAdapter,
  AggregatingTelemetryAdapter,
  createTelemetryAdapter,
  type TelemetryType,
} from './shell/telemetry.js'

// Persistence
export {
  SQLiteEventStore,
  DefaultSnapshotPolicy,
  EventLogReader,
  type SnapshotPolicy,
} from './persistence/event-log.js'

// Orchestrator (turn-based)
export {
  Orchestrator,
  runTurbine,
  type OrchestratorOptions,
} from './orchestrator.js'

// Scaffolding (scaffolding-first)
export {
  // Spec Parser
  TurbineSpec,
  Entity,
  Field,
  Stack,
  Features,
  specParser,
  getEntityDependencyOrder,
  getEntityFields,
  fieldTypeToTS,
  fieldTypeToZod,

  // Generator
  ScaffoldingGenerator,
  GeneratorResult,
  GeneratedFile,
  generateFromSpec,

  // Adapters
  adapterRegistry,

  // Gap Handling
  GapIdentifier,
  GapFiller,
  Gap,
  GapFillResult,

  // Scaffolding Orchestrator
  ScaffoldingOrchestrator,
  runScaffolding,
  ScaffoldingOptions,
  OrchestrationSummary,
  createProgressLogger,
} from './scaffolding/index.js'
