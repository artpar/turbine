# Turbine - Project Context for Claude Sessions

## What Is Turbine?

Turbine is a **Python CLI tool** that generates **TypeScript fullstack projects** from YAML specifications.

**Core Philosophy**: Scaffolding-first. 80% deterministic code generation, 20% left for developer/LLM to implement business logic.

**Key Distinction**:
- Turbine itself = **Python** (Pydantic, Typer, Rich)
- Generated projects = **TypeScript** (Fastify, React, Prisma, Zod)

**GitHub**: https://github.com/artpar/turbine

## Quick Start

```bash
cd /Users/artpar/workspace/code/turbine
source .venv/bin/activate

# Generate a project
turbine generate examples/todo-api/turbine.yaml -o /tmp/test

# Test generated code compiles
cd /tmp/test && npm install && npx tsc --noEmit
DATABASE_URL="postgresql://localhost:5432/test" npx prisma validate
```

## Current State (January 2026)

### What's Working ✅

| Feature | Status | Notes |
|---------|--------|-------|
| `turbine generate` | ✅ | Produces 22-23 files |
| `turbine validate` | ✅ | Validates YAML specs |
| `turbine init` | ✅ | Creates starter spec |
| `tsc --noEmit` | ✅ | TypeScript compiles |
| `prisma validate` | ✅ | Schema valid with relations |
| Real Prisma CRUD | ✅ | findMany, create, update, delete |
| Auth Middleware | ✅ | requireAuth, requireRole, optionalAuth |
| Query Builder | ✅ | Filtering, sorting, pagination |
| Ownership Tracking | ✅ | createdById, updatedById with back-refs |
| Prisma @relation | ✅ | Proper decorators with onDelete |

### Recent Accomplishments (This Session)

1. **Real Prisma CRUD** - Routes now use actual database queries
2. **Auth Middleware** - `src/middleware/auth.ts` with JWT verification
3. **Query Builder** - `src/utils/query-builder.ts` for filtering/sorting/pagination
4. **Ownership Relations** - Auto-filter by createdById, back-references on User model
5. **Tenant Middleware** - Multi-tenancy support (when enabled in spec)
6. **Fixed camelCase** - Handles PascalCase input correctly (TodoList → todoList)
7. **Fixed empty arrays** - Type annotations for empty `string[]` arrays
8. **Prisma back-refs** - Ownership relations have corresponding arrays on User

## What Still Needs Work (Priority Order)

### 1. Auth Routes (HIGH) 🔴
**Missing**: Register/login endpoints not generated yet.

Need to add `_generate_auth_routes()` that creates:
```typescript
// POST /auth/register
// POST /auth/login
// POST /auth/refresh
// GET /auth/me
```

**Workaround**: Create users directly in database and generate JWT manually.

### 2. Zod Optional Fields Bug (HIGH) 🔴
**File**: `turbine/spec.py` - `field_to_zod()`

Fields without `required: true` should have `.optional()` in Zod schema.

Current bug:
```typescript
dueDate: z.coerce.date(),  // Should be z.coerce.date().optional()
```

### 3. Missing Dependencies in package.json (MEDIUM) 🟡
**File**: `turbine/generator.py` - `_generate_package_json()`

Add to generated package.json:
- `dotenv` in dependencies
- `tsx` in devDependencies

Currently requires manual `npm install dotenv tsx` after generation.

### 4. Custom Endpoints (MEDIUM) 🟡
`customEndpoints` section in spec is parsed but not generated.

### 5. Seed Data Script (LOW) 🟢
`seeds` section in spec is parsed but not used.

### 6. Frontend Integration (LOW) 🟢
React frontend is generated but not connected to API.

## Project Structure

```
turbine/
├── turbine/                    # Python package
│   ├── __init__.py             # Package exports
│   ├── spec.py                 # Pydantic models for turbine.yaml
│   ├── generator.py            # Main generator (~2100 lines)
│   └── cli.py                  # Typer CLI
├── examples/
│   └── todo-api/
│       └── turbine.yaml        # Example spec with identity + ownership
├── pyproject.toml              # Python package config
└── .claude/
    └── CLAUDE.md               # This file
```

## Key Files to Modify

### turbine/generator.py
Main generator class. Key methods:
- `_generate_fastify_routes()` - Line ~900 - Real Prisma CRUD with auth
- `_generate_prisma_schema()` - Line ~1870 - Models with @relation
- `_generate_types()` - Line ~200 - TypeScript interfaces + Zod
- `_generate_auth()` - Line ~1216 - JWT utilities
- `_generate_auth_middleware()` - Line ~1302 - Auth middleware
- `_generate_query_builder()` - Line ~1550 - Filtering/sorting utils

