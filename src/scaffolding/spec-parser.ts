// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Spec Parser
// ═══════════════════════════════════════════════════════════════════════════
// Parses turbine.yaml specifications into typed AST for deterministic generation

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// FIELD TYPES
// ═══════════════════════════════════════════════════════════════════════════

const FieldTypeSchema = z.enum([
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'uuid',
  'email',
  'url',
  'json',
  'enum',
  'relation',
])

export type FieldType = z.infer<typeof FieldTypeSchema>

const ValidationRuleSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.unknown().optional(),
})

export type ValidationRule = z.infer<typeof ValidationRuleSchema>

const RelationTypeSchema = z.enum(['hasOne', 'hasMany', 'belongsTo', 'manyToMany'])
export type RelationType = z.infer<typeof RelationTypeSchema>

const RelationConfigSchema = z.object({
  type: RelationTypeSchema,
  target: z.string(),
  foreignKey: z.string().optional(),
  through: z.string().optional(), // For manyToMany
  onDelete: z.enum(['cascade', 'setNull', 'restrict', 'noAction']).optional(),
})

export type RelationConfig = z.infer<typeof RelationConfigSchema>

const FieldSchema = z.object({
  name: z.string(),
  type: FieldTypeSchema,
  validation: ValidationRuleSchema.optional(),
  enumValues: z.array(z.string()).optional(), // For enum type
  relation: RelationConfigSchema.optional(), // For relation type
  description: z.string().optional(),
  searchable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
})

export type Field = z.infer<typeof FieldSchema>

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const EntityOperationSchema = z.enum(['create', 'read', 'update', 'delete', 'list', 'search'])
export type EntityOperation = z.infer<typeof EntityOperationSchema>

const EntitySchema = z.object({
  name: z.string(),
  plural: z.string().optional(),
  tableName: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FieldSchema),
  operations: z.array(EntityOperationSchema).default(['create', 'read', 'update', 'delete', 'list']),
  timestamps: z.boolean().default(true),
  softDelete: z.boolean().default(false),
  audit: z.boolean().default(false),
  hooks: z
    .object({
      beforeCreate: z.string().optional(),
      afterCreate: z.string().optional(),
      beforeUpdate: z.string().optional(),
      afterUpdate: z.string().optional(),
      beforeDelete: z.string().optional(),
      afterDelete: z.string().optional(),
    })
    .optional(),
})

export type Entity = z.infer<typeof EntitySchema>

// ═══════════════════════════════════════════════════════════════════════════
// STACK CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const BackendFrameworkSchema = z.enum(['fastify', 'express', 'hono', 'elysia'])
const FrontendFrameworkSchema = z.enum(['react', 'vue', 'svelte', 'solid', 'nextjs', 'nuxt', 'none'])
const ORMSchema = z.enum(['prisma', 'drizzle', 'typeorm', 'kysely'])
const DatabaseSchema = z.enum(['postgresql', 'mysql', 'sqlite', 'mongodb'])
const AuthStrategySchema = z.enum(['jwt', 'session', 'oauth', 'passkey', 'none'])
const TestingFrameworkSchema = z.enum(['vitest', 'jest', 'playwright', 'cypress'])

const StackSchema = z.object({
  backend: BackendFrameworkSchema.default('fastify'),
  frontend: FrontendFrameworkSchema.default('react'),
  orm: ORMSchema.default('prisma'),
  database: DatabaseSchema.default('postgresql'),
  auth: AuthStrategySchema.default('jwt'),
  testing: z.array(TestingFrameworkSchema).default(['vitest']),
  containerization: z.boolean().default(true),
  cicd: z.enum(['github', 'gitlab', 'none']).default('github'),
})

export type Stack = z.infer<typeof StackSchema>

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════════════════

const FeaturesSchema = z.object({
  // API Features
  openapi: z.boolean().default(true),
  graphql: z.boolean().default(false),
  websockets: z.boolean().default(false),
  rateLimit: z.boolean().default(true),
  cors: z.boolean().default(true),

  // Data Features
  pagination: z.boolean().default(true),
  filtering: z.boolean().default(true),
  sorting: z.boolean().default(true),
  search: z.boolean().default(true),

  // Observability
  logging: z.boolean().default(true),
  metrics: z.boolean().default(true),
  tracing: z.boolean().default(true),
  healthCheck: z.boolean().default(true),

  // Documentation
  readme: z.boolean().default(true),
  apiDocs: z.boolean().default(true),
  wiki: z.boolean().default(false),
  changelog: z.boolean().default(true),

  // UI Features (when frontend !== 'none')
  darkMode: z.boolean().default(true),
  i18n: z.boolean().default(false),
  pwa: z.boolean().default(false),
  storybook: z.boolean().default(false),
})

