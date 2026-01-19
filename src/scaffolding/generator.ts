// ═══════════════════════════════════════════════════════════════════════════
// TURBINE - Scaffolding Generator
// ═══════════════════════════════════════════════════════════════════════════
// Orchestrates all adapters to generate complete project scaffolding

import { promises as fs } from 'fs'
import path from 'path'
import {
  TurbineSpec,
  Entity,
  getEntityDependencyOrder,
  specParser,
} from './spec-parser.js'
import {
  adapterRegistry,
  GeneratedCode,
  CodeGap,
} from './adapters/base.js'

// Import adapters to register them
import './adapters/fastify.js'
import './adapters/prisma.js'
import './adapters/react.js'

// ═══════════════════════════════════════════════════════════════════════════
// GENERATOR RESULT
// ═══════════════════════════════════════════════════════════════════════════

export interface GeneratorResult {
  files: GeneratedFile[]
  gaps: GapSummary[]
  dependencies: PackageJson
  scripts: Record<string, string>
}

export interface GeneratedFile {
  path: string
  content: string
  template?: string
  gaps?: CodeGap[]
}

export interface GapSummary {
  file: string
  type: CodeGap['type']
  location: CodeGap['location']
  context: string
  hint?: string
}

export interface PackageJson {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

// ═══════════════════════════════════════════════════════════════════════════
// SCAFFOLDING GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export class ScaffoldingGenerator {
  private spec: TurbineSpec
  private files: GeneratedFile[] = []
  private gaps: GapSummary[] = []
  private dependencies: Record<string, string> = {}
  private devDependencies: Record<string, string> = {}

  constructor(spec: TurbineSpec) {
    this.spec = spec
  }

  /**
   * Generate complete project scaffolding from spec
   */
  async generate(): Promise<GeneratorResult> {
    const adapters = adapterRegistry.getAdaptersForStack(this.spec.stack)
    const entityOrder = getEntityDependencyOrder(this.spec.entities)
    const orderedEntities = entityOrder.map(
      (name) => this.spec.entities.find((e) => e.name === name)!
    )

    // Collect dependencies from all adapters
    this.collectDependencies(adapters.backend.getDependencies())
    this.collectDevDependencies(adapters.backend.getDevDependencies())
    this.collectDependencies(adapters.orm.getDependencies())
    this.collectDevDependencies(adapters.orm.getDevDependencies())

    if (adapters.frontend) {
      this.collectDependencies(adapters.frontend.getDependencies())
      this.collectDevDependencies(adapters.frontend.getDevDependencies())
    }

    // Generate backend code
    await this.generateBackend(adapters.backend, orderedEntities)

    // Generate ORM code
    await this.generateORM(adapters.orm, orderedEntities)

    // Generate frontend code (if applicable)
    if (adapters.frontend) {
      await this.generateFrontend(adapters.frontend, orderedEntities)
    }

    // Generate project files
    await this.generateProjectFiles()

    // Generate CI/CD
    await this.generateCICD()

    // Generate tests
    await this.generateTests(orderedEntities)

    // Generate documentation
    await this.generateDocs()

    return {
      files: this.files,
      gaps: this.gaps,
      dependencies: {
        dependencies: this.dependencies,
        devDependencies: this.devDependencies,
      },
      scripts: this.getScripts(),
    }
  }

  private async generateBackend(
    adapter: ReturnType<typeof adapterRegistry.getBackend>,
    entities: Entity[]
  ): Promise<void> {
    // Generate routes for each entity
    for (const entity of entities) {
      this.addCode(adapter.generateRoute(entity))
    }

    // Generate route index
    this.addCode(adapter.generateRouteIndex(entities))

    // Generate middleware
    this.addCode(adapter.generateAuthMiddleware())
    this.addCode(adapter.generateErrorHandler())
    this.addCode(adapter.generateValidationMiddleware())

    // Generate server setup
    this.addCode(adapter.generateServerSetup(this.spec))

    // Generate plugins
    for (const plugin of adapter.generatePlugins(this.spec)) {
      this.addCode(plugin)
    }
  }

