#!/usr/bin/env node

import { promises as fs } from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { runTurbine, OrchestratorOptions } from './orchestrator.js'
import { State } from './core/types.js'
import {
  runScaffolding,
  createProgressLogger,
  ScaffoldingOptions,
} from './scaffolding/index.js'

// ═══════════════════════════════════════════════════════════════════════════
// CLI ARGUMENT PARSING
// ═══════════════════════════════════════════════════════════════════════════

interface CLIArgs {
  prompt: string
  workDir: string
  maxTurns: number
  llmCommand: string
  verbose: boolean
  help: boolean
  mode: 'scaffold' | 'turns'  // scaffold = scaffolding-first, turns = original turn-based
  specPath?: string           // Path to turbine.yaml
  fillGaps: boolean           // Whether to fill gaps with LLM
  dryRun: boolean             // Don't write files
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    prompt: '',
    workDir: process.cwd(),
    maxTurns: 20000,
    llmCommand: 'claude',
    verbose: false,
    help: false,
    mode: 'scaffold',  // Default to scaffolding-first
    fillGaps: true,
    dryRun: false,
  }

  const positionalArgs: string[] = []

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!

    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true
    } else if (arg === '--work-dir' || arg === '-w') {
      args.workDir = argv[++i] ?? args.workDir
    } else if (arg === '--max-turns' || arg === '-m') {
      args.maxTurns = parseInt(argv[++i] ?? '20000', 10)
    } else if (arg === '--llm' || arg === '-l') {
      args.llmCommand = argv[++i] ?? args.llmCommand
    } else if (arg === '--spec' || arg === '-s') {
      args.specPath = argv[++i]
    } else if (arg === '--mode') {
      const mode = argv[++i]
      if (mode === 'scaffold' || mode === 'turns') {
        args.mode = mode
      }
    } else if (arg === '--no-fill') {
      args.fillGaps = false
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (!arg.startsWith('-')) {
      positionalArgs.push(arg)
    }
  }

  // First positional arg is the prompt
  args.prompt = positionalArgs.join(' ')

  return args
}

function printHelp(): void {
  console.log(`
Turbine - Autonomous Software Generation Engine

USAGE:
  turbine [OPTIONS] <PROMPT>
  turbine --spec turbine.yaml
  turbine "Build a REST API for managing todos with user authentication"

MODES:
  scaffold (default)  Scaffolding-first: 80% deterministic generation, LLM fills gaps
  turns               Turn-based: LLM-driven generation through phases

OPTIONS:
  -h, --help              Show this help message
  -v, --verbose           Enable verbose logging
  -w, --work-dir <DIR>    Working directory for generated project (default: current dir)
  -s, --spec <FILE>       Path to turbine.yaml specification file
  --mode <MODE>           Generation mode: scaffold or turns (default: scaffold)
  --no-fill               Skip LLM gap filling (scaffold mode only)
  --dry-run               Don't write files, just show what would be generated

TURN-BASED OPTIONS:
  -m, --max-turns <N>     Maximum LLM turns (default: 20000)
  -l, --llm <CMD>         LLM CLI command (default: claude)

EXAMPLES:
  # Scaffold from a spec file (fastest, most predictable)
  turbine --spec turbine.yaml

  # Generate from prompt with scaffolding-first approach
  turbine "Build a REST API for a todo list with user authentication"

  # Generate without LLM gap filling (just scaffolding)
  turbine --no-fill "Build a REST API for a todo list"

  # Use turn-based mode for complex/custom projects
  turbine --mode turns "Build a realtime collaborative document editor"

  # Dry run to preview generated files
  turbine --dry-run --spec turbine.yaml

SCAFFOLDING MODE:
  1. Parses spec (turbine.yaml) or generates one from prompt
  2. Deterministically generates 80% of code (routes, schemas, repos, UI, tests)
  3. Identifies gaps (business logic, test assertions)
  4. Uses LLM only to fill specific gaps

TURN-BASED MODE:
  1. Requirements - Extract and refine requirements from prompt
  2. Design       - Create system architecture and interfaces
  3. Implementation - Write the actual code
  4. Testing      - Write and run tests
  5. Documentation - Create README and API docs
  6. Verification - Final validation and checks

SPEC FILE FORMAT (turbine.yaml):
  specVersion: "1.0"
  project:
    name: My Project
    description: A REST API
  stack:
    backend: fastify
    frontend: react
    orm: prisma
    database: postgresql
  entities:
    - name: User
      fields:
        - name: email
          type: email
          validation: { required: true, unique: true }
`)
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM ADAPTER FOR SCAFFOLDING
// ═══════════════════════════════════════════════════════════════════════════

function createLLMInvoker(command: string): (prompt: string) => Promise<string> {
  return async (prompt: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const child = spawn(command, ['--print', '-p', prompt], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`LLM command failed with code ${code}: ${stderr}`))
        }
      })

      child.on('error', reject)
    })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS DISPLAY (TURN-BASED)