export type Features = z.infer<typeof FeaturesSchema>

// ═══════════════════════════════════════════════════════════════════════════
// CI/CD CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CICDSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'none']).default('github'),
  branches: z
    .object({
      main: z.string().default('main'),
      develop: z.string().optional(),
      release: z.string().optional(),
    })
    .default({}),
  stages: z
    .object({
      lint: z.boolean().default(true),
      typecheck: z.boolean().default(true),
      test: z.boolean().default(true),
      build: z.boolean().default(true),
      e2e: z.boolean().default(false),
      deploy: z.boolean().default(false),
    })
    .default({}),
  deployments: z
    .array(
      z.object({
        name: z.string(),
        environment: z.enum(['staging', 'production']),
        provider: z.enum(['vercel', 'railway', 'fly', 'aws', 'gcp', 'docker']),
        branch: z.string(),
        autoMerge: z.boolean().default(false),
      })
    )
    .default([]),
})

export type CICD = z.infer<typeof CICDSchema>

// ═══════════════════════════════════════════════════════════════════════════
// PROJECT METADATA
// ═══════════════════════════════════════════════════════════════════════════

const ProjectMetaSchema = z.object({
  name: z.string(),
  version: z.string().default('0.1.0'),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().default('MIT'),
  repository: z.string().optional(),
  keywords: z.array(z.string()).default([]),
})

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE SPEC
// ═══════════════════════════════════════════════════════════════════════════

const TurbineSpecSchema = z.object({
  // Spec version for compatibility
  specVersion: z.string().default('1.0'),

  // Project metadata
  project: ProjectMetaSchema,

  // Technology stack
  stack: StackSchema.default({}),

  // Feature flags
  features: FeaturesSchema.default({}),

  // CI/CD configuration
  cicd: CICDSchema.default({}),

  // Domain entities
  entities: z.array(EntitySchema),

  // Custom endpoints (beyond CRUD)
  customEndpoints: z
    .array(
      z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string(),
        description: z.string(),
        handler: z.string(), // Reference to handler file/function
        auth: z.boolean().default(true),
        rateLimit: z.number().optional(),
      })
    )
    .default([]),

  // Seed data
  seeds: z
    .record(
      z.string(),
      z.array(z.record(z.string(), z.unknown()))
    )
    .optional(),

  // Environment variables template
  env: z
    .record(
      z.string(),
      z.object({
        description: z.string(),
        default: z.string().optional(),
        required: z.boolean().default(true),
        secret: z.boolean().default(false),
      })
    )
    .default({}),
})

export type TurbineSpec = z.infer<typeof TurbineSpecSchema>

// ═══════════════════════════════════════════════════════════════════════════
// PARSER
// ═══════════════════════════════════════════════════════════════════════════

import * as yaml from 'yaml'

export class SpecParser {
  /**
   * Parse a YAML string into a validated TurbineSpec
   */
  parse(yamlContent: string): TurbineSpec {
    const raw = yaml.parse(yamlContent)
    return this.validate(raw)
  }

  /**
   * Validate raw object against TurbineSpec schema
   */
  validate(raw: unknown): TurbineSpec {
    const result = TurbineSpecSchema.safeParse(raw)

    if (!result.success) {
      const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n')
      throw new SpecParseError(`Invalid turbine.yaml:\n${errors}`)
    }

    return this.postProcess(result.data)
  }

  /**
   * Post-process spec to derive computed values
   */
  private postProcess(spec: TurbineSpec): TurbineSpec {
    // Derive plural names if not specified
    const entities = spec.entities.map((entity) => ({
      ...entity,
      plural: entity.plural ?? this.pluralize(entity.name),
      tableName: entity.tableName ?? this.toSnakeCase(entity.plural ?? this.pluralize(entity.name)),
    }))

    // Validate relations point to existing entities
    this.validateRelations(entities)

    return {
      ...spec,
      entities,
    }
  }

