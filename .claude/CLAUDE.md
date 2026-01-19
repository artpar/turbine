# Turbine - Project Context for Claude Sessions

## What Is Turbine?

Turbine is a **Python CLI tool** that generates **TypeScript fullstack projects** from YAML specifications.

**Core Philosophy**: Scaffolding-first. 80% deterministic code generation, 20% left for developer/LLM to implement business logic.

**Key Distinction**:
- Turbine itself = **Python** (Pydantic, Typer, Rich)
- Generated projects = **TypeScript** (Fastify, React, Prisma, Zod)

## Quick Start

```bash
cd /Users/artpar/workspace/code/turbine
source .venv/bin/activate

# Generate a project
turbine generate examples/todo-api/turbine.yaml -o /tmp/test

# Test generated code compiles
cd /tmp/test && npm install && npx tsc --noEmit && npx prisma validate
```

## Current State (January 2026)

### What's Working (All Tests Pass)

| Check | Status |
|-------|--------|
| `turbine generate` | ✅ Produces 21 files |
| `turbine validate` | ✅ Validates YAML specs |
| `turbine init` | ✅ Creates starter spec |
| `tsc --noEmit` | ✅ TypeScript compiles |
| `prisma validate` | ✅ Schema is valid |

### Recent Fixes (This Session)

1. **JWT Type Error** - Fixed `expiresIn` type by importing `StringValue` from 'ms' package
2. **PascalCase Preservation** - `TodoList` no longer becomes `Todolist`
3. **React Import Extensions** - Added `.js` extensions for ESM compatibility
4. **.env.example Placeholders** - DATABASE_URL and JWT_SECRET have example values

## What Needs Work (Priority Order)

### 1. Working Database Operations in Routes (HIGH)
**File**: `turbine/generator.py` - `_generate_fastify_routes()`

Current:
```typescript
app.get('/', async (request, reply) => {
  // TODO: Implement list query with pagination
  const items: User[] = []
  return items
})
```

Target:
```typescript
app.get('/', async (request, reply) => {
  const items = await db.user.findMany({ take: 20, skip: 0 })
  return items
})
```

### 2. Proper Prisma Relations (HIGH)
**File**: `turbine/generator.py` - `_generate_prisma_schema()`

Current:
```prisma
model Todo {
  todoListId String?  // Just a string field
}
```

Target:
```prisma
model Todo {
  todoListId String?
  todoList   TodoList? @relation(fields: [todoListId], references: [id])
}
model TodoList {
  todos Todo[]
}
```

### 3. Pagination/Filtering/Sorting (MEDIUM)
Spec supports these features but routes don't handle query params yet.

### 4. Auth Middleware Integration (MEDIUM)
`src/auth.ts` is generated but not wired into protected routes.

### 5. Custom Endpoints (MEDIUM)
`customEndpoints` section in spec is parsed but not generated.

### 6. Seed Data Script (LOW)
`seeds` section in spec is parsed but not used.

### 7. Jinja2 Templates (NICE TO HAVE)
Move string templates to external `.jinja2` files for customization.

## Project Structure

```
turbine/
├── turbine/                    # Python package
│   ├── __init__.py             # Package exports
│   ├── spec.py                 # Pydantic models for turbine.yaml
│   ├── generator.py            # Main generator (1400+ lines)
│   └── cli.py                  # Typer CLI
├── examples/
│   └── todo-api/
│       └── turbine.yaml        # Example spec (comprehensive)
├── pyproject.toml              # Python package config
├── TODO.md                     # Detailed remaining work
└── src/                        # OLD TypeScript (can delete)
```

## Key Files to Modify

### turbine/generator.py
Main generator class. Key methods:
- `_generate_fastify_routes()` - Line ~700 - CRUD route stubs
- `_generate_prisma_schema()` - Line ~1250 - Prisma models
- `_generate_types()` - Line ~200 - TypeScript interfaces + Zod
- `_generate_auth()` - Line ~1000 - JWT auth code

### turbine/spec.py
Pydantic models for YAML parsing:
- `TurbineSpec.from_file()` - Load and validate spec
- `field_to_typescript()` - Type conversion
- `field_to_zod()` - Zod schema generation
- `field_to_prisma()` - Prisma type mapping

### examples/todo-api/turbine.yaml
Comprehensive example spec with:
- 3 entities (User, TodoList, Todo)
- Relations between entities
- Auth configuration
- Environment variables
- Custom endpoints (not yet generated)

## Generated Project Output

For the todo-api spec, generates 21 files:
```
/tmp/test/
├── package.json          # Dependencies based on stack
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example          # With placeholder values
├── prisma/
│   └── schema.prisma     # With enums
├── src/
│   ├── index.ts          # Fastify server entry
│   ├── types.ts          # Interfaces + Zod schemas
│   ├── auth.ts           # JWT utilities
│   └── routes/
│       ├── user.ts       # CRUD stubs
│       ├── todolist.ts
│       └── todo.ts
└── frontend/             # If enabled
    └── src/
        ├── App.tsx
        └── main.tsx
```

## User Preferences (MUST HONOR)

- **No fuzzy concepts** - No "gap identification", no "time estimation"
- **Maximize 3rd party libraries** - Don't write from scratch
- **Keep it simple** - Prefer concrete, working code
- **Python for Turbine** - TypeScript only for generated projects
- **No linting/type checking commands** - User will test manually

## Helper Functions in generator.py

```python
def pascal_case(s: str) -> str:
    """TodoList stays TodoList, not Todolist"""
    parts = s.replace("-", "_").split("_")
    return "".join(p[0].upper() + p[1:] if p else "" for p in parts)

def kebab_case(s: str) -> str:
    """Handles spaces: 'Todo API' -> 'todo-api'"""

def camel_case(s: str) -> str:
    """For variable names"""
```

## Testing Workflow

```bash
# Always from turbine root with venv active
source .venv/bin/activate

# Regenerate and test
rm -rf /tmp/test
turbine generate examples/todo-api/turbine.yaml -o /tmp/test
cd /tmp/test
npm install
npx tsc --noEmit        # Should pass
cp .env.example .env
npx prisma validate     # Should pass
```

## Next Session: Recommended Starting Point

Start with **Working Database Operations** (#1 above):

1. Read `turbine/generator.py` around line 700 (`_generate_fastify_routes`)
2. Look at how routes are currently generated
3. Add Prisma client import and actual queries
4. Test with `npx tsc --noEmit` after each change

This unblocks the most value - generated projects will actually work with a database.
