import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// BRANDED TYPES - Type-safe identifiers
// ═══════════════════════════════════════════════════════════════════════════

export const TurnId = z.string().uuid().brand<'TurnId'>()
export type TurnId = z.infer<typeof TurnId>

export const CheckpointId = z.string().uuid().brand<'CheckpointId'>()
export type CheckpointId = z.infer<typeof CheckpointId>

export const ArtifactId = z.string().uuid().brand<'ArtifactId'>()
export type ArtifactId = z.infer<typeof ArtifactId>

export const ChecklistItemId = z.string().uuid().brand<'ChecklistItemId'>()
export type ChecklistItemId = z.infer<typeof ChecklistItemId>

// ═══════════════════════════════════════════════════════════════════════════
// PHASE - Waterfall phases for convergence
// ═══════════════════════════════════════════════════════════════════════════

export const Phase = z.enum([
  'requirements',
  'design',
  'implementation',
  'testing',
  'documentation',
  'verification',
])
export type Phase = z.infer<typeof Phase>

export const PHASE_ORDER: readonly Phase[] = [
  'requirements',
  'design',
  'implementation',
  'testing',
  'documentation',
  'verification',
] as const

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN ENTITIES
// ═══════════════════════════════════════════════════════════════════════════

export const ChecklistItem = z.object({
  id: ChecklistItemId,
  phase: Phase,
  description: z.string(),
  completed: z.boolean(),
  evidence: z.string().optional(),
  completedAt: z.date().optional(),
})
export type ChecklistItem = z.infer<typeof ChecklistItem>