### turbine/spec.py
Pydantic models for YAML parsing:
- `TurbineSpec` - Main spec model
- `IdentityConfig` - User entity, role field mapping
- `EntityOwnership` - trackCreator, trackModifier, autoFilter
- `field_to_zod()` - **BUG: doesn't handle optional fields**

### examples/todo-api/turbine.yaml
Comprehensive example spec with:
- 3 entities (User, TodoList, Todo)
- Identity config (userEntity, fields mapping)
- Ownership config on TodoList and Todo
- Relations between entities

## Generated Project Output

For a spec with 2 entities (User, Todo), generates ~22 files:
```
/tmp/todo-app/
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .github/workflows/ci.yml
├── prisma/
│   └── schema.prisma          # With @relation decorators
├── src/
│   ├── index.ts               # Fastify server with auth hook
│   ├── db.ts                  # Prisma client
│   ├── types.ts               # Interfaces + Zod schemas
│   ├── auth.ts                # JWT utilities
│   ├── middleware.ts
│   ├── middleware/
│   │   └── auth.ts            # requireAuth, requireRole
│   ├── utils/
│   │   └── query-builder.ts   # buildWhere, buildOrderBy, buildPagination
│   └── routes/
│       ├── user.ts            # Real CRUD with Prisma
│       └── todo.ts            # With ownership checks
└── frontend/
    └── src/
        ├── App.tsx
        └── main.tsx
```

## Running a Generated Project

```bash
# Generate
source .venv/bin/activate
turbine generate examples/todo-api/turbine.yaml -o /tmp/myapp

# Setup
cd /tmp/myapp
npm install
npm install dotenv  # Missing from generated package.json

# Add dotenv import to src/index.ts (first line):
# import 'dotenv/config'

# Database
docker-compose up -d db
cp .env.example .env
# Edit .env with real DATABASE_URL and JWT_SECRET
npx prisma db push

# Run
npm run dev
# Server at http://localhost:3000
# Swagger docs at http://localhost:3000/docs
```

## Creating Test Users (No Auth Routes Yet)

```javascript
// Run with: node -e "..." in the generated project directory
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

async function main() {
  const db = new PrismaClient();
  const passwordHash = await bcrypt.hash('password123', 10);

  const user = await db.user.create({
    data: {
      email: 'test@example.com',
      name: 'Test User',
      passwordHash,
      role: 'user'
    }
  });

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'super-secret-key-for-dev',
    { expiresIn: '7d' }
  );

  console.log('Token:', token);
  await db.$disconnect();
}
main();
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

def kebab_case(s: str) -> str:
    """Handles spaces: 'Todo API' -> 'todo-api'"""

def camel_case(s: str) -> str:
    """Handles PascalCase: 'TodoList' -> 'todoList'"""
    # Uses regex to insert underscores before capitals
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
DATABASE_URL="postgresql://localhost:5432/test" npx prisma validate  # Should pass
```

## Next Session: Recommended Tasks

### Option A: Add Auth Routes (Most Impactful)
1. Add `_generate_auth_routes()` method in generator.py
2. Generate `src/routes/auth.ts` with register/login/me endpoints
3. Register routes in `src/index.ts`
4. Test full auth flow end-to-end

### Option B: Fix Zod Optional Fields
1. Edit `field_to_zod()` in spec.py
2. Check if field has `required: true` validation
3. If not, append `.optional()` to Zod type
4. Regenerate and verify types.ts

### Option C: Fix Missing Dependencies
1. Edit `_generate_package_json()` in generator.py
2. Add `dotenv` to dependencies
3. Add `tsx` to devDependencies
4. Update `_generate_fastify_entry()` to include `import 'dotenv/config'`

## API Testing Examples

```bash
TOKEN="your-jwt-token"

# List todos (with auth)
curl http://localhost:3000/todos -H "Authorization: Bearer $TOKEN"

# Create todo
curl -X POST http://localhost:3000/todos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Buy groceries"}'

# Update todo
curl -X PUT http://localhost:3000/todos/UUID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"completed":true}'

# Delete todo
curl -X DELETE http://localhost:3000/todos/UUID \
  -H "Authorization: Bearer $TOKEN"

# Filtering & Sorting
curl "http://localhost:3000/todos?completed=false&sort=createdAt&order=desc" \
  -H "Authorization: Bearer $TOKEN"
```
