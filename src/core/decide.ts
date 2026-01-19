import { v4 as uuid } from 'uuid'
import {
  Command,
  Effect,
  State,
  Phase,
  PHASE_ORDER,
  CheckpointSummary,
  CheckpointId,
  TurnBudget,
  calculateOverallConfidence,
  CONVERGENCE_THRESHOLD,
  hasConverged,
} from './types.js'

/**
 * decide: (Command, State) → Effect[]
 *
 * Pure function that determines what effects should happen based on
 * the current state and incoming command. No I/O, no side effects.
 */
export function decide(command: Command, state: State): Effect[] {
  switch (command.kind) {
    case 'Initialize':
      return decideInitialize(command, state)

    case 'AdvancePhase':
      return decideAdvancePhase(state)

    case 'StartTurn':
      return decideStartTurn(state)

    case 'ProcessLLMResponse':
      return decideProcessLLMResponse(command, state)

    case 'RecordArtifact':
      return decideRecordArtifact(command, state)

    case 'RecordTestResult':
      return decideRecordTestResult(command, state)

    case 'RecordTypeCheck':
      return decideRecordTypeCheck(command, state)

    case 'CompleteChecklistItem':
      return decideCompleteChecklistItem(command, state)

    case 'RequestCheckpoint':
      return decideRequestCheckpoint(state)

    case 'ApproveCheckpoint':
      return decideApproveCheckpoint(state)

    case 'RejectCheckpoint':
      return decideRejectCheckpoint(command, state)

    case 'Timeout':
      return decideTimeout(command, state)

    case 'Error':
      return decideError(command, state)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DECISION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function decideInitialize(
  command: Extract<Command, { kind: 'Initialize' }>,
  state: State
): Effect[] {
  // Already initialized - no-op
  if (state.turn > 0 || state.checklist.length > 0) {
    return [log('warn', 'Attempted to initialize already-started session', { turn: state.turn })]
  }

  const effects: Effect[] = [
    log('info', 'Initializing Turbine session', { promptLength: command.prompt.length }),
    startSpan('turbine.session', { prompt: command.prompt.slice(0, 100) }),
  ]

  // First, we need to invoke LLM to extract requirements checklist from the prompt
  effects.push({
    kind: 'InvokeLLM',
    prompt: buildRequirementsExtractionPrompt(command.prompt),
    systemPrompt: REQUIREMENTS_EXTRACTION_SYSTEM_PROMPT,
    maxTokens: 4000,
  })

  return effects
}

function decideAdvancePhase(state: State): Effect[] {
  const currentIndex = PHASE_ORDER.indexOf(state.phase)
  const nextPhase = PHASE_ORDER[currentIndex + 1]

  // Already at final phase
  if (!nextPhase) {
    return [log('info', 'Already at final phase, checking convergence', { phase: state.phase })]
  }

  // Check if current phase is complete
  const phaseChecklistComplete = isPhaseChecklistComplete(state, state.phase)
  if (!phaseChecklistComplete) {
    return [
      log('warn', 'Cannot advance phase - checklist incomplete', {
        phase: state.phase,
        incomplete: getIncompleteItems(state, state.phase),
      }),
    ]
  }

  return [
    log('info', 'Advancing to next phase', { from: state.phase, to: nextPhase }),
    recordMetric('phase_completed', 1, { phase: state.phase }),
  ]
}

function decideStartTurn(state: State): Effect[] {
  // Check if converged
  if (hasConverged(state)) {
    return [
      log('info', 'Session converged - no more turns needed', {
        confidence: state.confidence.overallScore,
        streak: state.convergenceStreak,
      }),
    ]
  }

  // Check budget
  const budget = state.budgets.find((b) => b.phase === state.phase)
  if (budget && budget.usedTurns >= budget.maxTurns) {
    return [
      log('warn', 'Budget exhausted for phase', { phase: state.phase, used: budget.usedTurns }),
      recordMetric('budget_exhausted', 1, { phase: state.phase }),
    ]
  }

  const effects: Effect[] = [
    startSpan('turbine.turn', { turn: state.turn + 1, phase: state.phase }),
    log('info', 'Starting turn', { turn: state.turn + 1, phase: state.phase }),
  ]

  // Build prompt based on current phase and state
  const prompt = buildPhasePrompt(state)

  effects.push({
    kind: 'InvokeLLM',
    prompt,
    systemPrompt: getPhaseSystemPrompt(state.phase),
    maxTokens: 8000,
  })

  return effects
}

function decideProcessLLMResponse(
  command: Extract<Command, { kind: 'ProcessLLMResponse' }>,
  state: State
): Effect[] {
  const effects: Effect[] = [
    log('info', 'Processing LLM response', {
      turn: state.turn,
      tokensUsed: command.response.tokensUsed,
      toolUseCount: command.response.toolUses.length,
    }),
    recordMetric('tokens_used', command.response.tokensUsed, { phase: state.phase }),
  ]

  // Process tool uses from the LLM response
  for (const toolUse of command.response.toolUses) {
    if (toolUse.tool === 'write_file' && typeof toolUse.input === 'object' && toolUse.input !== null) {
      const input = toolUse.input as { path?: string; content?: string }
      if (input.path && input.content) {
        effects.push({
          kind: 'WriteFile',
          path: input.path,
          content: input.content,
        })
      }
    }
  }

  // After implementation phase, trigger verification
  if (state.phase === 'implementation' || state.phase === 'testing') {
    effects.push({ kind: 'RunTests', coverage: true })
    effects.push({ kind: 'CheckTypes' })
  }

  return effects
}

function decideRecordArtifact(
  command: Extract<Command, { kind: 'RecordArtifact' }>,
  state: State
): Effect[] {
  const existingArtifact = state.artifacts.find((a) => a.path === command.path)

  if (existingArtifact) {
    return [
      log('info', 'Artifact updated', { path: command.path, newHash: command.hash }),
      recordMetric('artifact_updated', 1, { phase: state.phase }),
    ]
  }

  return [
    log('info', 'Artifact created', { path: command.path, hash: command.hash }),
    recordMetric('artifact_created', 1, { phase: state.phase }),
  ]
}

function decideRecordTestResult(
  command: Extract<Command, { kind: 'RecordTestResult' }>,
  state: State
): Effect[] {
  const { result } = command
  const effects: Effect[] = [
    log('info', 'Test results recorded', {
      passed: result.passed,
      total: result.totalTests,
      failed: result.failedTests,
      coverage: result.coverage,
    }),
    recordMetric('tests_total', result.totalTests, { phase: state.phase }),
    recordMetric('tests_passed', result.passedTests, { phase: state.phase }),
    recordMetric('tests_failed', result.failedTests, { phase: state.phase }),
  ]

  if (result.coverage !== undefined) {
    effects.push(recordMetric('coverage', result.coverage, { phase: state.phase }))
  }

  // Update confidence after test results
  const newConfidence = {
    ...state.confidence,
    testsPass: result.passed,
    coverage: result.coverage ?? state.confidence.coverage,
  }
  newConfidence.overallScore = calculateOverallConfidence(newConfidence)

  effects.push(recordMetric('confidence', newConfidence.overallScore, { phase: state.phase }))

  return effects
}

function decideRecordTypeCheck(
  command: Extract<Command, { kind: 'RecordTypeCheck' }>,
  state: State
): Effect[] {
  const effects: Effect[] = [
    log('info', 'Type check result', { passed: command.passed }),
    recordMetric('type_check_passed', command.passed ? 1 : 0, { phase: state.phase }),
  ]

  if (!command.passed && command.errors) {
    effects.push(
      log('warn', 'Type errors found', { count: command.errors.length, errors: command.errors.slice(0, 5) })
    )
  }

  return effects
}

function decideCompleteChecklistItem(
  command: Extract<Command, { kind: 'CompleteChecklistItem' }>,
  state: State
): Effect[] {
  const item = state.checklist.find((i) => i.id === command.itemId)

  if (!item) {
    return [log('warn', 'Checklist item not found', { itemId: command.itemId })]
  }

  if (item.completed) {
    return [log('info', 'Checklist item already completed', { itemId: command.itemId })]
  }

  return [
    log('info', 'Checklist item completed', {
      itemId: command.itemId,
      description: item.description,
      evidence: command.evidence.slice(0, 100),
    }),
    recordMetric('checklist_item_completed', 1, { phase: item.phase }),
  ]
}

function decideRequestCheckpoint(state: State): Effect[] {
  // Already have a pending checkpoint
  if (state.pendingCheckpoint) {
    return [
      log('warn', 'Checkpoint already pending', { checkpointId: state.pendingCheckpoint.id }),
    ]
  }

  const checklistCompleted = state.checklist.filter((i) => i.completed).length
  const checklistTotal = state.checklist.length

  const summary: CheckpointSummary = {
    id: uuid() as CheckpointId,
    phase: state.phase,
    turn: state.turn,
    checklistProgress: {
      completed: checklistCompleted,
      total: checklistTotal,
    },
    artifactCount: state.artifacts.length,
    confidence: state.confidence.overallScore,
    createdAt: new Date(),
  }

  return [
    log('info', 'Checkpoint requested', { summary }),
    { kind: 'EmitCheckpoint', summary },
    { kind: 'WaitForApproval', checkpointId: summary.id, timeoutMs: 300000 }, // 5 minute timeout
  ]
}

function decideApproveCheckpoint(state: State): Effect[] {
  if (!state.pendingCheckpoint) {
    return [log('warn', 'No pending checkpoint to approve')]
  }

  return [
    log('info', 'Checkpoint approved', { checkpointId: state.pendingCheckpoint.id }),
    recordMetric('checkpoint_approved', 1, { phase: state.phase }),
  ]
}

function decideRejectCheckpoint(
  command: Extract<Command, { kind: 'RejectCheckpoint' }>,
  state: State
): Effect[] {
  if (!state.pendingCheckpoint) {
    return [log('warn', 'No pending checkpoint to reject')]
  }

  return [
    log('warn', 'Checkpoint rejected', {
      checkpointId: state.pendingCheckpoint.id,
      reason: command.reason,
    }),
    recordMetric('checkpoint_rejected', 1, { phase: state.phase }),
  ]
}

function decideTimeout(
  command: Extract<Command, { kind: 'Timeout' }>,
  state: State
): Effect[] {
  return [
    log('error', 'Phase timeout', { phase: command.phase, turn: state.turn }),
    recordMetric('phase_timeout', 1, { phase: command.phase }),
  ]
}

function decideError(
  command: Extract<Command, { kind: 'Error' }>,
  state: State
): Effect[] {
  return [
    log('error', command.message, { recoverable: command.recoverable, turn: state.turn }),
    recordMetric('errors_total', 1, { phase: state.phase, recoverable: String(command.recoverable) }),
  ]
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {}
): Effect {
  return { kind: 'Log', level, message, context }
}

function startSpan(name: string, attributes: Record<string, unknown>): Effect {
  return { kind: 'StartSpan', name, attributes }
}

function recordMetric(name: string, value: number, tags: Record<string, string>): Effect {
  return { kind: 'RecordMetric', name, value, tags }
}

function isPhaseChecklistComplete(state: State, phase: Phase): boolean {
  const phaseItems = state.checklist.filter((i) => i.phase === phase)
  return phaseItems.length > 0 && phaseItems.every((i) => i.completed)
}

function getIncompleteItems(state: State, phase: Phase): string[] {
  return state.checklist
    .filter((i) => i.phase === phase && !i.completed)
    .map((i) => i.description)
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

const REQUIREMENTS_EXTRACTION_SYSTEM_PROMPT = `You are an expert software architect. Your task is to analyze a project description and extract a structured checklist of requirements.

For each requirement, identify:
1. The phase it belongs to (requirements, design, implementation, testing, documentation, verification)
2. A clear, actionable description
3. How completion can be verified

Output a JSON array of checklist items.`

function buildRequirementsExtractionPrompt(projectPrompt: string): string {
  return `Analyze this project description and extract a comprehensive checklist of requirements:

PROJECT DESCRIPTION:
${projectPrompt}

Extract requirements for ALL phases:
- requirements: What must the software do? User stories, acceptance criteria
- design: System architecture, component interfaces, data models
- implementation: Code files to create, features to implement
- testing: Test coverage, test types, edge cases
- documentation: README, API docs, user guides
- verification: Final checks, integration tests, deployment readiness

Output as JSON array:
[
  {
    "phase": "requirements",
    "description": "User can create an account with email and password",
    "verification": "Registration endpoint returns 201 with user object"
  },
  ...
]`
}

function buildPhasePrompt(state: State): string {
  const incompleteItems = state.checklist
    .filter((i) => i.phase === state.phase && !i.completed)
    .map((i) => `- [ ] ${i.description}`)
    .join('\n')

  const completedItems = state.checklist
    .filter((i) => i.phase === state.phase && i.completed)
    .map((i) => `- [x] ${i.description}`)
    .join('\n')

  const artifacts = state.artifacts
    .filter((a) => a.phase === state.phase)
    .map((a) => `- ${a.path}`)
    .join('\n')

  return `CURRENT PHASE: ${state.phase.toUpperCase()}
TURN: ${state.turn}
CONFIDENCE: ${(state.confidence.overallScore * 100).toFixed(1)}%

ORIGINAL PROJECT PROMPT:
${state.prompt}

CHECKLIST FOR THIS PHASE:
Completed:
${completedItems || '(none)'}

Remaining:
${incompleteItems || '(all complete)'}

ARTIFACTS CREATED:
${artifacts || '(none yet)'}

Your task: Complete the remaining checklist items for this phase. Write code, create files, and make progress.`
}

function getPhaseSystemPrompt(phase: Phase): string {
  switch (phase) {
    case 'requirements':
      return `You are analyzing and refining requirements. Focus on:
- Clarifying ambiguous requirements
- Identifying missing requirements
- Breaking down complex requirements into smaller, testable items
Do NOT write code yet.`

    case 'design':
      return `You are designing the system architecture. Focus on:
- Component interfaces (TypeScript types)
- Data models (Zod schemas)
- API contracts (OpenAPI-compatible)
- File/folder structure
Create type definitions and interfaces, not implementations.`

    case 'implementation':
      return `You are implementing the software. Focus on:
- One file at a time
- Following the design from previous phase
- Writing clean, testable code
- Using the established types and interfaces`

    case 'testing':
      return `You are writing and running tests. Focus on:
- Property-based tests for core logic
- Unit tests for edge cases
- Integration tests for component interactions
- Achieving meaningful coverage (not 100% for its own sake)`

    case 'documentation':
      return `You are writing documentation. Focus on:
- README with setup instructions
- API documentation
- Code comments for complex logic only
- Examples and usage patterns`

    case 'verification':
      return `You are verifying the complete system. Focus on:
- All tests pass
- Types are sound
- Documentation is complete
- System runs end-to-end
Report any issues found.`
  }
}