  private async generateORM(
    adapter: ReturnType<typeof adapterRegistry.getORM>,
    entities: Entity[]
  ): Promise<void> {
    // Generate schema
    this.addCode(adapter.generateSchema(entities))

    // Generate migration if available
    const migration = adapter.generateMigration(entities)
    if (migration) {
      this.addCode(migration)
    }

    // Generate repositories
    for (const entity of entities) {
      this.addCode(adapter.generateRepository(entity))
    }

    // Generate repository index
    this.addCode(adapter.generateRepositoryIndex(entities))

    // Generate client setup
    this.addCode(adapter.generateClientSetup())
  }

  private async generateFrontend(
    adapter: ReturnType<typeof adapterRegistry.getFrontend>,
    entities: Entity[]
  ): Promise<void> {
    if (!adapter) return

    // Generate pages for each entity
    for (const code of adapter.generatePages(entities)) {
      this.addCode(code)
    }

    // Generate layout
    this.addCode(adapter.generateLayout(this.spec))

    // Generate navigation
    this.addCode(adapter.generateNavigation(entities))

    // Generate API client
    this.addCode(adapter.generateApiClient())

    // Generate hooks for each entity
    for (const entity of entities) {
      this.addCode(adapter.generateEntityHooks(entity))
    }

    // Generate common components
    this.generateCommonComponents()

    // Generate app entry and routing
    this.generateFrontendEntry(entities)
  }

  private generateCommonComponents(): void {
    // Pagination component
    this.addFile('src/components/Pagination.tsx', `// ═══════════════════════════════════════════════════════════════════════════
// Pagination Component
// ═══════════════════════════════════════════════════════════════════════════
// Auto-generated by Turbine

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex justify-center gap-2 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-3 py-1 border rounded disabled:opacity-50"
      >
        Previous
      </button>
      <span className="px-3 py-1">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-3 py-1 border rounded disabled:opacity-50"
      >
        Next
      </button>
    </div>
  )
}

export default Pagination
`)

    // Search input component
    this.addFile('src/components/SearchInput.tsx', `// ═══════════════════════════════════════════════════════════════════════════
// Search Input Component
// ═══════════════════════════════════════════════════════════════════════════
// Auto-generated by Turbine

import { useState, useEffect } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  debounceMs?: number
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue)
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [localValue, value, onChange, debounceMs])

  return (
    <input
      type="text"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder={placeholder}
      className="w-full max-w-md border rounded px-3 py-2"
    />
  )
}

export default SearchInput
`)
  }

  private generateFrontendEntry(entities: Entity[]): void {
    const routes = entities.flatMap((e) => {
      const plural = e.plural ?? e.name + 's'
      return [
        `        <Route path="/${plural.toLowerCase()}" element={<${e.name}List />} />`,
        `        <Route path="/${plural.toLowerCase()}/new" element={<${e.name}Form mode="create" />} />`,
        `        <Route path="/${plural.toLowerCase()}/:id" element={<${e.name}Detail />} />`,
        `        <Route path="/${plural.toLowerCase()}/:id/edit" element={<${e.name}Form mode="edit" />} />`,
      ]
    })

    const imports = entities.map((e) => `import { ${e.name}List } from './pages/${e.name}List'
import { ${e.name}Form } from './pages/${e.name}Form'
import { ${e.name}Detail } from './pages/${e.name}Detail'`).join('\n')

    this.addFile('src/App.tsx', `// ═══════════════════════════════════════════════════════════════════════════
// App Entry
// ═══════════════════════════════════════════════════════════════════════════
// Auto-generated by Turbine

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from './components/Layout'

${imports}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div className="p-4">Welcome! Select a resource from the navigation.</div>} />
${routes.join('\n')}
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
`)

    this.addFile('src/main.tsx', `// ═══════════════════════════════════════════════════════════════════════════
// Main Entry
// ═══════════════════════════════════════════════════════════════════════════
// Auto-generated by Turbine

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
`)

    this.addFile('src/index.css', `/* ═══════════════════════════════════════════════════════════════════════════
   Base Styles
   Auto-generated by Turbine
   ═══════════════════════════════════════════════════════════════════════════ */

@tailwind base;
@tailwind components;
@tailwind utilities;
`)

    this.addFile('index.html', `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${this.spec.project.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`)

    this.addFile('vite.config.ts', `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
`)

    this.addFile('tailwind.config.js', `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
`)

    this.addFile('postcss.config.js', `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`)

    this.collectDevDependencies({
      tailwindcss: '^3.4.0',
      autoprefixer: '^10.4.0',
      postcss: '^8.4.0',
    })
  }

