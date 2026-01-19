// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Scaffolding Module Exports
// ═══════════════════════════════════════════════════════════════════════════

// Spec Parser
export {
  TurbineSpec,
  Entity,
  Field,
  Stack,
  Features,
  CICD,
  ProjectMeta,
  SpecParser,
  specParser,
  SpecParseError,
  getEntityDependencyOrder,
  getEntityFields,
  fieldTypeToTS,
  fieldTypeToZod,
} from './spec-parser.js'

// Generator
export {
  ScaffoldingGenerator,
  GeneratorResult,
  GeneratedFile,
  GapSummary,
  PackageJson,
  writeGeneratedFiles,
  generateFromSpec,
} from './generator.js'

// Adapters
export {
  BackendAdapter,
  ORMAdapter,
  FrontendAdapter,
  AuthAdapter,
  GeneratedCode,
  CodeGap,
  AdapterRegistry,
  adapterRegistry,
  StackAdapters,
} from './adapters/base.js'

// Gap Identifier
export {
  GapType,
  Gap,
  GapContext,
  GapIdentifier,
  LLMPromptBuilder,
  GapFiller,
  GapFillResult,
  createGapIdentifier,
  createGapFiller,
} from './gap-identifier.js'

// Orchestrator
export {
  ScaffoldingOptions,
  ProgressEvent,
  OrchestrationSummary,
  ScaffoldingOrchestrator,
  runScaffolding,
  createProgressLogger,
} from './orchestrator.js'
