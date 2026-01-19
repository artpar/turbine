// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Stack Adapter Base
// ═══════════════════════════════════════════════════════════════════════════
// Base interfaces for stack-specific code generation

import { Entity, Field, TurbineSpec, Stack } from '../spec-parser.js'

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Backend adapter generates server-side code
 */
export interface BackendAdapter {
  name: string

  // Package.json dependencies
  getDependencies(): Record<string, string>
  getDevDependencies(): Record<string, string>

  // Route generation
  generateRoute(entity: Entity): GeneratedCode
  generateRouteIndex(entities: Entity[]): GeneratedCode

  // Middleware generation
  generateAuthMiddleware(): GeneratedCode
  generateErrorHandler(): GeneratedCode
  generateValidationMiddleware(): GeneratedCode

  // Server setup
  generateServerSetup(spec: TurbineSpec): GeneratedCode
  generatePlugins(spec: TurbineSpec): GeneratedCode[]
}

/**
 * ORM adapter generates database schema and queries
 */
export interface ORMAdapter {
  name: string

  // Package.json dependencies
  getDependencies(): Record<string, string>
  getDevDependencies(): Record<string, string>

  // Schema generation
  generateSchema(entities: Entity[]): GeneratedCode
  generateMigration(entities: Entity[]): GeneratedCode | null

  // Repository generation
  generateRepository(entity: Entity): GeneratedCode
  generateRepositoryIndex(entities: Entity[]): GeneratedCode

  // Client setup
  generateClientSetup(): GeneratedCode
}

/**
 * Frontend adapter generates UI code
 */
export interface FrontendAdapter {
  name: string

  // Package.json dependencies
  getDependencies(): Record<string, string>
  getDevDependencies(): Record<string, string>

  // Component generation
  generateEntityList(entity: Entity): GeneratedCode
  generateEntityForm(entity: Entity): GeneratedCode
  generateEntityDetail(entity: Entity): GeneratedCode

  // Layout generation
  generateLayout(spec: TurbineSpec): GeneratedCode
  generateNavigation(entities: Entity[]): GeneratedCode

  // Page generation
  generatePages(entities: Entity[]): GeneratedCode[]

  // Hooks/stores
  generateApiClient(): GeneratedCode
  generateEntityHooks(entity: Entity): GeneratedCode
}

/**
 * Auth adapter generates authentication code
 */
export interface AuthAdapter {
  name: string

  getDependencies(): Record<string, string>
  getDevDependencies(): Record<string, string>

  // Auth generation
  generateAuthRoutes(): GeneratedCode
  generateAuthMiddleware(): GeneratedCode
  generateAuthUtils(): GeneratedCode
  generateUserEntity(): Entity
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATED CODE
// ═══════════════════════════════════════════════════════════════════════════

export interface GeneratedCode {
  path: string
  content: string

  // Metadata for gap identification
  gaps?: CodeGap[]

  // Dependencies this file has
  imports?: string[]
}

export interface CodeGap {
  type: 'business-logic' | 'validation' | 'transformation' | 'hook'
  location: {
    line: number
    placeholder: string
  }
  context: string
  hint?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export class AdapterRegistry {
  private backendAdapters = new Map<string, () => BackendAdapter>()
  private ormAdapters = new Map<string, () => ORMAdapter>()
  private frontendAdapters = new Map<string, () => FrontendAdapter>()
  private authAdapters = new Map<string, () => AuthAdapter>()

  registerBackend(name: string, factory: () => BackendAdapter): void {
    this.backendAdapters.set(name, factory)
  }

  registerORM(name: string, factory: () => ORMAdapter): void {
    this.ormAdapters.set(name, factory)
  }

  registerFrontend(name: string, factory: () => FrontendAdapter): void {
    this.frontendAdapters.set(name, factory)
  }

  registerAuth(name: string, factory: () => AuthAdapter): void {
    this.authAdapters.set(name, factory)
  }

  getBackend(name: string): BackendAdapter {
    const factory = this.backendAdapters.get(name)
    if (!factory) {
      throw new Error(`Unknown backend adapter: ${name}`)
    }
    return factory()
  }

  getORM(name: string): ORMAdapter {
    const factory = this.ormAdapters.get(name)
    if (!factory) {
      throw new Error(`Unknown ORM adapter: ${name}`)
    }
    return factory()
  }

  getFrontend(name: string): FrontendAdapter {
    const factory = this.frontendAdapters.get(name)
    if (!factory) {
      throw new Error(`Unknown frontend adapter: ${name}`)
    }
    return factory()
  }

  getAuth(name: string): AuthAdapter {
    const factory = this.authAdapters.get(name)
    if (!factory) {
      throw new Error(`Unknown auth adapter: ${name}`)
    }
    return factory()
  }

  getAdaptersForStack(stack: Stack): StackAdapters {
    return {
      backend: this.getBackend(stack.backend),
      orm: this.getORM(stack.orm),
      frontend: stack.frontend !== 'none' ? this.getFrontend(stack.frontend) : null,
      auth: stack.auth !== 'none' ? this.getAuth(stack.auth) : null,
    }
  }
}

export interface StackAdapters {
  backend: BackendAdapter
  orm: ORMAdapter
  frontend: FrontendAdapter | null
  auth: AuthAdapter | null
}

// Global registry instance
export const adapterRegistry = new AdapterRegistry()
