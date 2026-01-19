// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Scaffolding Orchestrator
// ═══════════════════════════════════════════════════════════════════════════
// Orchestrates scaffolding-first generation: 80% deterministic, 20% LLM

import { promises as fs } from 'fs'
import path from 'path'
import {
  TurbineSpec,
  specParser,
} from './spec-parser.js'
import {
  ScaffoldingGenerator,
  writeGeneratedFiles,
  GeneratorResult,
  GeneratedFile,
} from './generator.js'
import {
  GapIdentifier,
  GapFiller,
  Gap,
  GapFillResult,
} from './gap-identifier.js'

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR OPTIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface ScaffoldingOptions {
  // Input
  prompt?: string          // Natural language prompt (requires LLM to generate spec)
  specPath?: string        // Path to turbine.yaml
  specContent?: string     // Direct spec content

  // Output
  outputDir: string

  // LLM configuration
  llmInvoke?: (prompt: string) => Promise<string>

  // Behavior
  fillGaps?: boolean       // Whether to use LLM to fill gaps (default: true)
  maxGapFills?: number     // Max gaps to fill per run (default: 50)
  dryRun?: boolean         // Don't write files, just return result

  // Callbacks
  onProgress?: (event: ProgressEvent) => void
}

export type ProgressEvent =
  | { type: 'spec-parsed'; spec: TurbineSpec }
  | { type: 'scaffolding-started'; entityCount: number }
  | { type: 'scaffolding-complete'; fileCount: number; gapCount: number }
  | { type: 'gap-fill-started'; gap: Gap; index: number; total: number }
  | { type: 'gap-fill-complete'; result: GapFillResult; index: number; total: number }
  | { type: 'files-written'; count: number; errors: string[] }
  | { type: 'complete'; summary: OrchestrationSummary }

export interface OrchestrationSummary {
  // Spec
  projectName: string
  entityCount: number
  stackSummary: string

  // Generation
  filesGenerated: number
  gapsIdentified: number
  gapsFilled: number
  gapsRemaining: number

  // Output
  filesWritten: number
  writeErrors: string[]

  // Timing
  totalDurationMs: number
  scaffoldingDurationMs: number
  gapFillingDurationMs: number
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAFFOLDING ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

export class ScaffoldingOrchestrator {
  private options: ScaffoldingOptions
  private spec!: TurbineSpec
  private generatorResult!: GeneratorResult
  private gaps: Gap[] = []
  private fillResults: GapFillResult[] = []

  constructor(options: ScaffoldingOptions) {
    this.options = {
      fillGaps: true,
      maxGapFills: 50,
      dryRun: false,
      ...options,
    }
  }

  /**
   * Run the complete scaffolding pipeline
   */
  async run(): Promise<OrchestrationSummary> {
    const startTime = Date.now()
    let scaffoldingDuration = 0
    let gapFillingDuration = 0

    // 1. Get/parse spec
    this.spec = await this.getSpec()
    this.emit({ type: 'spec-parsed', spec: this.spec })

    // 2. Run deterministic scaffolding
    this.emit({ type: 'scaffolding-started', entityCount: this.spec.entities.length })

    const scaffoldStart = Date.now()
    const generator = new ScaffoldingGenerator(this.spec)
    this.generatorResult = await generator.generate()
    scaffoldingDuration = Date.now() - scaffoldStart

    // 3. Identify gaps
    const gapIdentifier = new GapIdentifier(this.spec, this.generatorResult.files)
    this.gaps = await gapIdentifier.identifyGaps()

    this.emit({
      type: 'scaffolding-complete',
      fileCount: this.generatorResult.files.length,
      gapCount: this.gaps.length,
    })

    // 4. Fill gaps with LLM (if enabled and LLM available)
    const gapFillStart = Date.now()
    if (this.options.fillGaps && this.options.llmInvoke && this.gaps.length > 0) {
      await this.fillGaps()
    }
    gapFillingDuration = Date.now() - gapFillStart

    // 5. Apply gap fills to files
    this.applyGapFills()

    // 6. Write files
    let writeResult = { written: 0, errors: [] as string[] }
    if (!this.options.dryRun) {
      writeResult = await writeGeneratedFiles(
        this.generatorResult.files,
        this.options.outputDir
      )
      this.emit({ type: 'files-written', count: writeResult.written, errors: writeResult.errors })
    }

    // 7. Build summary
    const summary: OrchestrationSummary = {
      projectName: this.spec.project.name,
      entityCount: this.spec.entities.length,
      stackSummary: `${this.spec.stack.backend}/${this.spec.stack.orm}/${this.spec.stack.frontend}`,

      filesGenerated: this.generatorResult.files.length,
      gapsIdentified: this.gaps.length,
      gapsFilled: this.fillResults.filter((r) => r.success).length,
      gapsRemaining: this.gaps.length - this.fillResults.filter((r) => r.success).length,

      filesWritten: writeResult.written,
      writeErrors: writeResult.errors,

      totalDurationMs: Date.now() - startTime,
      scaffoldingDurationMs: scaffoldingDuration,
      gapFillingDurationMs: gapFillingDuration,
    }

    this.emit({ type: 'complete', summary })

    return summary
  }

  /**
   * Get or generate spec
   */
  private async getSpec(): Promise<TurbineSpec> {
    // Direct spec content
    if (this.options.specContent) {
      return specParser.parse(this.options.specContent)
    }

    // Spec from file
    if (this.options.specPath) {
      const content = await fs.readFile(this.options.specPath, 'utf-8')
      return specParser.parse(content)
    }

    // Generate spec from prompt
    if (this.options.prompt && this.options.llmInvoke) {
      const specContent = await this.generateSpecFromPrompt(this.options.prompt)
      return specParser.parse(specContent)
    }

    throw new Error('No spec provided: specify specPath, specContent, or prompt with llmInvoke')
  }