export const Artifact = z.object({
  id: ArtifactId,
  path: z.string(),
  hash: z.string(), // SHA-256 of content
  phase: Phase,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type Artifact = z.infer<typeof Artifact>

export const TurnBudget = z.object({
  phase: Phase,
  maxTurns: z.number().int().positive(),
  usedTurns: z.number().int().nonnegative(),
})
export type TurnBudget = z.infer<typeof TurnBudget>

export const TestResult = z.object({
  passed: z.boolean(),
  totalTests: z.number().int().nonnegative(),
  passedTests: z.number().int().nonnegative(),
  failedTests: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(100).optional(),
  failures: z.array(z.object({
    testName: z.string(),
    error: z.string(),
  })),
})
export type TestResult = z.infer<typeof TestResult>

export const LLMResponse = z.object({
  content: z.string(),
  toolUses: z.array(z.object({
    tool: z.string(),
    input: z.record(z.unknown()),
    result: z.unknown().optional(),
  })),
  tokensUsed: z.number().int().nonnegative(),
})
export type LLMResponse = z.infer<typeof LLMResponse>

export const CheckpointSummary = z.object({
  id: CheckpointId,
  phase: Phase,
  turn: z.number().int().nonnegative(),
  checklistProgress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  artifactCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  createdAt: z.date(),
})
export type CheckpointSummary = z.infer<typeof CheckpointSummary>

// ═══════════════════════════════════════════════════════════════════════════
// STATE - The aggregate state of Turbine
// ═══════════════════════════════════════════════════════════════════════════

export const State = z.object({
  // Core state
  phase: Phase,
  turn: z.number().int().nonnegative(),
  prompt: z.string(),

  // Progress tracking
  checklist: z.array(ChecklistItem),
  artifacts: z.array(Artifact),
  budgets: z.array(TurnBudget),

  // Confidence metrics (objective, not inflated)
  confidence: z.object({
    typesSafe: z.boolean(),
    schemaValid: z.boolean(),
    testsPass: z.boolean(),
    coverage: z.number().min(0).max(100),
    checklistComplete: z.boolean(),
    overallScore: z.number().min(0).max(1),
  }),

  // Checkpoint state
  pendingCheckpoint: CheckpointSummary.optional(),
  lastApprovedCheckpoint: CheckpointSummary.optional(),

  // Convergence tracking
  convergenceStreak: z.number().int().nonnegative(), // Consecutive passes
  converged: z.boolean(),

  // Timestamps
  startedAt: z.date(),
  lastActivityAt: z.date(),
})
export type State = z.infer<typeof State>

// ═══════════════════════════════════════════════════════════════════════════
// COMMANDS - Intents (what we want to happen)
// ═══════════════════════════════════════════════════════════════════════════

export const Command = z.discriminatedUnion('kind', [
  // Initialization
  z.object({
    kind: z.literal('Initialize'),
    prompt: z.string(),
    budgets: z.array(TurnBudget).optional(),
  }),

  // Phase transitions
  z.object({
    kind: z.literal('AdvancePhase'),
  }),

  // Turn processing
  z.object({
    kind: z.literal('StartTurn'),
  }),
  z.object({
    kind: z.literal('ProcessLLMResponse'),
    response: LLMResponse,
  }),
  z.object({
    kind: z.literal('RecordArtifact'),
    path: z.string(),
    hash: z.string(),
  }),

  // Verification
  z.object({
    kind: z.literal('RecordTestResult'),
    result: TestResult,
  }),
  z.object({
    kind: z.literal('RecordTypeCheck'),
    passed: z.boolean(),
    errors: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal('CompleteChecklistItem'),
    itemId: ChecklistItemId,
    evidence: z.string(),
  }),

  // Checkpoints
  z.object({
    kind: z.literal('RequestCheckpoint'),
  }),
  z.object({
    kind: z.literal('ApproveCheckpoint'),
  }),
  z.object({
    kind: z.literal('RejectCheckpoint'),
    reason: z.string(),
  }),

  // Error handling
  z.object({
    kind: z.literal('Timeout'),
    phase: Phase,
  }),
  z.object({
    kind: z.literal('Error'),
    message: z.string(),
    recoverable: z.boolean(),
  }),
])
export type Command = z.infer<typeof Command>

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS - Facts (what happened, immutable)
// ═══════════════════════════════════════════════════════════════════════════

export const Event = z.discriminatedUnion('kind', [
  // Initialization
  z.object({
    kind: z.literal('Initialized'),
    prompt: z.string(),
    checklist: z.array(ChecklistItem),
    budgets: z.array(TurnBudget),
    timestamp: z.date(),
  }),

  // Phase transitions
  z.object({
    kind: z.literal('PhaseStarted'),
    phase: Phase,
    budget: TurnBudget,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('PhaseCompleted'),
    phase: Phase,
    turnsUsed: z.number().int().nonnegative(),
    timestamp: z.date(),
  }),

  // Turn events
  z.object({
    kind: z.literal('TurnStarted'),
    turn: z.number().int().nonnegative(),
    phase: Phase,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('TurnCompleted'),
    turn: z.number().int().nonnegative(),
    phase: Phase,
    tokensUsed: z.number().int().nonnegative(),
    timestamp: z.date(),
  }),

  // Artifact events
  z.object({
    kind: z.literal('ArtifactCreated'),
    artifact: Artifact,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('ArtifactUpdated'),
    artifactId: ArtifactId,
    newHash: z.string(),
    timestamp: z.date(),
  }),

  // Checklist events
  z.object({
    kind: z.literal('ChecklistItemCompleted'),
    itemId: ChecklistItemId,
    evidence: z.string(),
    timestamp: z.date(),
  }),

  // Verification events
  z.object({
    kind: z.literal('TestsPassed'),
    result: TestResult,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('TestsFailed'),
    result: TestResult,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('TypeCheckPassed'),
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('TypeCheckFailed'),
    errors: z.array(z.string()),
    timestamp: z.date(),
  }),

  // Confidence events
  z.object({
    kind: z.literal('ConfidenceUpdated'),
    confidence: State.shape.confidence,
    timestamp: z.date(),
  }),

  // Checkpoint events
  z.object({
    kind: z.literal('CheckpointCreated'),
    summary: CheckpointSummary,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('CheckpointApproved'),
    checkpointId: CheckpointId,
    timestamp: z.date(),
  }),
  z.object({
    kind: z.literal('CheckpointRejected'),
    checkpointId: CheckpointId,
    reason: z.string(),
    timestamp: z.date(),
  }),

  // Convergence events
  z.object({
    kind: z.literal('ConvergenceReached'),
    finalConfidence: z.number().min(0).max(1),
    totalTurns: z.number().int().nonnegative(),
    timestamp: z.date(),
  }),

  // Budget events
  z.object({
    kind: z.literal('BudgetExhausted'),
    phase: Phase,
    turnsUsed: z.number().int().nonnegative(),
    timestamp: z.date(),
  }),

  // Error events
  z.object({
    kind: z.literal('ErrorOccurred'),
    message: z.string(),
    recoverable: z.boolean(),
    timestamp: z.date(),
  }),
])
export type Event = z.infer<typeof Event>

// ═══════════════════════════════════════════════════════════════════════════
// EFFECTS - Descriptions of side effects (data, not execution)
// ═══════════════════════════════════════════════════════════════════════════

export const Effect = z.discriminatedUnion('kind', [
  // LLM interaction
  z.object({
    kind: z.literal('InvokeLLM'),
    prompt: z.string(),
    systemPrompt: z.string().optional(),
    maxTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2).optional(),
  }),

  // File system
  z.object({
    kind: z.literal('WriteFile'),
    path: z.string(),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('ReadFile'),
    path: z.string(),
  }),
  z.object({
    kind: z.literal('DeleteFile'),
    path: z.string(),
  }),
  z.object({
    kind: z.literal('ListDirectory'),
    path: z.string(),
    recursive: z.boolean().optional(),
  }),

  // Verification
  z.object({
    kind: z.literal('RunTests'),
    pattern: z.string().optional(),
    coverage: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('CheckTypes'),
  }),
  z.object({
    kind: z.literal('ValidateSchema'),
    schemaPath: z.string(),
    dataPath: z.string(),
  }),

  // Observability
  z.object({
    kind: z.literal('StartSpan'),
    name: z.string(),
    attributes: z.record(z.unknown()),
  }),
  z.object({
    kind: z.literal('EndSpan'),
    spanId: z.string(),
    status: z.enum(['ok', 'error']),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal('RecordMetric'),
    name: z.string(),
    value: z.number(),
    tags: z.record(z.string()),
  }),
  z.object({
    kind: z.literal('Log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
    context: z.record(z.unknown()),
  }),

  // Checkpoints
  z.object({
    kind: z.literal('EmitCheckpoint'),
    summary: CheckpointSummary,
  }),
  z.object({
    kind: z.literal('WaitForApproval'),
    checkpointId: CheckpointId,
    timeoutMs: z.number().int().positive(),
  }),

  // Persistence
  z.object({
    kind: z.literal('PersistEvent'),
    event: Event,
  }),
  z.object({
    kind: z.literal('CreateSnapshot'),
    state: State,
    atEventIndex: z.number().int().nonnegative(),
  }),
])
export type Effect = z.infer<typeof Effect>

// ═══════════════════════════════════════════════════════════════════════════
// INITIAL STATE - Factory function
// ═══════════════════════════════════════════════════════════════════════════

export const createInitialState = (prompt: string): State => ({
  phase: 'requirements',
  turn: 0,
  prompt,
  checklist: [],
  artifacts: [],
  budgets: PHASE_ORDER.map((phase) => ({
    phase,
    maxTurns: getDefaultBudget(phase),
    usedTurns: 0,
  })),
  confidence: {
    typesSafe: false,
    schemaValid: false,
    testsPass: false,
    coverage: 0,
    checklistComplete: false,
    overallScore: 0,
  },
  pendingCheckpoint: undefined,
  lastApprovedCheckpoint: undefined,
  convergenceStreak: 0,
  converged: false,
  startedAt: new Date(),
  lastActivityAt: new Date(),
})

function getDefaultBudget(phase: Phase): number {
  switch (phase) {
    case 'requirements':
      return 50
    case 'design':
      return 100
    case 'implementation':
      return 500
    case 'testing':
      return 200
    case 'documentation':
      return 100
    case 'verification':
      return 50
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIDENCE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

export function calculateOverallConfidence(confidence: State['confidence']): number {
  // Hard gates - must pass
  if (!confidence.typesSafe) return 0
  if (!confidence.schemaValid) return 0
  if (!confidence.testsPass) return 0.3 // Cap at 30% if tests fail

  // Weighted factors
  const coverageScore = Math.min(confidence.coverage / 80, 1) * 0.25
  const checklistScore = confidence.checklistComplete ? 0.25 : 0
  const baseScore = 0.5 // Tests pass = 50% confidence

  return baseScore + coverageScore + checklistScore
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERGENCE CHECK
// ═══════════════════════════════════════════════════════════════════════════

export const CONVERGENCE_THRESHOLD = 0.9
export const CONVERGENCE_STREAK_REQUIRED = 3

export function hasConverged(state: State): boolean {
  return (
    state.confidence.overallScore >= CONVERGENCE_THRESHOLD &&
    state.convergenceStreak >= CONVERGENCE_STREAK_REQUIRED
  )
}
