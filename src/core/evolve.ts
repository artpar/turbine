import {
  State,
  Event,
  ChecklistItem,
  Artifact,
  PHASE_ORDER,
  calculateOverallConfidence,
  hasConverged,
} from './types.js'

/**
 * evolve: (State, Event) → State
 *
 * Pure function that computes the new state by applying an event.
 * No I/O, no side effects, fully deterministic.
 *
 * State is DERIVED from events: State = events.reduce(evolve, initialState)
 */
export function evolve(state: State, event: Event): State {
  switch (event.kind) {
    case 'Initialized':
      return evolveInitialized(state, event)

    case 'PhaseStarted':
      return evolvePhaseStarted(state, event)

    case 'PhaseCompleted':
      return evolvePhaseCompleted(state, event)

    case 'TurnStarted':
      return evolveTurnStarted(state, event)

    case 'TurnCompleted':
      return evolveTurnCompleted(state, event)

    case 'ArtifactCreated':
      return evolveArtifactCreated(state, event)

    case 'ArtifactUpdated':
      return evolveArtifactUpdated(state, event)

    case 'ChecklistItemCompleted':
      return evolveChecklistItemCompleted(state, event)

    case 'TestsPassed':
      return evolveTestsPassed(state, event)

    case 'TestsFailed':
      return evolveTestsFailed(state, event)

    case 'TypeCheckPassed':
      return evolveTypeCheckPassed(state, event)

    case 'TypeCheckFailed':
      return evolveTypeCheckFailed(state, event)

    case 'ConfidenceUpdated':
      return evolveConfidenceUpdated(state, event)

    case 'CheckpointCreated':
      return evolveCheckpointCreated(state, event)

    case 'CheckpointApproved':
      return evolveCheckpointApproved(state, event)

    case 'CheckpointRejected':
      return evolveCheckpointRejected(state, event)

    case 'ConvergenceReached':
      return evolveConvergenceReached(state, event)

    case 'BudgetExhausted':
      return evolveBudgetExhausted(state, event)

    case 'ErrorOccurred':
      return evolveErrorOccurred(state, event)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVOLUTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

function evolveInitialized(
  state: State,
  event: Extract<Event, { kind: 'Initialized' }>
): State {
  return {
    ...state,
    prompt: event.prompt,
    checklist: event.checklist,
    budgets: event.budgets,
    phase: 'requirements',
    turn: 0,
    startedAt: event.timestamp,
    lastActivityAt: event.timestamp,
  }
}

function evolvePhaseStarted(
  state: State,
  event: Extract<Event, { kind: 'PhaseStarted' }>
): State {
  // Update the budget for this phase
  const updatedBudgets = state.budgets.map((b) =>
    b.phase === event.phase ? event.budget : b
  )

  return {
    ...state,
    phase: event.phase,
    budgets: updatedBudgets,
    lastActivityAt: event.timestamp,
  }
}

function evolvePhaseCompleted(
  state: State,
  event: Extract<Event, { kind: 'PhaseCompleted' }>
): State {
  // Mark budget as used
  const updatedBudgets = state.budgets.map((b) =>
    b.phase === event.phase ? { ...b, usedTurns: event.turnsUsed } : b
  )

  // Advance to next phase
  const currentIndex = PHASE_ORDER.indexOf(event.phase)
  const nextPhase = PHASE_ORDER[currentIndex + 1] ?? event.phase

  return {
    ...state,
    phase: nextPhase,
    budgets: updatedBudgets,
    lastActivityAt: event.timestamp,
  }
}

function evolveTurnStarted(
  state: State,
  event: Extract<Event, { kind: 'TurnStarted' }>
): State {
  return {
    ...state,
    turn: event.turn,
    lastActivityAt: event.timestamp,
  }
}

function evolveTurnCompleted(
  state: State,
  event: Extract<Event, { kind: 'TurnCompleted' }>
): State {
  // Increment used turns for current phase
  const updatedBudgets = state.budgets.map((b) =>
    b.phase === event.phase ? { ...b, usedTurns: b.usedTurns + 1 } : b
  )

  return {
    ...state,
    budgets: updatedBudgets,
    lastActivityAt: event.timestamp,
  }
}

function evolveArtifactCreated(
  state: State,
  event: Extract<Event, { kind: 'ArtifactCreated' }>
): State {
  return {
    ...state,
    artifacts: [...state.artifacts, event.artifact],
    lastActivityAt: event.timestamp,
  }
}

function evolveArtifactUpdated(
  state: State,
  event: Extract<Event, { kind: 'ArtifactUpdated' }>
): State {
  const updatedArtifacts = state.artifacts.map((a) =>
    a.id === event.artifactId
      ? { ...a, hash: event.newHash, updatedAt: event.timestamp }
      : a
  )

  return {
    ...state,
    artifacts: updatedArtifacts,
    lastActivityAt: event.timestamp,
  }
}

function evolveChecklistItemCompleted(
  state: State,
  event: Extract<Event, { kind: 'ChecklistItemCompleted' }>
): State {
  const updatedChecklist = state.checklist.map((item) =>
    item.id === event.itemId
      ? {
          ...item,
          completed: true,
          evidence: event.evidence,
          completedAt: event.timestamp,
        }
      : item
  )

  // Recalculate checklist completion
  const checklistComplete = updatedChecklist.every((item) => item.completed)

  const updatedConfidence = {
    ...state.confidence,
    checklistComplete,
  }
  updatedConfidence.overallScore = calculateOverallConfidence(updatedConfidence)

  return {
    ...state,
    checklist: updatedChecklist,
    confidence: updatedConfidence,
    lastActivityAt: event.timestamp,
  }
}

function evolveTestsPassed(
  state: State,
  event: Extract<Event, { kind: 'TestsPassed' }>
): State {
  const updatedConfidence = {
    ...state.confidence,
    testsPass: true,
    coverage: event.result.coverage ?? state.confidence.coverage,
  }
  updatedConfidence.overallScore = calculateOverallConfidence(updatedConfidence)

  // Increment convergence streak on passing tests
  const newStreak = state.convergenceStreak + 1

  return {
    ...state,
    confidence: updatedConfidence,
    convergenceStreak: newStreak,
    converged: hasConverged({ ...state, confidence: updatedConfidence, convergenceStreak: newStreak }),
    lastActivityAt: event.timestamp,
  }
}

function evolveTestsFailed(
  state: State,
  event: Extract<Event, { kind: 'TestsFailed' }>
): State {
  const updatedConfidence = {
    ...state.confidence,
    testsPass: false,
    coverage: event.result.coverage ?? state.confidence.coverage,
  }
  updatedConfidence.overallScore = calculateOverallConfidence(updatedConfidence)

  return {
    ...state,
    confidence: updatedConfidence,
    convergenceStreak: 0, // Reset streak on failure
    lastActivityAt: event.timestamp,
  }
}

function evolveTypeCheckPassed(
  state: State,
  event: Extract<Event, { kind: 'TypeCheckPassed' }>
): State {
  const updatedConfidence = {
    ...state.confidence,
    typesSafe: true,
  }
  updatedConfidence.overallScore = calculateOverallConfidence(updatedConfidence)

  return {
    ...state,
    confidence: updatedConfidence,
    lastActivityAt: event.timestamp,
  }
}

function evolveTypeCheckFailed(
  state: State,
  event: Extract<Event, { kind: 'TypeCheckFailed' }>
): State {
  const updatedConfidence = {
    ...state.confidence,
    typesSafe: false,
  }
  updatedConfidence.overallScore = calculateOverallConfidence(updatedConfidence)

  return {
    ...state,
    confidence: updatedConfidence,
    convergenceStreak: 0, // Reset streak on failure
    lastActivityAt: event.timestamp,
  }
}

function evolveConfidenceUpdated(
  state: State,
  event: Extract<Event, { kind: 'ConfidenceUpdated' }>
): State {
  return {
    ...state,
    confidence: event.confidence,
    converged: hasConverged({ ...state, confidence: event.confidence }),
    lastActivityAt: event.timestamp,
  }
}

function evolveCheckpointCreated(
  state: State,
  event: Extract<Event, { kind: 'CheckpointCreated' }>
): State {
  return {
    ...state,
    pendingCheckpoint: event.summary,
    lastActivityAt: event.timestamp,
  }
}

function evolveCheckpointApproved(
  state: State,
  event: Extract<Event, { kind: 'CheckpointApproved' }>
): State {
  // Only update if the checkpoint matches
  if (state.pendingCheckpoint?.id !== event.checkpointId) {
    return state
  }

  return {
    ...state,
    lastApprovedCheckpoint: state.pendingCheckpoint,
    pendingCheckpoint: undefined,
    lastActivityAt: event.timestamp,
  }
}

function evolveCheckpointRejected(
  state: State,
  event: Extract<Event, { kind: 'CheckpointRejected' }>
): State {
  // Only update if the checkpoint matches
  if (state.pendingCheckpoint?.id !== event.checkpointId) {
    return state
  }

  return {
    ...state,
    pendingCheckpoint: undefined,
    lastActivityAt: event.timestamp,
  }
}

function evolveConvergenceReached(
  state: State,
  event: Extract<Event, { kind: 'ConvergenceReached' }>
): State {
  return {
    ...state,
    converged: true,
    confidence: {
      ...state.confidence,
      overallScore: event.finalConfidence,
    },
    lastActivityAt: event.timestamp,
  }
}

function evolveBudgetExhausted(
  state: State,
  event: Extract<Event, { kind: 'BudgetExhausted' }>
): State {
  const updatedBudgets = state.budgets.map((b) =>
    b.phase === event.phase ? { ...b, usedTurns: event.turnsUsed } : b
  )

  return {
    ...state,
    budgets: updatedBudgets,
    lastActivityAt: event.timestamp,
  }
}

function evolveErrorOccurred(
  state: State,
  event: Extract<Event, { kind: 'ErrorOccurred' }>
): State {
  // Errors don't change state much, just record activity
  return {
    ...state,
    lastActivityAt: event.timestamp,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY UTILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replay a sequence of events to reconstruct state at any point
 */
export function replay(events: Event[], initialState: State): State {
  return events.reduce(evolve, initialState)
}

/**
 * Replay events up to a specific index
 */
export function replayUntil(events: Event[], initialState: State, index: number): State {
  return events.slice(0, index).reduce(evolve, initialState)
}

/**
 * Debug replay with logging each step
 */
export function debugReplay(
  events: Event[],
  initialState: State,
  logger: (step: { index: number; event: Event; stateBefore: State; stateAfter: State }) => void
): State {
  let state = initialState

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    const stateBefore = state
    state = evolve(state, event)
    logger({ index: i, event, stateBefore, stateAfter: state })
  }

  return state
}
