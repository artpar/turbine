// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Template Engine
// ═══════════════════════════════════════════════════════════════════════════
// EJS-based template engine with frontmatter for conditional generation

import { promises as fs } from 'fs'
import path from 'path'
import ejs from 'ejs'
import * as yaml from 'yaml'
import {
  TurbineSpec,
  Entity,
  Field,
  Stack,
  Features,
  getEntityFields,
  fieldTypeToTS,
  fieldTypeToZod,
} from './spec-parser.js'

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE FRONTMATTER
// ═══════════════════════════════════════════════════════════════════════════

export interface TemplateFrontmatter {
  // Output path (can use EJS expressions)
  output: string

  // Conditions for when to generate this file
  when?: {
    stack?: Partial<Stack>
    features?: Partial<Features>
    hasEntities?: boolean
    custom?: string // EJS expression that evaluates to boolean
  }

  // Whether this is an entity template (generated per-entity)
  perEntity?: boolean

  // File overwrite behavior
  overwrite?: 'always' | 'never' | 'ifEmpty'

  // Dependencies (other templates that must be generated first)
  dependsOn?: string[]
}

export interface ParsedTemplate {
  frontmatter: TemplateFrontmatter
  content: string
  sourcePath: string
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

export interface TemplateContext {
  // Spec data
  spec: TurbineSpec
  project: TurbineSpec['project']
  stack: TurbineSpec['stack']
  features: TurbineSpec['features']
  entities: Entity[]
  cicd: TurbineSpec['cicd']

  // Current entity (when rendering perEntity templates)
  entity?: Entity
  fields?: Field[]

  // Helper functions
  h: TemplateHelpers
}

export interface TemplateHelpers {
  // String transformations
  camelCase: (str: string) => string
  pascalCase: (str: string) => string
  snakeCase: (str: string) => string
  kebabCase: (str: string) => string
  capitalize: (str: string) => string
  plural: (str: string) => string
  singular: (str: string) => string

  // Type conversions
  tsType: (field: Field) => string
  zodSchema: (field: Field) => string
  prismaType: (field: Field) => string
  drizzleType: (field: Field) => string

  // Entity helpers
  getFields: (entity: Entity) => Field[]
  getRelations: (entity: Entity) => Field[]
  getPrimaryKey: (entity: Entity) => Field
  getSearchableFields: (entity: Entity) => Field[]

  // Code generation helpers
  indent: (str: string, spaces: number) => string
  quote: (str: string) => string
  jsonStringify: (obj: unknown) => string

  // Conditional helpers
  ifStack: (stack: Partial<Stack>, content: string) => string
  ifFeature: (feature: keyof Features, content: string) => string
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export class TemplateEngine {
  private templates: Map<string, ParsedTemplate> = new Map()
  private templatesDir: string

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir
  }

  /**
   * Load all templates from the templates directory
   */
  async loadTemplates(): Promise<void> {
    await this.loadTemplatesRecursive(this.templatesDir)
  }