// ═══════════════════════════════════════════════════════════════════════════

function formatProgress(state: State): string {
  const phase = state.phase.toUpperCase().padEnd(15)
  const turn = `Turn ${state.turn}`.padEnd(10)
  const confidence = `${(state.confidence.overallScore * 100).toFixed(1)}%`.padStart(6)

  const checklistDone = state.checklist.filter((i) => i.completed).length
  const checklistTotal = state.checklist.length
  const checklist = `[${checklistDone}/${checklistTotal}]`

  const artifacts = `${state.artifacts.length} files`

  return `${phase} ${turn} Confidence: ${confidence} Checklist: ${checklist} Artifacts: ${artifacts}`
}

function printProgressBar(progress: number, width: number = 40): string {
  const filled = Math.round(progress * width)
  const empty = width - filled
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (!args.prompt && !args.specPath) {
    console.error('Error: No prompt or spec file provided')
    console.error('Usage: turbine <PROMPT> or turbine --spec <FILE>')
    console.error('Try: turbine --help')
    process.exit(1)
  }

  // Ensure work directory exists
  await fs.mkdir(args.workDir, { recursive: true })

  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                              TURBINE                                        ║
║                    Autonomous Software Generation                           ║
╚════════════════════════════════════════════════════════════════════════════╝
`)

  if (args.mode === 'scaffold') {
    await runScaffoldMode(args)
  } else {
    await runTurnMode(args)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAFFOLD MODE
// ═══════════════════════════════════════════════════════════════════════════

async function runScaffoldMode(args: CLIArgs): Promise<void> {
  console.log(`Mode: Scaffolding-First (80% deterministic, 20% LLM)`)
  console.log(`Output: ${args.workDir}`)
  if (args.specPath) {
    console.log(`Spec: ${args.specPath}`)
  } else {
    console.log(`Prompt: ${args.prompt.slice(0, 60)}${args.prompt.length > 60 ? '...' : ''}`)
  }
  console.log(`Fill Gaps: ${args.fillGaps ? 'Yes' : 'No'}`)
  console.log(`Dry Run: ${args.dryRun ? 'Yes' : 'No'}`)
  console.log('')

  const options: ScaffoldingOptions = {
    outputDir: args.workDir,
    specPath: args.specPath,
    prompt: args.specPath ? undefined : args.prompt,
    fillGaps: args.fillGaps,
    dryRun: args.dryRun,
    onProgress: args.verbose ? createProgressLogger() : undefined,
  }

  // Add LLM invoker if needed
  if (!args.specPath || args.fillGaps) {
    options.llmInvoke = createLLMInvoker(args.llmCommand)
  }

  try {
    const summary = await runScaffolding(options)

    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                           GENERATION COMPLETE                               ║
╚════════════════════════════════════════════════════════════════════════════╝

📊 Summary:
   Project: ${summary.projectName}
   Stack: ${summary.stackSummary}
   Entities: ${summary.entityCount}

📁 Files:
   Generated: ${summary.filesGenerated}
   Written: ${summary.filesWritten}
   ${summary.writeErrors.length > 0 ? `Errors: ${summary.writeErrors.length}` : ''}

🔧 Gaps:
   Identified: ${summary.gapsIdentified}
   Filled: ${summary.gapsFilled}
   Remaining: ${summary.gapsRemaining}

⏱️  Duration:
   Total: ${summary.totalDurationMs}ms
   Scaffolding: ${summary.scaffoldingDurationMs}ms
   Gap Filling: ${summary.gapFillingDurationMs}ms
`)

    if (summary.gapsRemaining > 0) {
      console.log(`
💡 ${summary.gapsRemaining} gaps remain unfilled. Look for TODO comments in generated code.
   Run again with --fill-gaps to use LLM, or fill them manually.
`)
    }

    if (args.dryRun) {
      console.log('🔍 Dry run complete. No files were written.')
    } else {
      console.log(`✅ Project generated in: ${args.workDir}`)
      console.log(`
Next steps:
  cd ${args.workDir}
  npm install
  npx prisma migrate dev
  npm run dev
`)
    }

    process.exit(summary.writeErrors.length > 0 ? 1 : 0)
  } catch (error) {
    console.error('\n❌ Error during generation:', error)
    process.exit(1)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TURN-BASED MODE
// ═══════════════════════════════════════════════════════════════════════════

async function runTurnMode(args: CLIArgs): Promise<void> {
  console.log(`Mode: Turn-Based (LLM-driven phases)`)
  console.log(`Prompt: ${args.prompt.slice(0, 60)}${args.prompt.length > 60 ? '...' : ''}`)
  console.log(`Work Dir: ${args.workDir}`)
  console.log(`Max Turns: ${args.maxTurns}`)
  console.log(`LLM: ${args.llmCommand}`)
  console.log('')

  // Create .turbine directory for metadata
  const turbineDir = path.join(args.workDir, '.turbine')
  await fs.mkdir(turbineDir, { recursive: true })

  const startTime = Date.now()
  let lastProgressTime = Date.now()

  const options: OrchestratorOptions = {
    workDir: args.workDir,
    prompt: args.prompt,
    maxTurns: args.maxTurns,
    llmCommand: args.llmCommand,
    telemetryType: args.verbose ? 'console' : 'console',
    onProgress: (state, _event) => {
      const now = Date.now()
      // Rate limit progress output to every 5 seconds
      if (now - lastProgressTime >= 5000) {
        lastProgressTime = now
        const progress = formatProgress(state)
        const bar = printProgressBar(state.confidence.overallScore)
        console.log(`${bar} ${progress}`)
      }
    },
    checkpointCallback: async (summary) => {
      console.log('\n🚩 Checkpoint reached:')
      console.log(`   Phase: ${summary.phase}`)
      console.log(`   Turn: ${summary.turn}`)
      console.log(`   Confidence: ${(summary.confidence * 100).toFixed(1)}%`)

      // Auto-approve for now (could prompt user in interactive mode)
      return { approved: true }
    },
  }

  try {
    console.log('\n🚀 Starting generation...\n')

    const { state, summary } = await runTurbine(options)

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                           GENERATION COMPLETE                               ║
╚════════════════════════════════════════════════════════════════════════════╝

📊 Final Status:
   Phase: ${state.phase}
   Turns: ${state.turn}
   Converged: ${state.converged ? '✅ Yes' : '❌ No'}
   Confidence: ${(state.confidence.overallScore * 100).toFixed(1)}%
   Duration: ${duration}s

📝 Checklist:
   Completed: ${state.checklist.filter((i) => i.completed).length}/${state.checklist.length}

📁 Artifacts:
   Files created: ${state.artifacts.length}
${state.artifacts.slice(0, 10).map((a) => `   - ${a.path}`).join('\n')}
${state.artifacts.length > 10 ? `   ... and ${state.artifacts.length - 10} more` : ''}

📈 Metrics:
   Total events: ${summary.metrics.get('events_persisted')?.sum ?? 0}
   Errors: ${summary.errorCount}
   Warnings: ${summary.warnCount}
`)

    if (state.converged) {
      console.log('✅ Generation successful! Your project is ready in:', args.workDir)
      process.exit(0)
    } else {
      console.log('⚠️  Generation did not fully converge. Review the output and run again if needed.')
      process.exit(1)
    }
  } catch (error) {
    console.error('\n❌ Error during generation:', error)
    process.exit(1)
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