  /**
   * Generate turbine.yaml spec from natural language prompt
   */
  private async generateSpecFromPrompt(prompt: string): Promise<string> {
    const llmPrompt = `You are generating a turbine.yaml specification for a software project.

USER REQUEST:
${prompt}

Generate a complete turbine.yaml specification that fulfills this request. The spec should include:
1. Project metadata (name, description, version)
2. Stack choices (backend, frontend, orm, database, auth)
3. Feature flags as appropriate
4. All necessary entities with their fields, types, and relations
5. CI/CD configuration

Output ONLY valid YAML, no explanations.

Example structure:
\`\`\`yaml
specVersion: "1.0"

project:
  name: My Project
  description: A description
  version: "0.1.0"

stack:
  backend: fastify
  frontend: react
  orm: prisma
  database: postgresql
  auth: jwt

features:
  openapi: true
  pagination: true
  # ...

entities:
  - name: User
    fields:
      - name: email
        type: email
        validation:
          required: true
          unique: true
      # ...
\`\`\`

Now generate the spec for the user's request:`

    const response = await this.options.llmInvoke!(llmPrompt)

    // Extract YAML from response (in case LLM wraps it)
    const yamlMatch = response.match(/```yaml\n([\s\S]*?)\n```/) ||
                      response.match(/```\n([\s\S]*?)\n```/)

    return yamlMatch ? yamlMatch[1] : response
  }

  /**
   * Fill gaps using LLM
   */
  private async fillGaps(): Promise<void> {
    const gapFiller = new GapFiller()
    const gapsToFill = this.gaps.slice(0, this.options.maxGapFills)

    for (let i = 0; i < gapsToFill.length; i++) {
      const gap = gapsToFill[i]
      this.emit({ type: 'gap-fill-started', gap, index: i, total: gapsToFill.length })

      const result = await gapFiller.fillGap(gap, this.spec, this.options.llmInvoke!)
      this.fillResults.push(result)

      this.emit({ type: 'gap-fill-complete', result, index: i, total: gapsToFill.length })
    }
  }

  /**
   * Apply gap fills to generated files
   */
  private applyGapFills(): void {
    const gapFiller = new GapFiller()

    // Group fills by file
    const fillsByFile = new Map<string, GapFillResult[]>()
    for (const result of this.fillResults) {
      if (!fillsByFile.has(result.gap.file)) {
        fillsByFile.set(result.gap.file, [])
      }
      fillsByFile.get(result.gap.file)!.push(result)
    }

    // Apply fills to each file
    for (const file of this.generatorResult.files) {
      const fills = fillsByFile.get(file.path)
      if (fills && fills.length > 0) {
        file.content = gapFiller.applyFills(file.content, fills)
      }
    }
  }

  /**
   * Emit progress event
   */
  private emit(event: ProgressEvent): void {
    this.options.onProgress?.(event)
  }

  /**
   * Get generated files (for inspection before writing)
   */
  getFiles(): GeneratedFile[] {
    return this.generatorResult?.files ?? []
  }

  /**
   * Get identified gaps
   */
  getGaps(): Gap[] {
    return this.gaps
  }

  /**
   * Get fill results
   */
  getFillResults(): GapFillResult[] {
    return this.fillResults
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export async function runScaffolding(
  options: ScaffoldingOptions
): Promise<OrchestrationSummary> {
  const orchestrator = new ScaffoldingOrchestrator(options)
  return orchestrator.run()
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

export function createProgressLogger(): (event: ProgressEvent) => void {
  return (event: ProgressEvent) => {
    switch (event.type) {
      case 'spec-parsed':
        console.log(`📋 Spec parsed: ${event.spec.project.name}`)
        console.log(`   Entities: ${event.spec.entities.map((e) => e.name).join(', ')}`)
        break

      case 'scaffolding-started':
        console.log(`\n🏗️  Starting scaffolding for ${event.entityCount} entities...`)
        break

      case 'scaffolding-complete':
        console.log(`✅ Scaffolding complete: ${event.fileCount} files, ${event.gapCount} gaps identified`)
        break

      case 'gap-fill-started':
        console.log(`\n🔧 Filling gap ${event.index + 1}/${event.total}: ${event.gap.file}:${event.gap.line}`)
        break

      case 'gap-fill-complete':
        const status = event.result.success ? '✓' : '✗'
        console.log(`   ${status} ${event.result.success ? 'Filled' : 'Failed'}: ${event.result.gap.context.description.slice(0, 60)}`)
        break

      case 'files-written':
        console.log(`\n📁 Files written: ${event.count}`)
        if (event.errors.length > 0) {
          console.log(`⚠️  Write errors: ${event.errors.length}`)
        }
        break

      case 'complete':
        console.log(`\n════════════════════════════════════════════════════════════`)
        console.log(`📊 Generation Summary`)
        console.log(`════════════════════════════════════════════════════════════`)
        console.log(`Project: ${event.summary.projectName}`)
        console.log(`Stack: ${event.summary.stackSummary}`)
        console.log(`Entities: ${event.summary.entityCount}`)
        console.log(`Files: ${event.summary.filesGenerated} generated, ${event.summary.filesWritten} written`)
        console.log(`Gaps: ${event.summary.gapsIdentified} identified, ${event.summary.gapsFilled} filled, ${event.summary.gapsRemaining} remaining`)
        console.log(`Duration: ${event.summary.totalDurationMs}ms (scaffolding: ${event.summary.scaffoldingDurationMs}ms, gap filling: ${event.summary.gapFillingDurationMs}ms)`)
        break
    }
  }
}