  /**
   * Simple pluralization (override in spec for irregular)
   */
  private pluralize(name: string): string {
    if (name.endsWith('y')) {
      return name.slice(0, -1) + 'ies'
    }
    if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) {
      return name + 'es'
    }
    return name + 's'
  }

  /**
   * Convert to snake_case for table names
   */
  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
  }

  /**
   * Validate all relations point to existing entities
   */
  private validateRelations(entities: Entity[]): void {
    const entityNames = new Set(entities.map((e) => e.name))

    for (const entity of entities) {
      for (const field of entity.fields) {
        if (field.type === 'relation' && field.relation) {
          if (!entityNames.has(field.relation.target)) {
            throw new SpecParseError(
              `Entity "${entity.name}" has relation to unknown entity "${field.relation.target}"`
            )
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════

export class SpecParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpecParseError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract entity dependency graph for ordered generation
 */
export function getEntityDependencyOrder(entities: Entity[]): string[] {
  const graph = new Map<string, Set<string>>()

  // Build dependency graph
  for (const entity of entities) {
    graph.set(entity.name, new Set())

    for (const field of entity.fields) {
      if (field.type === 'relation' && field.relation) {
        if (field.relation.type === 'belongsTo') {
          // This entity depends on the target
          graph.get(entity.name)!.add(field.relation.target)
        }
      }
    }
  }

  // Topological sort
  const sorted: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new SpecParseError(`Circular dependency detected involving entity "${name}"`)
    }

    visiting.add(name)
    for (const dep of graph.get(name) ?? []) {
      visit(dep)
    }
    visiting.delete(name)
    visited.add(name)
    sorted.push(name)
  }

  for (const entity of entities) {
    visit(entity.name)
  }

  return sorted
}

/**
 * Get all fields that need to be generated for an entity (including timestamps, etc)
 */
export function getEntityFields(entity: Entity): Field[] {
  const fields = [...entity.fields]

  // Add id field if not present
  if (!fields.some((f) => f.name === 'id')) {
    fields.unshift({
      name: 'id',
      type: 'uuid',
      validation: { required: true, unique: true },
    })
  }

  // Add timestamp fields
  if (entity.timestamps) {
    if (!fields.some((f) => f.name === 'createdAt')) {
      fields.push({ name: 'createdAt', type: 'datetime' })
    }
    if (!fields.some((f) => f.name === 'updatedAt')) {
      fields.push({ name: 'updatedAt', type: 'datetime' })
    }
  }

  // Add soft delete field
  if (entity.softDelete) {
    if (!fields.some((f) => f.name === 'deletedAt')) {
      fields.push({ name: 'deletedAt', type: 'datetime' })
    }
  }

  return fields
}

/**
 * Convert field type to TypeScript type
 */
export function fieldTypeToTS(field: Field): string {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'email':
    case 'url':
      return 'string'
    case 'number':
      return 'number'
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
    case 'datetime':
      return 'Date'
    case 'uuid':
      return 'string'
    case 'json':
      return 'unknown'
    case 'enum':
      return field.enumValues?.map((v) => `'${v}'`).join(' | ') ?? 'string'
    case 'relation':
      return field.relation?.target ?? 'unknown'
    default:
      return 'unknown'
  }
}

/**
 * Convert field type to Zod schema
 */
export function fieldTypeToZod(field: Field): string {
  const base = (() => {
    switch (field.type) {
      case 'string':
        return 'z.string()'
      case 'text':
        return 'z.string()'
      case 'email':
        return 'z.string().email()'
      case 'url':
        return 'z.string().url()'
      case 'number':
        return 'z.number()'
      case 'integer':
        return 'z.number().int()'
      case 'boolean':
        return 'z.boolean()'
      case 'date':
        return 'z.coerce.date()'
      case 'datetime':
        return 'z.coerce.date()'
      case 'uuid':
        return 'z.string().uuid()'
      case 'json':
        return 'z.unknown()'
      case 'enum':
        return `z.enum([${field.enumValues?.map((v) => `'${v}'`).join(', ') ?? ''}])`
      case 'relation':
        return 'z.string().uuid()' // Foreign key
      default:
        return 'z.unknown()'
    }
  })()

  // Add validation rules
  let schema = base
  const v = field.validation

  if (v) {
    if (v.min !== undefined) schema += `.min(${v.min})`
    if (v.max !== undefined) schema += `.max(${v.max})`
    if (v.minLength !== undefined) schema += `.min(${v.minLength})`
    if (v.maxLength !== undefined) schema += `.max(${v.maxLength})`
    if (v.pattern) schema += `.regex(/${v.pattern}/)`
    if (v.default !== undefined) schema += `.default(${JSON.stringify(v.default)})`
    if (!v.required) schema += '.optional()'
  }

  return schema
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const specParser = new SpecParser()
