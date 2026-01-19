// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Gap Identifier
// ═══════════════════════════════════════════════════════════════════════════
// Identifies TODOs and gaps in generated code for targeted LLM filling

import { promises as fs } from 'fs'
import path from 'path'
import { GapSummary, GeneratedFile } from './generator.js'
import { TurbineSpec, Entity } from './spec-parser.js'

// ═══════════════════════════════════════════════════════════════════════════
// GAP TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type GapType =
  | 'business-logic'  // Custom domain logic in hooks/handlers
  | 'validation'      // Complex validation rules
  | 'transformation'  // Data transformation logic
  | 'test-assertion'  // Test case assertions
  | 'algorithm'       // Complex algorithms
  | 'integration'     // Third-party integration code

export interface Gap {
  id: string
  type: GapType
  file: string
  line: number
  placeholder: string
  context: GapContext
  priority: 'high' | 'medium' | 'low'
}

export interface GapContext {
  // Surrounding code
  before: string[]
  after: string[]

  // Entity context (if applicable)
  entity?: string
  entityFields?: string[]

  // Function context
  functionName?: string
  functionParams?: string[]
  expectedReturn?: string

  // Description and hints
  description: string
  hints: string[]

  // Related files
  relatedFiles: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// GAP IDENTIFIER
// ═══════════════════════════════════════════════════════════════════════════

export class GapIdentifier {
  private spec: TurbineSpec
  private files: GeneratedFile[]
  private gaps: Gap[] = []

  constructor(spec: TurbineSpec, files: GeneratedFile[]) {
    this.spec = spec
    this.files = files
  }

  /**
   * Identify all gaps in generated code
   */
  async identifyGaps(): Promise<Gap[]> {
    for (const file of this.files) {
      // Check for explicitly marked gaps
      if (file.gaps) {
        for (const gap of file.gaps) {
          this.gaps.push(this.buildGap(file, gap))
        }
      }

      // Scan for TODO comments
      this.scanForTodos(file)
    }

    // Sort by priority
    this.gaps.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    return this.gaps
  }

  /**
   * Scan file content for TODO comments
   */
  private scanForTodos(file: GeneratedFile): void {
    const lines = file.content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const todoMatch = line.match(/\/\/\s*TODO:\s*(.+)/)

      if (todoMatch) {
        const todoText = todoMatch[1].trim()
        const gapType = this.inferGapType(todoText)
        const context = this.buildContextFromCode(lines, i, file)

        this.gaps.push({
          id: `${file.path}:${i + 1}`,
          type: gapType,
          file: file.path,
          line: i + 1,
          placeholder: line.trim(),
          context,
          priority: this.inferPriority(gapType, todoText),
        })
      }
    }
  }

  /**
   * Infer gap type from TODO text
   */
  private inferGapType(todoText: string): GapType {
    const lower = todoText.toLowerCase()

    if (lower.includes('business logic') || lower.includes('hook') || lower.includes('before') || lower.includes('after')) {
      return 'business-logic'
    }
    if (lower.includes('validation') || lower.includes('validate')) {
      return 'validation'
    }
    if (lower.includes('transform') || lower.includes('convert') || lower.includes('map')) {
      return 'transformation'
    }
    if (lower.includes('test') || lower.includes('assertion') || lower.includes('expect')) {
      return 'test-assertion'
    }
    if (lower.includes('algorithm') || lower.includes('calculate') || lower.includes('compute')) {
      return 'algorithm'
    }
    if (lower.includes('integrate') || lower.includes('api') || lower.includes('external')) {
      return 'integration'
    }

    return 'business-logic'
  }

  /**
   * Infer priority from gap type and text
   */
  private inferPriority(type: GapType, text: string): 'high' | 'medium' | 'low' {
    // Test assertions are lower priority (nice to have)
    if (type === 'test-assertion') return 'low'

    // Business logic and validation are high priority
    if (type === 'business-logic' || type === 'validation') return 'high'

    // Keywords indicating importance
    if (text.toLowerCase().includes('critical') || text.toLowerCase().includes('required')) {
      return 'high'
    }
    if (text.toLowerCase().includes('optional')) {
      return 'low'
    }

    return 'medium'
  }