  private async loadTemplatesRecursive(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await this.loadTemplatesRecursive(fullPath)
      } else if (entry.name.endsWith('.ejs')) {
        const template = await this.parseTemplate(fullPath)
        const relativePath = path.relative(this.templatesDir, fullPath)
        this.templates.set(relativePath, template)
      }
    }
  }

  /**
   * Parse a template file with frontmatter
   */
  private async parseTemplate(filePath: string): Promise<ParsedTemplate> {
    const content = await fs.readFile(filePath, 'utf-8')
    const { frontmatter, body } = this.extractFrontmatter(content)

    return {
      frontmatter,
      content: body,
      sourcePath: filePath,
    }
  }

  /**
   * Extract YAML frontmatter from template content
   */
  private extractFrontmatter(content: string): { frontmatter: TemplateFrontmatter; body: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
    const match = content.match(frontmatterRegex)

    if (!match) {
      throw new TemplateError(`Template missing frontmatter: must start with ---`)
    }

    // Note: yaml is imported at top of file
    const yaml = require('yaml')
    const frontmatter = yaml.parse(match[1]) as TemplateFrontmatter
    const body = match[2]

    if (!frontmatter.output) {
      throw new TemplateError(`Template frontmatter missing required 'output' field`)
    }

    return { frontmatter, body }
  }

  /**
   * Generate all files from spec
   */
  async generate(spec: TurbineSpec, outputDir: string): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = []
    const context = this.createContext(spec)

    // Sort templates by dependencies
    const sortedTemplates = this.sortByDependencies([...this.templates.entries()])

    for (const [templatePath, template] of sortedTemplates) {
      // Check if template should be generated
      if (!this.shouldGenerate(template.frontmatter, context)) {
        continue
      }

      if (template.frontmatter.perEntity) {
        // Generate once per entity
        for (const entity of spec.entities) {
          const entityContext = {
            ...context,
            entity,
            fields: getEntityFields(entity),
          }
          const file = await this.renderTemplate(template, entityContext, outputDir)
          if (file) files.push(file)
        }
      } else {
        // Generate once
        const file = await this.renderTemplate(template, context, outputDir)
        if (file) files.push(file)
      }
    }

    return files
  }

  /**
   * Check if a template should be generated based on conditions
   */
  private shouldGenerate(frontmatter: TemplateFrontmatter, context: TemplateContext): boolean {
    const { when } = frontmatter
    if (!when) return true

    // Check stack conditions
    if (when.stack) {
      for (const [key, value] of Object.entries(when.stack)) {
        if (context.stack[key as keyof Stack] !== value) {
          return false
        }
      }
    }

    // Check feature conditions
    if (when.features) {
      for (const [key, value] of Object.entries(when.features)) {
        if (context.features[key as keyof Features] !== value) {
          return false
        }
      }
    }

    // Check entity conditions
    if (when.hasEntities !== undefined) {
      if (when.hasEntities && context.entities.length === 0) return false
      if (!when.hasEntities && context.entities.length > 0) return false
    }

    // Check custom expression
    if (when.custom) {
      try {
        const result = ejs.render(`<%= ${when.custom} %>`, context)
        if (result.trim() !== 'true') return false
      } catch {
        return false
      }
    }

    return true
  }

  /**
   * Render a single template
   */
  private async renderTemplate(
    template: ParsedTemplate,
    context: TemplateContext,
    outputDir: string
  ): Promise<GeneratedFile | null> {
    try {
      // Render output path
      const outputPath = ejs.render(template.frontmatter.output, context)
      const fullPath = path.join(outputDir, outputPath)

      // Check overwrite policy
      if (template.frontmatter.overwrite === 'never') {
        try {
          await fs.access(fullPath)
          return null // File exists, skip
        } catch {
          // File doesn't exist, continue
        }
      }

      // Render content
      const content = ejs.render(template.content, context, {
        filename: template.sourcePath,
      })

      return {
        path: outputPath,
        fullPath,
        content,
        template: template.sourcePath,
      }
    } catch (error) {
      throw new TemplateError(
        `Failed to render template ${template.sourcePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Create template context with helpers
   */
  private createContext(spec: TurbineSpec): TemplateContext {
    return {
      spec,
      project: spec.project,
      stack: spec.stack,
      features: spec.features,
      entities: spec.entities,
      cicd: spec.cicd,
      h: this.createHelpers(spec),
    }
  }

  /**
   * Create helper functions for templates
   */
  private createHelpers(spec: TurbineSpec): TemplateHelpers {
    return {
      // String transformations
      camelCase: (str: string) =>
        str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toLowerCase()),

      pascalCase: (str: string) =>
        str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (c) => c.toUpperCase()),

      snakeCase: (str: string) =>
        str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/-/g, '_'),

      kebabCase: (str: string) =>
        str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '').replace(/_/g, '-'),

      capitalize: (str: string) => str.charAt(0).toUpperCase() + str.slice(1),

      plural: (str: string) => {
        if (str.endsWith('y')) return str.slice(0, -1) + 'ies'
        if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh'))
          return str + 'es'
        return str + 's'
      },

      singular: (str: string) => {
        if (str.endsWith('ies')) return str.slice(0, -3) + 'y'
        if (str.endsWith('es')) return str.slice(0, -2)
        if (str.endsWith('s')) return str.slice(0, -1)
        return str
      },

      // Type conversions
      tsType: fieldTypeToTS,
      zodSchema: fieldTypeToZod,

      prismaType: (field: Field) => {
        switch (field.type) {
          case 'string':
            return 'String'
          case 'text':
            return 'String'
          case 'email':
            return 'String'
          case 'url':
            return 'String'
          case 'number':
            return 'Float'
          case 'integer':
            return 'Int'
          case 'boolean':
            return 'Boolean'
          case 'date':
            return 'DateTime'
          case 'datetime':
            return 'DateTime'
          case 'uuid':
            return 'String'
          case 'json':
            return 'Json'
          case 'enum':
            return field.name + 'Enum'
          case 'relation':
            return field.relation?.target ?? 'String'
          default:
            return 'String'
        }
      },

      drizzleType: (field: Field) => {
        switch (field.type) {
          case 'string':
            return 'varchar'
          case 'text':
            return 'text'
          case 'email':
            return 'varchar'
          case 'url':
            return 'varchar'
          case 'number':
            return 'real'
          case 'integer':
            return 'integer'
          case 'boolean':
            return 'boolean'
          case 'date':
            return 'date'
          case 'datetime':
            return 'timestamp'
          case 'uuid':
            return 'uuid'
          case 'json':
            return 'jsonb'
          case 'enum':
            return 'varchar'
          case 'relation':
            return 'uuid'
          default:
            return 'varchar'
        }
      },

      // Entity helpers
      getFields: getEntityFields,

      getRelations: (entity: Entity) => entity.fields.filter((f) => f.type === 'relation'),

      getPrimaryKey: (entity: Entity) =>
        entity.fields.find((f) => f.name === 'id') ?? { name: 'id', type: 'uuid' },

      getSearchableFields: (entity: Entity) => entity.fields.filter((f) => f.searchable),

      // Code generation helpers
      indent: (str: string, spaces: number) =>
        str
          .split('\n')
          .map((line) => ' '.repeat(spaces) + line)
          .join('\n'),

      quote: (str: string) => `'${str}'`,

      jsonStringify: (obj: unknown) => JSON.stringify(obj, null, 2),

      // Conditional helpers
      ifStack: (stack: Partial<Stack>, content: string) => {
        for (const [key, value] of Object.entries(stack)) {
          if (spec.stack[key as keyof Stack] !== value) return ''
        }
        return content
      },

      ifFeature: (feature: keyof Features, content: string) => {
        return spec.features[feature] ? content : ''
      },
    }
  }

  /**
   * Sort templates by dependencies (topological sort)
   */
  private sortByDependencies(
    templates: [string, ParsedTemplate][]
  ): [string, ParsedTemplate][] {
    const sorted: [string, ParsedTemplate][] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const templateMap = new Map(templates)

    const visit = (name: string) => {
      if (visited.has(name)) return
      if (visiting.has(name)) {
        throw new TemplateError(`Circular dependency in templates involving ${name}`)
      }

      const template = templateMap.get(name)
      if (!template) return

      visiting.add(name)

      for (const dep of template.frontmatter.dependsOn ?? []) {
        visit(dep)
      }

      visiting.delete(name)
      visited.add(name)
      sorted.push([name, template])
    }

    for (const [name] of templates) {
      visit(name)
    }

    return sorted
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATED FILE
// ═══════════════════════════════════════════════════════════════════════════

export interface GeneratedFile {
  path: string // Relative path
  fullPath: string // Absolute path
  content: string
  template: string // Source template
}

// ═══════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE WRITER
// ═══════════════════════════════════════════════════════════════════════════

export class FileWriter {
  async writeFiles(files: GeneratedFile[]): Promise<WriteResult> {
    const results: WriteResult = {
      written: [],
      skipped: [],
      errors: [],
    }

    for (const file of files) {
      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(file.fullPath), { recursive: true })

        // Write file
        await fs.writeFile(file.fullPath, file.content, 'utf-8')
        results.written.push(file.path)
      } catch (error) {
        results.errors.push({
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return results
  }
}

export interface WriteResult {
  written: string[]
  skipped: string[]
  errors: Array<{ path: string; error: string }>
}
