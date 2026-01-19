# Turbine - Remaining Work

## Status: Core Scaffolding Complete ✅

Generated projects now:
- Pass TypeScript compilation (`tsc --noEmit`)
- Have valid Prisma schemas (`prisma validate`)
- Include working auth utilities, types, Zod schemas

## Priority 1: Working Database Operations

**File**: `turbine/generator.py` - `_generate_fastify_routes()` (~line 700)

### Current State
Routes have TODO placeholders returning empty arrays:
```typescript
app.get('/', async (request, reply) => {
  // TODO: Implement list query with pagination
  const items: User[] = []
  return items
})
```

### Target State
Routes should use Prisma client:
```typescript
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

app.get('/', async (request, reply) => {
  const items = await prisma.user.findMany({
    take: 20,
    skip: 0,
  })
  return items
})

app.get('/:id', async (request, reply) => {
  const { id } = request.params
  const item = await prisma.user.findUnique({ where: { id } })
  if (!item) return reply.status(404).send({ error: 'Not found' })
  return item
})

app.post('/', async (request, reply) => {
  const data = UserSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse(request.body)
  const item = await prisma.user.create({ data })
  return reply.status(201).send(item)
})

app.put('/:id', async (request, reply) => {
  const { id } = request.params
  const data = UserSchema.partial().parse(request.body)
  const item = await prisma.user.update({ where: { id }, data })
  return item
})

app.delete('/:id', async (request, reply) => {
  const { id } = request.params
  await prisma.user.delete({ where: { id } })
  return reply.status(204).send()
})
```

### Implementation Steps
1. Generate `src/db.ts` with PrismaClient singleton
2. Update route files to import from `../db.js`
3. Replace TODO stubs with actual Prisma queries
4. Handle errors (not found, validation, etc.)

---

## Priority 2: Proper Prisma Relations

**File**: `turbine/generator.py` - `_generate_prisma_schema()` (~line 1250)

### Current State
Foreign keys are just String fields:
```prisma
model Todo {
  id         String   @id @default(cuid())
  todoListId String?
}
```

### Target State
Proper relations with @relation decorator:
```prisma
model Todo {
  id         String    @id @default(cuid())
  todoListId String?
  todoList   TodoList? @relation(fields: [todoListId], references: [id])
}

model TodoList {
  id    String @id @default(cuid())
  todos Todo[]
}
```

### Implementation Steps
1. Parse `relation` field in spec.py (already there)
2. Track which entities have relations to others
3. Generate @relation decorators on foreign key side
4. Generate reverse relation arrays on parent side

---

## Priority 3: Pagination/Filtering/Sorting

**File**: `turbine/generator.py` - `_generate_fastify_routes()`

Spec supports:
```yaml
features:
  pagination: true
  filtering: true
  sorting: true
```

### Target State
```typescript
app.get('/', async (request, reply) => {
  const { page = 1, limit = 20, sort, filter } = request.query
  const items = await prisma.user.findMany({
    take: limit,
    skip: (page - 1) * limit,
    orderBy: sort ? { [sort]: 'asc' } : undefined,
    where: filter ? JSON.parse(filter) : undefined,
  })
  return { data: items, page, limit, total: await prisma.user.count() }
})
```

---

## Priority 4: Auth Middleware Integration

**File**: `turbine/generator.py` - `_generate_auth()` and `_generate_fastify_routes()`

`src/auth.ts` has `verifyToken()` but it's not used.

### Target State
```typescript
// src/middleware/auth.ts
import { verifyToken } from '../auth.js'

export const authMiddleware = async (request, reply) => {
  const token = request.headers.authorization?.replace('Bearer ', '')
  if (!token) return reply.status(401).send({ error: 'No token' })
  try {
    request.user = verifyToken(token)
  } catch {
    return reply.status(401).send({ error: 'Invalid token' })
  }
}

// In routes (for protected entities)
app.addHook('preHandler', authMiddleware)
```

---

## Priority 5: Custom Endpoints

**File**: `turbine/generator.py`

Spec has `customEndpoints` section that's parsed but not generated:
```yaml
customEndpoints:
  - path: /users/me
    method: GET
    handler: getCurrentUser
    auth: required
```

Should generate route stubs for these.

---

## Priority 6: Seed Data Script

**File**: `turbine/generator.py`

Spec has `seeds` section:
```yaml
seeds:
  User:
    - email: admin@example.com
      role: admin
```

Should generate `prisma/seed.ts` that creates these records.

---

## Nice to Have

### Jinja2 Templates
Move string templates from generator.py to external `.jinja2` files:
```
turbine/templates/
├── fastify/
│   ├── route.ts.jinja2
│   └── index.ts.jinja2
├── prisma/
│   └── schema.prisma.jinja2
└── react/
    └── App.tsx.jinja2
```

### Drizzle ORM Support
Skeleton exists in `_generate_drizzle_schema()` but incomplete.

### Frontend Components
Generate React forms/tables from entities instead of just App.tsx shell.

### GraphQL Support
Spec has `graphql: true/false` flag, not implemented.

---

## Cleanup (Can Do Anytime)

Delete old TypeScript scaffolding (superseded by Python):
- `src/scaffolding/` - entire directory
- `src/cli.ts`
- `src/index.ts`
- `src/orchestrator.ts`

---

## Testing Checklist

- [x] `turbine generate` produces valid TypeScript
- [x] `turbine validate` correctly validates specs
- [x] `turbine init` creates valid spec file
- [x] Generated project passes `tsc --noEmit`
- [x] Prisma schema is valid (`npx prisma validate`)
- [ ] Generated project runs with `npm run dev`
- [ ] Generated routes work with actual database
- [ ] Auth middleware protects routes correctly