  /**
   * Build context from surrounding code
   */
  private buildContextFromCode(
    lines: string[],
    lineIndex: number,
    file: GeneratedFile
  ): GapContext {
    const contextLines = 10
    const before = lines.slice(Math.max(0, lineIndex - contextLines), lineIndex)
    const after = lines.slice(lineIndex + 1, lineIndex + 1 + contextLines)

    // Try to find function context
    const { functionName, functionParams, expectedReturn } = this.extractFunctionContext(before)

    // Try to find entity context
    const entity = this.extractEntityFromPath(file.path)
    const entityDef = entity ? this.spec.entities.find((e) => e.name === entity) : undefined

    return {
      before,
      after,
      entity,
      entityFields: entityDef?.fields.map((f) => f.name),
      functionName,
      functionParams,
      expectedReturn,
      description: this.generateDescription(file.path, lineIndex, lines[lineIndex]),
      hints: this.generateHints(file.path, lineIndex, before, after),
      relatedFiles: this.findRelatedFiles(file.path, entity),
    }
  }

  /**
   * Extract function context from code before TODO
   */
  private extractFunctionContext(before: string[]): {
    functionName?: string
    functionParams?: string[]
    expectedReturn?: string
  } {
    // Look for function declaration
    const functionPattern = /(?:async\s+)?(?:function\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/

    for (let i = before.length - 1; i >= 0; i--) {
      const match = before[i].match(functionPattern)
      if (match) {
        return {
          functionName: match[1],
          functionParams: match[2].split(',').map((p) => p.trim()).filter(Boolean),
          expectedReturn: match[3]?.trim(),
        }
      }
    }

    return {}
  }

  /**
   * Extract entity name from file path
   */
  private extractEntityFromPath(filePath: string): string | undefined {
    // Match patterns like "user.routes.ts", "UserForm.tsx", etc.
    const patterns = [
      /\/(\w+)\.routes\.ts$/,
      /\/(\w+)\.repository\.ts$/,
      /\/(\w+)\.test\.ts$/,
      /\/(\w+)List\.tsx$/,
      /\/(\w+)Form\.tsx$/,
      /\/(\w+)Detail\.tsx$/,
      /\/use(\w+)\.ts$/,
    ]

    for (const pattern of patterns) {
      const match = filePath.match(pattern)
      if (match) {
        const name = match[1]
        // Find matching entity (case-insensitive)
        const entity = this.spec.entities.find(
          (e) => e.name.toLowerCase() === name.toLowerCase()
        )
        return entity?.name
      }
    }

    return undefined
  }

  /**
   * Generate description for the gap
   */
  private generateDescription(
    filePath: string,
    _lineIndex: number,
    todoLine: string
  ): string {
    const todoText = todoLine.replace(/\/\/\s*TODO:\s*/, '').trim()

    if (filePath.includes('.routes.')) {
      return `Implement ${todoText} in route handler`
    }
    if (filePath.includes('.repository.')) {
      return `Implement ${todoText} in repository method`
    }
    if (filePath.includes('.test.')) {
      return `Add ${todoText} for comprehensive test coverage`
    }
    if (filePath.endsWith('Form.tsx')) {
      return `Implement ${todoText} in form component`
    }

    return todoText
  }

  /**
   * Generate hints for filling the gap
   */
  private generateHints(
    filePath: string,
    _lineIndex: number,
    before: string[],
    _after: string[]
  ): string[] {
    const hints: string[] = []

    // Check for common patterns
    if (before.some((l) => l.includes('validate'))) {
      hints.push('Consider using Zod for validation')
    }
    if (before.some((l) => l.includes('async'))) {
      hints.push('Remember to handle async errors')
    }
    if (filePath.includes('.test.')) {
      hints.push('Use descriptive test names that explain the expected behavior')
      hints.push('Test both success and failure cases')
    }
    if (filePath.includes('.routes.')) {
      hints.push('Ensure proper error handling with RFC 9457 Problem Details')
      hints.push('Consider authorization checks')
    }

    return hints
  }

  /**
   * Find files related to this gap
   */
  private findRelatedFiles(filePath: string, entity?: string): string[] {
    const related: string[] = []

    if (entity) {
      const entityLower = entity.toLowerCase()

      // Find related entity files
      for (const file of this.files) {
        if (file.path === filePath) continue

        if (
          file.path.toLowerCase().includes(entityLower) ||
          file.path.includes(entity)
        ) {
          related.push(file.path)
        }
      }
    }

    // Find test file for source file
    if (!filePath.includes('.test.')) {
      const testPath = filePath.replace(/\.ts$/, '.test.ts')
      if (this.files.some((f) => f.path === testPath)) {
        related.push(testPath)
      }
    }

    return related.slice(0, 5) // Limit to 5 related files
  }

  /**
   * Build a Gap from explicit gap metadata
   */
  private buildGap(file: GeneratedFile, gapSummary: GapSummary): Gap {
    const lines = file.content.split('\n')
    const lineIndex = Math.max(0, gapSummary.location.line - 1)
    const context = this.buildContextFromCode(lines, lineIndex, file)

    return {
      id: `${file.path}:${gapSummary.location.line}`,
      type: gapSummary.type as GapType,
      file: file.path,
      line: gapSummary.location.line,
      placeholder: gapSummary.location.placeholder,
      context: {
        ...context,
        description: gapSummary.context,
        hints: gapSummary.hint ? [gapSummary.hint, ...context.hints] : context.hints,
      },
      priority: this.inferPriority(gapSummary.type as GapType, gapSummary.context),
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export class LLMPromptBuilder {
  /**
   * Build a prompt for LLM to fill a specific gap
   */
  buildPrompt(gap: Gap, spec: TurbineSpec): string {
    const entityContext = gap.context.entity
      ? this.buildEntityContext(gap.context.entity, spec)
      : ''

    return `You are implementing a specific piece of code in a TypeScript project.

## Context

**File**: ${gap.file}
**Line**: ${gap.line}
**Type**: ${gap.type}
**Description**: ${gap.context.description}

${entityContext}

## Code Before
\`\`\`typescript
${gap.context.before.join('\n')}
\`\`\`

## Placeholder to Replace
\`\`\`typescript
${gap.placeholder}
\`\`\`

## Code After
\`\`\`typescript
${gap.context.after.join('\n')}
\`\`\`

${gap.context.functionName ? `## Function Context
- Name: ${gap.context.functionName}
- Parameters: ${gap.context.functionParams?.join(', ') ?? 'none'}
- Expected Return: ${gap.context.expectedReturn ?? 'void'}` : ''}

## Hints
${gap.context.hints.map((h) => `- ${h}`).join('\n')}

## Related Files
${gap.context.relatedFiles.map((f) => `- ${f}`).join('\n')}

## Instructions

Replace the TODO placeholder with working TypeScript code. Requirements:
1. Keep the code minimal and focused on the specific task
2. Follow existing code patterns visible in the context
3. Use proper TypeScript types
4. Handle errors appropriately
5. Do NOT add comments explaining the code (it should be self-explanatory)

Output ONLY the replacement code, no explanations or markdown.`
  }

  /**
   * Build entity context section
   */
  private buildEntityContext(entityName: string, spec: TurbineSpec): string {
    const entity = spec.entities.find((e) => e.name === entityName)
    if (!entity) return ''

    const fields = entity.fields
      .map((f) => `  - ${f.name}: ${f.type}${f.validation?.required ? ' (required)' : ''}`)
      .join('\n')

    return `## Entity: ${entityName}
${entity.description ?? ''}

Fields:
${fields}
`
  }

  /**
   * Build a batch prompt for multiple related gaps
   */
  buildBatchPrompt(gaps: Gap[], spec: TurbineSpec): string {
    const gapSections = gaps.map((gap, i) => `### Gap ${i + 1}: ${gap.file}:${gap.line}
${this.buildPrompt(gap, spec)}`).join('\n\n---\n\n')

    return `You are implementing multiple pieces of code in a TypeScript project.
Fill each gap with working code following the instructions.

${gapSections}`
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GAP FILLER
// ═══════════════════════════════════════════════════════════════════════════

export interface GapFillResult {
  gap: Gap
  code: string
  success: boolean
  error?: string
}

export class GapFiller {
  private promptBuilder = new LLMPromptBuilder()

  /**
   * Fill a single gap using LLM
   */
  async fillGap(
    gap: Gap,
    spec: TurbineSpec,
    llmInvoke: (prompt: string) => Promise<string>
  ): Promise<GapFillResult> {
    try {
      const prompt = this.promptBuilder.buildPrompt(gap, spec)
      const code = await llmInvoke(prompt)

      return {
        gap,
        code: code.trim(),
        success: true,
      }
    } catch (error) {
      return {
        gap,
        code: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Apply filled gaps to file content
   */
  applyFills(content: string, fills: GapFillResult[]): string {
    // Sort fills by line number in descending order to apply from bottom to top
    const sortedFills = [...fills]
      .filter((f) => f.success)
      .sort((a, b) => b.gap.line - a.gap.line)

    const lines = content.split('\n')

    for (const fill of sortedFills) {
      const lineIndex = fill.gap.line - 1
      if (lineIndex >= 0 && lineIndex < lines.length) {
        // Replace the TODO line with the filled code
        const indent = lines[lineIndex].match(/^(\s*)/)?.[1] ?? ''
        const indentedCode = fill.code
          .split('\n')
          .map((l) => indent + l)
          .join('\n')

        lines[lineIndex] = indentedCode
      }
    }

    return lines.join('\n')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export function createGapIdentifier(
  spec: TurbineSpec,
  files: GeneratedFile[]
): GapIdentifier {
  return new GapIdentifier(spec, files)
}

export function createGapFiller(): GapFiller {
  return new GapFiller()
}