  private async generateProjectFiles(): Promise<void> {
    // Package.json
    this.addFile('package.json', JSON.stringify({
      name: this.spec.project.name.toLowerCase().replace(/\s+/g, '-'),
      version: this.spec.project.version,
      description: this.spec.project.description,
      type: 'module',
      scripts: this.getScripts(),
      dependencies: this.dependencies,
      devDependencies: this.devDependencies,
      license: this.spec.project.license,
      author: this.spec.project.author,
    }, null, 2))

    // TypeScript config
    this.addFile('tsconfig.json', JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        types: ['node'],
        baseUrl: '.',
        paths: {
          '@/*': ['./src/*'],
        },
      },
      include: ['src'],
      exclude: ['node_modules'],
    }, null, 2))

    // Environment template
    const envContent = Object.entries(this.spec.env)
      .map(([key, config]) => {
        const comment = config.description ? `# ${config.description}` : ''
        const value = config.default ?? (config.secret ? '' : 'your-value-here')
        return `${comment}\n${key}=${value}`
      })
      .join('\n\n')

    this.addFile('.env.example', `# ═══════════════════════════════════════════════════════════════════════════
# Environment Variables
# ═══════════════════════════════════════════════════════════════════════════
# Copy to .env and fill in values

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/${this.spec.project.name.toLowerCase().replace(/\s+/g, '_')}

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# Auth
JWT_SECRET=your-secret-key-here

${envContent}
`)

    // Gitignore
    this.addFile('.gitignore', `# Dependencies
node_modules/

# Build
dist/
build/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Testing
coverage/

# Prisma
prisma/migrations/*.sql.bak
`)

    // Docker
    if (this.spec.stack.containerization) {
      this.generateDocker()
    }
  }

  private generateDocker(): void {
    this.addFile('Dockerfile', `# ═══════════════════════════════════════════════════════════════════════════
# Dockerfile
# ═══════════════════════════════════════════════════════════════════════════
# Auto-generated by Turbine

FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Build stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

USER appuser
EXPOSE 3000
CMD ["npm", "start"]
`)

    this.addFile('docker-compose.yml', `# ═══════════════════════════════════════════════════════════════════════════
# Docker Compose
# ═══════════════════════════════════════════════════════════════════════════
# Auto-generated by Turbine

version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/${this.spec.project.name.toLowerCase().replace(/\s+/g, '_')}
      - NODE_ENV=production
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=${this.spec.project.name.toLowerCase().replace(/\s+/g, '_')}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
`)
  }

  private async generateCICD(): Promise<void> {
    if (this.spec.cicd.provider === 'github') {
      this.addFile('.github/workflows/ci.yml', `# ═══════════════════════════════════════════════════════════════════════════
# CI Pipeline
# ═══════════════════════════════════════════════════════════════════════════
# Auto-generated by Turbine

name: CI

on:
  push:
    branches: [${this.spec.cicd.branches.main}]
  pull_request:
    branches: [${this.spec.cicd.branches.main}]

jobs:
  build:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

${this.spec.cicd.stages.typecheck ? `      - name: Type check
        run: npm run typecheck
` : ''}
${this.spec.cicd.stages.test ? `      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
` : ''}
${this.spec.cicd.stages.build ? `      - name: Build
        run: npm run build
` : ''}
`)
    }
  }

  private async generateTests(entities: Entity[]): Promise<void> {
    // Generate test setup
    this.addFile('vitest.config.ts', `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
`)

    // Generate entity tests
    for (const entity of entities) {
      this.addFile(`src/routes/${entity.name.toLowerCase()}.test.ts`, `// ═══════════════════════════════════════════════════════════════════════════
// ${entity.name} Route Tests
// ═══════════════════════════════════════════════════════════════════════════
// Auto-generated by Turbine

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../server'
import type { FastifyInstance } from 'fastify'

describe('${entity.name} Routes', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildServer()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /${entity.plural?.toLowerCase() ?? entity.name.toLowerCase() + 's'}', () => {
    it('should return a list of ${entity.plural?.toLowerCase() ?? entity.name.toLowerCase() + 's'}', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/${entity.plural?.toLowerCase() ?? entity.name.toLowerCase() + 's'}',
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('meta')
      // TODO: Add more specific assertions
    })
  })

  describe('POST /${entity.plural?.toLowerCase() ?? entity.name.toLowerCase() + 's'}', () => {
    it('should create a new ${entity.name.toLowerCase()}', async () => {
      // TODO: Implement test with valid input data
      expect(true).toBe(true)
    })

    it('should return 400 for invalid input', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/${entity.plural?.toLowerCase() ?? entity.name.toLowerCase() + 's'}',
        payload: {},
      })

      expect(response.statusCode).toBe(400)
    })
  })

  // TODO: Add tests for GET /:id, PATCH /:id, DELETE /:id
})
`)

      this.gaps.push({
        file: `src/routes/${entity.name.toLowerCase()}.test.ts`,
        type: 'business-logic',
        location: { line: 0, placeholder: '// TODO: Add more specific assertions' },
        context: `Test assertions for ${entity.name} list endpoint`,
        hint: 'Add assertions for response structure and data validation',
      })
    }

    this.collectDevDependencies({
      vitest: '^1.2.0',
      '@vitest/coverage-v8': '^1.2.0',
    })
  }

  private async generateDocs(): Promise<void> {
    if (!this.spec.features.readme) return

    const entityDocs = this.spec.entities
      .map((e) => `- **${e.name}**: ${e.description ?? 'No description'}`)
      .join('\n')

    this.addFile('README.md', `# ${this.spec.project.name}

${this.spec.project.description}

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+

### Installation

\`\`\`bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your values

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
\`\`\`

## API Documentation

${this.spec.features.openapi ? 'API documentation is available at `/docs` when the server is running.' : ''}

## Entities

${entityDocs}

## Scripts

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm start\` - Start production server
- \`npm test\` - Run tests
- \`npm run typecheck\` - Type check

## License

${this.spec.project.license}
`)
  }

  private getScripts(): Record<string, string> {
    const scripts: Record<string, string> = {
      dev: 'tsx watch src/server.ts',
      build: 'tsc',
      start: 'node dist/server.js',
      typecheck: 'tsc --noEmit',
    }

    if (this.spec.features.openapi) {
      scripts['generate:types'] = 'openapi-typescript openapi.yaml -o src/types/api.ts'
    }

    scripts['db:migrate'] = 'prisma migrate dev'
    scripts['db:push'] = 'prisma db push'
    scripts['db:studio'] = 'prisma studio'
    scripts.test = 'vitest'
    scripts['test:coverage'] = 'vitest --coverage'

    return scripts
  }

  private addCode(code: GeneratedCode): void {
    this.files.push({
      path: code.path,
      content: code.content,
      gaps: code.gaps,
    })

    if (code.gaps) {
      for (const gap of code.gaps) {
        this.gaps.push({
          file: code.path,
          ...gap,
        })
      }
    }
  }

  private addFile(filePath: string, content: string): void {
    this.files.push({ path: filePath, content })
  }

  private collectDependencies(deps: Record<string, string>): void {
    Object.assign(this.dependencies, deps)
  }

  private collectDevDependencies(deps: Record<string, string>): void {
    Object.assign(this.devDependencies, deps)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE WRITER
// ═══════════════════════════════════════════════════════════════════════════

export async function writeGeneratedFiles(
  files: GeneratedFile[],
  outputDir: string
): Promise<{ written: number; errors: string[] }> {
  const errors: string[] = []
  let written = 0

  for (const file of files) {
    try {
      const fullPath = path.join(outputDir, file.path)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, file.content, 'utf-8')
      written++
    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { written, errors }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ═══════════════════════════════════════════════════════════════════════════

export async function generateFromSpec(
  specContent: string,
  outputDir: string
): Promise<GeneratorResult & { writeResult: { written: number; errors: string[] } }> {
  // Parse spec
  const spec = specParser.parse(specContent)

  // Generate files
  const generator = new ScaffoldingGenerator(spec)
  const result = await generator.generate()

  // Write files
  const writeResult = await writeGeneratedFiles(result.files, outputDir)

  return { ...result, writeResult }
}
