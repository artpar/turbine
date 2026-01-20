"""
Turbine Generator - Template-based TypeScript project generation

Uses Jinja2 for templating and datamodel-code-generator for type generation.
80% deterministic scaffolding, 20% LLM gap-filling.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

from turbine.spec import (
    Entity,
    EntityField,
    FieldType,
    RelationType,
    TurbineSpec,
    field_to_prisma,
    field_to_typescript,
    field_to_zod,
)


# ═══════════════════════════════════════════════════════════════════════════
# TEMPLATE HELPERS
# ═══════════════════════════════════════════════════════════════════════════


def camel_case(s: str) -> str:
    """Convert to camelCase. Handles PascalCase input correctly."""
    import re
    # First, handle PascalCase by inserting underscores before capitals
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", s)
    # Replace hyphens and split
    parts = s.replace("-", "_").split("_")
    # First part lowercase, rest capitalized
    return parts[0].lower() + "".join(p.capitalize() for p in parts[1:])


def pascal_case(s: str) -> str:
    """Convert to PascalCase."""
    parts = s.replace("-", "_").split("_")
    # Use upper on first char only, preserve rest
    return "".join(p[0].upper() + p[1:] if p else "" for p in parts)


def snake_case(s: str) -> str:
    """Convert to snake_case."""
    import re
    s = re.sub(r"([A-Z])", r"_\1", s).lower()
    return s.lstrip("_").replace("-", "_")


def kebab_case(s: str) -> str:
    """Convert to kebab-case."""
    import re
    # First replace spaces/underscores with hyphens
    s = re.sub(r"[\s_]+", "-", s)
    # Then handle camelCase/PascalCase
    s = re.sub(r"([a-z])([A-Z])", r"\1-\2", s).lower()
    # Clean up multiple hyphens
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def plural(s: str) -> str:
    """Simple English pluralization."""
    if s.endswith("y") and not s.endswith(("ay", "ey", "iy", "oy", "uy")):
        return s[:-1] + "ies"
    if s.endswith(("s", "x", "ch", "sh")):
        return s + "es"
    return s + "s"


def singular(s: str) -> str:
    """Simple English singularization."""
    if s.endswith("ies"):
        return s[:-3] + "y"
    if s.endswith("es"):
        return s[:-2]
    if s.endswith("s"):
        return s[:-1]
    return s


# ═══════════════════════════════════════════════════════════════════════════
# GENERATED FILE TRACKING
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class GeneratedFile:
    """Represents a generated file."""

    path: str  # Relative path from output directory
    content: str
    template: str | None = None  # Source template path
    has_gaps: bool = False  # Contains TODO markers for LLM


@dataclass
class GenerationResult:
    """Result of project generation."""

    files: list[GeneratedFile] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)  # Files with gaps
    errors: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return len(self.errors) == 0


# ═══════════════════════════════════════════════════════════════════════════
# JINJA ENVIRONMENT SETUP
# ═══════════════════════════════════════════════════════════════════════════


def create_jinja_env(templates_dir: Path) -> Environment:
    """Create Jinja2 environment with custom filters and globals."""

    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )

    # String transformation filters
    env.filters["camel_case"] = camel_case
    env.filters["pascal_case"] = pascal_case
    env.filters["snake_case"] = snake_case
    env.filters["kebab_case"] = kebab_case
    env.filters["plural"] = plural
    env.filters["singular"] = singular
    env.filters["capitalize"] = str.capitalize

    # Type conversion filters
    env.filters["ts_type"] = field_to_typescript
    env.filters["zod_schema"] = field_to_zod
    env.filters["prisma_type"] = field_to_prisma

    # JSON filter
    env.filters["to_json"] = lambda x: json.dumps(x, indent=2)
    env.filters["to_yaml"] = lambda x: yaml.dump(x, default_flow_style=False)

    # Quote filter
    env.filters["quote"] = lambda x: f"'{x}'"
    env.filters["dquote"] = lambda x: f'"{x}"'

    return env


# ═══════════════════════════════════════════════════════════════════════════
# PROJECT GENERATOR
# ═══════════════════════════════════════════════════════════════════════════


class ProjectGenerator:
    """
    Generates TypeScript fullstack projects from TurbineSpec.

    Uses Jinja2 templates for scaffolding, with markers for LLM gap-filling.
    """

    def __init__(self, templates_dir: Path | None = None):
        """
        Initialize generator with templates directory.

        Args:
            templates_dir: Path to Jinja2 templates. Defaults to package templates.
        """
        if templates_dir is None:
            # Use package templates
            templates_dir = Path(__file__).parent / "templates"

        self.templates_dir = templates_dir
        self.env = create_jinja_env(templates_dir)

    def generate(self, spec: TurbineSpec, output_dir: Path) -> GenerationResult:
        """
        Generate project from spec.

        Args:
            spec: Turbine specification
            output_dir: Directory to write generated files

        Returns:
            GenerationResult with files, gaps, and errors
        """
        result = GenerationResult()
        context = self._create_context(spec)

        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate project structure
        self._generate_package_json(spec, output_dir, result)
        self._generate_tsconfig(spec, output_dir, result)
        self._generate_env_files(spec, output_dir, result)
        self._generate_docker_files(spec, output_dir, result)

        # Generate based on stack
        if spec.stack.backend:
            self._generate_backend(spec, output_dir, context, result)

        if spec.stack.frontend:
            self._generate_frontend(spec, output_dir, context, result)

        if spec.stack.orm:
            self._generate_orm(spec, output_dir, context, result)

        # Generate CI/CD
        if spec.cicd:
            self._generate_cicd(spec, output_dir, context, result)

        # Identify gaps for LLM filling
        result.gaps = [f.path for f in result.files if f.has_gaps]

        return result

    def _create_context(self, spec: TurbineSpec) -> dict[str, Any]:
        """Create template rendering context."""
        return {
            "spec": spec,
            "project": spec.project,
            "stack": spec.stack,
            "features": spec.features,
            "entities": spec.entities,
            "cicd": spec.cicd,
            "env": spec.env,
            "custom_endpoints": spec.custom_endpoints,
            # Helpers
            "camel_case": camel_case,
            "pascal_case": pascal_case,
            "snake_case": snake_case,
            "kebab_case": kebab_case,
            "plural": plural,
            "singular": singular,
            "ts_type": field_to_typescript,
            "zod_schema": field_to_zod,
            "prisma_type": field_to_prisma,
        }

    def _render_template(
        self,
        template_path: str,
        context: dict[str, Any],
    ) -> str:
        """Render a Jinja2 template."""
        template = self.env.get_template(template_path)
        return template.render(**context)

    def _write_file(
        self,
        output_dir: Path,
        relative_path: str,
        content: str,
        result: GenerationResult,
        template: str | None = None,
    ) -> None:
        """Write a generated file and track it."""
        full_path = output_dir / relative_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content)

        has_gaps = "// TODO:" in content or "/* GAP:" in content
        result.files.append(GeneratedFile(
            path=relative_path,
            content=content,
            template=template,
            has_gaps=has_gaps,
        ))

    # ═══════════════════════════════════════════════════════════════════════
    # CORE CONFIG FILES
    # ═══════════════════════════════════════════════════════════════════════

    def _generate_package_json(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate package.json with appropriate dependencies."""

        deps: dict[str, str] = {}
        dev_deps: dict[str, str] = {
            "typescript": "^5.3.0",
            "@types/node": "^20.10.0",
        }
        scripts: dict[str, str] = {
            "build": "tsc",
            "dev": "tsx watch src/index.ts",
        }

        # Backend dependencies
        if spec.stack.backend == "fastify":
            deps.update({
                "fastify": "^4.25.0",
                "@fastify/cors": "^8.5.0",
                "@fastify/helmet": "^11.1.0",
            })
            if spec.features.openapi:
                deps["@fastify/swagger"] = "^8.12.0"
                deps["@fastify/swagger-ui"] = "^2.0.0"
            scripts["start"] = "node dist/index.js"
        elif spec.stack.backend == "express":
            deps.update({
                "express": "^4.18.0",
                "cors": "^2.8.5",
                "helmet": "^7.1.0",
            })
            dev_deps["@types/express"] = "^4.17.0"
            scripts["start"] = "node dist/index.js"

        # Frontend dependencies
        if spec.stack.frontend == "react":
            deps.update({
                "react": "^18.2.0",
                "react-dom": "^18.2.0",
            })
            dev_deps.update({
                "@types/react": "^18.2.0",
                "@types/react-dom": "^18.2.0",
                "vite": "^5.0.0",
                "@vitejs/plugin-react": "^4.2.0",
            })

        # ORM dependencies
        if spec.stack.orm == "prisma":
            deps["@prisma/client"] = "^5.7.0"
            dev_deps["prisma"] = "^5.7.0"
            scripts["db:generate"] = "prisma generate"
            scripts["db:push"] = "prisma db push"
            scripts["db:migrate"] = "prisma migrate dev"
        elif spec.stack.orm == "drizzle":
            deps["drizzle-orm"] = "^0.29.0"
            dev_deps["drizzle-kit"] = "^0.20.0"

        # Auth dependencies
        if spec.stack.auth == "jwt":
            deps["jsonwebtoken"] = "^9.0.0"
            deps["bcrypt"] = "^5.1.0"
            dev_deps["@types/jsonwebtoken"] = "^9.0.0"
            dev_deps["@types/bcrypt"] = "^5.0.0"

        # Validation
        deps["zod"] = "^3.22.0"

        # Testing
        if spec.stack.testing:
            if "vitest" in spec.stack.testing:
                dev_deps["vitest"] = "^1.0.0"
                scripts["test"] = "vitest"
                scripts["test:coverage"] = "vitest --coverage"
            if "jest" in spec.stack.testing:
                dev_deps["jest"] = "^29.7.0"
                dev_deps["@types/jest"] = "^29.5.0"
                dev_deps["ts-jest"] = "^29.1.0"
                scripts["test"] = "jest"

        # Observability
        if spec.features.logging:
            deps["pino"] = "^8.17.0"
            deps["pino-pretty"] = "^10.3.0"
        if spec.features.metrics:
            deps["prom-client"] = "^15.1.0"

        package_json = {
            "name": kebab_case(spec.project.name),
            "version": spec.project.version,
            "description": spec.project.description,
            "type": "module",
            "main": "dist/index.js",
            "scripts": scripts,
            "dependencies": deps,
            "devDependencies": dev_deps,
            "engines": {"node": ">=20.0.0"},
        }

        if spec.project.author:
            package_json["author"] = spec.project.author
        if spec.project.license:
            package_json["license"] = spec.project.license

        content = json.dumps(package_json, indent=2) + "\n"
        self._write_file(output_dir, "package.json", content, result)

    def _generate_tsconfig(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate tsconfig.json."""

        tsconfig = {
            "compilerOptions": {
                "target": "ES2022",
                "module": "NodeNext",
                "moduleResolution": "NodeNext",
                "lib": ["ES2022"],
                "outDir": "./dist",
                "rootDir": "./src",
                "strict": True,
                "esModuleInterop": True,
                "skipLibCheck": True,
                "forceConsistentCasingInFileNames": True,
                "resolveJsonModule": True,
                "declaration": True,
                "declarationMap": True,
                "sourceMap": True,
            },
            "include": ["src/**/*"],
            "exclude": ["node_modules", "dist"],
        }

        # Add React-specific settings
        if spec.stack.frontend == "react":
            tsconfig["compilerOptions"]["jsx"] = "react-jsx"
            tsconfig["compilerOptions"]["lib"].append("DOM")

        content = json.dumps(tsconfig, indent=2) + "\n"
        self._write_file(output_dir, "tsconfig.json", content, result)

    def _generate_env_files(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate .env.example and .gitignore."""

        # .env.example
        env_lines = ["# Environment Variables", "# Copy to .env and fill in values", ""]

        for name, config in (spec.env or {}).items():
            if config.description:
                env_lines.append(f"# {config.description}")
            default = config.default or ""
            # Provide sensible placeholder examples for common vars
            if not default and name == "DATABASE_URL":
                default = "postgresql://user:password@localhost:5432/dbname"
            elif not default and name == "JWT_SECRET":
                default = "your-secret-key-change-in-production"
            env_lines.append(f"{name}={default}")
            env_lines.append("")

        self._write_file(output_dir, ".env.example", "\n".join(env_lines), result)

        # .gitignore
        gitignore = """# Dependencies
node_modules/

# Build output
dist/
build/
.next/

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
.nyc_output/

# Prisma
prisma/*.db
prisma/*.db-journal
"""
        self._write_file(output_dir, ".gitignore", gitignore, result)

    def _generate_docker_files(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate Dockerfile and docker-compose.yml."""

        if not spec.stack.containerization:
            return

        # Dockerfile
        dockerfile = """# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
"""
        self._write_file(output_dir, "Dockerfile", dockerfile, result)

        # docker-compose.yml
        services: dict[str, Any] = {
            "app": {
                "build": ".",
                "ports": ["3000:3000"],
                "environment": [
                    "NODE_ENV=development",
                ],
                "volumes": [
                    "./src:/app/src:ro",
                ],
                "depends_on": [],
            }
        }

        # Add database service
        if spec.stack.database == "postgresql":
            services["app"]["environment"].append("DATABASE_URL=postgresql://postgres:postgres@db:5432/app")
            services["app"]["depends_on"].append("db")
            services["db"] = {
                "image": "postgres:16-alpine",
                "environment": {
                    "POSTGRES_USER": "postgres",
                    "POSTGRES_PASSWORD": "postgres",
                    "POSTGRES_DB": "app",
                },
                "ports": ["5432:5432"],
                "volumes": ["postgres_data:/var/lib/postgresql/data"],
            }
        elif spec.stack.database == "mysql":
            services["app"]["environment"].append("DATABASE_URL=mysql://root:root@db:3306/app")
            services["app"]["depends_on"].append("db")
            services["db"] = {
                "image": "mysql:8",
                "environment": {
                    "MYSQL_ROOT_PASSWORD": "root",
                    "MYSQL_DATABASE": "app",
                },
                "ports": ["3306:3306"],
                "volumes": ["mysql_data:/var/lib/mysql"],
            }

        compose = {
            "version": "3.8",
            "services": services,
            "volumes": {},
        }

        if spec.stack.database == "postgresql":
            compose["volumes"]["postgres_data"] = {}
        elif spec.stack.database == "mysql":
            compose["volumes"]["mysql_data"] = {}

        content = yaml.dump(compose, default_flow_style=False, sort_keys=False)
        self._write_file(output_dir, "docker-compose.yml", content, result)

    # ═══════════════════════════════════════════════════════════════════════
    # BACKEND GENERATION
    # ═══════════════════════════════════════════════════════════════════════

    def _generate_backend(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        context: dict[str, Any],
        result: GenerationResult,
    ) -> None:
        """Generate backend code."""

        # Generate entry point
        self._generate_backend_entry(spec, output_dir, result)

        # Generate shared types from entities
        self._generate_types(spec, output_dir, result)

        # Generate routes for each entity
        for entity in spec.entities:
            self._generate_entity_routes(spec, entity, output_dir, result)

        # Generate auth if enabled
        if spec.stack.auth:
            self._generate_auth(spec, output_dir, result)

        # Generate middleware
        self._generate_middleware(spec, output_dir, result)

        # Generate query builder utilities
        self._generate_query_builder(spec, output_dir, result)

    def _generate_backend_entry(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate backend entry point (index.ts)."""

        if spec.stack.backend == "fastify":
            content = self._generate_fastify_entry(spec)
        elif spec.stack.backend == "express":
            content = self._generate_express_entry(spec)
        else:
            return

        self._write_file(output_dir, "src/index.ts", content, result)

    def _generate_fastify_entry(self, spec: TurbineSpec) -> str:
        """Generate Fastify server entry point."""

        imports = ["import Fastify from 'fastify'"]
        plugins = []
        hooks = []

        if spec.features.cors:
            imports.append("import cors from '@fastify/cors'")
            plugins.append("await app.register(cors)")

        # Import auth middleware if auth is enabled
        if spec.stack.auth:
            imports.append("import { authMiddleware } from './middleware/auth.js'")
            hooks.append("app.addHook('onRequest', authMiddleware)")

        # Import tenant middleware if tenancy is enabled
        if spec.tenancy and spec.tenancy.enabled:
            imports.append("import { tenantMiddleware } from './middleware/tenant.js'")
            hooks.append("app.addHook('onRequest', tenantMiddleware)")

        if spec.features.openapi:
            imports.append("import swagger from '@fastify/swagger'")
            imports.append("import swaggerUi from '@fastify/swagger-ui'")
            plugins.append(f"""await app.register(swagger, {{
  openapi: {{
    info: {{
      title: '{spec.project.name}',
      version: '{spec.project.version}',
    }},
  }},
}})
await app.register(swaggerUi, {{ routePrefix: '/docs' }})""")

        if spec.features.logging:
            imports.append("import pino from 'pino'")

        # Import routes
        for entity in spec.entities:
            name = camel_case(entity.name)
            imports.append(f"import {{ {name}Routes }} from './routes/{kebab_case(entity.name)}.js'")

        # Register routes
        route_registrations = []
        for entity in spec.entities:
            name = camel_case(entity.name)
            prefix = "/" + kebab_case(entity.plural or plural(entity.name))
            route_registrations.append(f"app.register({name}Routes, {{ prefix: '{prefix}' }})")

        # Build hooks section
        hooks_section = ""
        if hooks:
            hooks_section = f"""
// Auth hooks
{chr(10).join(hooks)}
"""

        content = f"""{chr(10).join(imports)}

const app = Fastify({{
  logger: {str(spec.features.logging).lower()},
}})

// Plugins
{chr(10).join(plugins)}
{hooks_section}
// Routes
{chr(10).join(route_registrations)}

// Health check
app.get('/health', async () => ({{ status: 'ok' }}))

// Start server
const start = async () => {{
  try {{
    const port = parseInt(process.env.PORT || '3000', 10)
    await app.listen({{ port, host: '0.0.0.0' }})
    console.log(`Server running on port ${{port}}`)
  }} catch (err) {{
    app.log.error(err)
    process.exit(1)
  }}
}}

start()
"""
        return content

    def _generate_express_entry(self, spec: TurbineSpec) -> str:
        """Generate Express server entry point."""

        imports = [
            "import express from 'express'",
            "import helmet from 'helmet'",
        ]

        if spec.features.cors:
            imports.append("import cors from 'cors'")

        # Import routes
        for entity in spec.entities:
            name = camel_case(entity.name)
            imports.append(f"import {{ {name}Router }} from './routes/{kebab_case(entity.name)}.js'")

        middleware = ["app.use(helmet())", "app.use(express.json())"]
        if spec.features.cors:
            middleware.append("app.use(cors())")

        # Register routes
        route_registrations = []
        for entity in spec.entities:
            name = camel_case(entity.name)
            prefix = "/" + kebab_case(entity.plural or plural(entity.name))
            route_registrations.append(f"app.use('{prefix}', {name}Router)")

        content = f"""{chr(10).join(imports)}

const app = express()

// Middleware
{chr(10).join(middleware)}

// Routes
{chr(10).join(route_registrations)}

// Health check
app.get('/health', (req, res) => res.json({{ status: 'ok' }}))

// Start server
const port = parseInt(process.env.PORT || '3000', 10)
app.listen(port, () => {{
  console.log(`Server running on port ${{port}}`)
}})

export default app
"""
        return content

    def _generate_types(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate TypeScript types and Zod schemas from entities."""

        type_imports = ["import { z } from 'zod'"]
        type_definitions = []
        schema_definitions = []

        for entity in spec.entities:
            name = pascal_case(entity.name)

            # Collect fields
            fields_ts = []
            fields_zod = []

            # Always add id
            fields_ts.append("  id: string")
            fields_zod.append("  id: z.string().uuid()")

            for field in entity.fields:
                ts_type = field_to_typescript(field)
                zod_type = field_to_zod(field)

                optional = "?" if not (field.validation and field.validation.required) else ""
                fields_ts.append(f"  {field.name}{optional}: {ts_type}")
                fields_zod.append(f"  {field.name}: {zod_type}")

            # Add timestamps
            if entity.timestamps:
                fields_ts.extend([
                    "  createdAt: Date",
                    "  updatedAt: Date",
                ])
                fields_zod.extend([
                    "  createdAt: z.date()",
                    "  updatedAt: z.date()",
                ])

            # TypeScript interface
            type_definitions.append(f"""export interface {name} {{
{chr(10).join(fields_ts)}
}}""")

            # Zod schema - add commas between fields
            zod_fields_with_commas = ",\n".join(fields_zod)
            schema_definitions.append(f"""export const {name}Schema = z.object({{
{zod_fields_with_commas},
}})

export type {name}Input = z.infer<typeof {name}Schema>""")

        content = f"""{chr(10).join(type_imports)}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

{chr(10).join(type_definitions)}

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

{chr(10).join(schema_definitions)}
"""

        self._write_file(output_dir, "src/types.ts", content, result)

    def _generate_entity_routes(
        self,
        spec: TurbineSpec,
        entity: Entity,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate CRUD routes for an entity."""

        name = pascal_case(entity.name)
        name_lower = camel_case(entity.name)
        file_name = kebab_case(entity.name)
        operations = entity.operations or ["create", "read", "update", "delete", "list"]

        if spec.stack.backend == "fastify":
            content = self._generate_fastify_routes(spec, entity, operations)
        elif spec.stack.backend == "express":
            content = self._generate_express_routes(entity, operations)
        else:
            return

        self._write_file(output_dir, f"src/routes/{file_name}.ts", content, result)

    def _generate_fastify_routes(self, spec: TurbineSpec, entity: Entity, operations: list[str]) -> str:
        """Generate Fastify routes for entity with real Prisma queries."""

        name = pascal_case(entity.name)
        name_lower = camel_case(entity.name)
        db_model = camel_case(entity.name)

        # Check if auth is enabled
        has_auth = spec.stack.auth is not None

        # Get ownership config
        ownership = entity.ownership
        has_ownership = ownership is not None and (ownership.track_creator or ownership.track_modifier)

        # Get identity config for user entity check
        identity = spec.identity
        user_entity = identity.user_entity if identity else "User"
        is_user_entity = entity.name == user_entity

        # Collect filterable and searchable fields
        filterable_fields = []
        searchable_fields = []
        sortable_fields = ["createdAt"]  # Always sortable

        for field in entity.fields:
            if field.filterable:
                filterable_fields.append(field.name)
            if field.searchable:
                searchable_fields.append(field.name)
            if field.sortable:
                sortable_fields.append(field.name)

        # Build imports
        imports = [
            "import { FastifyPluginAsync } from 'fastify'",
            f"import {{ {name}, {name}Schema }} from '../types.js'",
            "import { db } from '../db.js'",
            "import { buildWhere, buildOrderBy, buildPagination, parseQueryParams, addPaginationHeaders } from '../utils/query-builder.js'",
        ]

        if has_auth:
            imports.append("import { requireAuth, requireRole } from '../middleware/auth.js'")

        # Build pre-handlers list for protected routes
        pre_handlers = "[requireAuth]" if has_auth else "[]"

        content = f"""{chr(10).join(imports)}

export const {name_lower}Routes: FastifyPluginAsync = async (app) => {{
"""

        # Generate field lists as constants (add type annotation for empty arrays)
        filterable_type = ": string[]" if not filterable_fields else ""
        searchable_type = ": string[]" if not searchable_fields else ""
        sortable_type = ": string[]" if not sortable_fields else ""
        content += f"""
  // Field configuration
  const filterableFields{filterable_type} = {json.dumps(filterable_fields)}
  const searchableFields{searchable_type} = {json.dumps(searchable_fields)}
  const sortableFields{sortable_type} = {json.dumps(sortable_fields)}
"""

        # LIST operation
        if "list" in operations:
            # Build where filter with ownership if applicable
            ownership_filter = ""
            if has_ownership and not is_user_entity and has_auth:
                auto_filter_field = ownership.auto_filter_field if ownership else "createdById"
                if ownership and ownership.auto_filter:
                    ownership_filter = f"""
      // Auto-filter by ownership (unless admin)
      if (request.user?.role !== 'admin') {{
        additionalFilters.{auto_filter_field} = request.user?.userId
      }}"""

            soft_delete_filter = ""
            if entity.soft_delete:
                soft_delete_filter = "\n      additionalFilters.deletedAt = null"

            content += f"""
  // List all {entity.plural or plural(entity.name).lower()}
  app.get('/', {{
    preHandler: {pre_handlers},
  }}, async (request, reply) => {{
    const params = parseQueryParams(request.query as Record<string, string>)
    const {{ skip, take }} = buildPagination(params)

    // Build filters
    const additionalFilters: Record<string, any> = {{}}{ownership_filter}{soft_delete_filter}

    const where = buildWhere(params, filterableFields, searchableFields, additionalFilters)
    const orderBy = buildOrderBy(params, sortableFields)

    const [items, total] = await Promise.all([
      db.{db_model}.findMany({{
        where,
        orderBy,
        skip,
        take,
      }}),
      db.{db_model}.count({{ where }}),
    ])

    addPaginationHeaders(reply, total, skip, take)
    return items
  }})
"""

        # READ operation
        if "read" in operations:
            ownership_check = ""
            if has_ownership and not is_user_entity and has_auth:
                auto_filter_field = ownership.auto_filter_field if ownership else "createdById"
                if ownership and ownership.auto_filter:
                    ownership_check = f"""
    // Check ownership (unless admin)
    if (item && request.user?.role !== 'admin' && item.{auto_filter_field} !== request.user?.userId) {{
      return reply.status(403).send({{ error: 'Forbidden' }})
    }}
"""

            soft_delete_where = ", deletedAt: null" if entity.soft_delete else ""

            content += f"""
  // Get single {entity.name.lower()} by ID
  app.get<{{ Params: {{ id: string }} }}>('/:id', {{
    preHandler: {pre_handlers},
  }}, async (request, reply) => {{
    const {{ id }} = request.params

    const item = await db.{db_model}.findFirst({{
      where: {{ id{soft_delete_where} }},
    }})

    if (!item) {{
      return reply.status(404).send({{ error: 'Not found' }})
    }}
{ownership_check}
    return item
  }})
"""

        # CREATE operation
        if "create" in operations:
            # Build ownership injection
            ownership_injection = ""
            if has_ownership and not is_user_entity and has_auth:
                if ownership and ownership.track_creator:
                    ownership_injection = f"\n        createdById: request.user!.userId,"

            content += f"""
  // Create new {entity.name.lower()}
  app.post('/', {{
    preHandler: {pre_handlers},
  }}, async (request, reply) => {{
    const data = {name}Schema.omit({{ id: true, createdAt: true, updatedAt: true }}).parse(request.body)

    const item = await db.{db_model}.create({{
      data: {{
        ...data as any,{ownership_injection}
      }},
    }})

    return reply.status(201).send(item)
  }})
"""

        # UPDATE operation
        if "update" in operations:
            ownership_check = ""
            if has_ownership and not is_user_entity and has_auth:
                auto_filter_field = ownership.auto_filter_field if ownership else "createdById"
                if ownership and ownership.auto_filter:
                    ownership_check = f"""
    // Check ownership (unless admin)
    if (existing && request.user?.role !== 'admin' && existing.{auto_filter_field} !== request.user?.userId) {{
      return reply.status(403).send({{ error: 'Forbidden' }})
    }}
"""

            modifier_injection = ""
            if has_ownership and not is_user_entity and has_auth:
                if ownership and ownership.track_modifier:
                    modifier_injection = f"\n        updatedById: request.user!.userId,"

            soft_delete_where = ", deletedAt: null" if entity.soft_delete else ""

            content += f"""
  // Update {entity.name.lower()}
  app.put<{{ Params: {{ id: string }} }}>('/:id', {{
    preHandler: {pre_handlers},
  }}, async (request, reply) => {{
    const {{ id }} = request.params
    const data = {name}Schema.partial().parse(request.body)

    // Check if exists
    const existing = await db.{db_model}.findFirst({{
      where: {{ id{soft_delete_where} }},
    }})

    if (!existing) {{
      return reply.status(404).send({{ error: 'Not found' }})
    }}
{ownership_check}
    const item = await db.{db_model}.update({{
      where: {{ id }},
      data: {{
        ...data as any,{modifier_injection}
      }},
    }})

    return item
  }})
"""

        # DELETE operation
        if "delete" in operations:
            ownership_check = ""
            if has_ownership and not is_user_entity and has_auth:
                auto_filter_field = ownership.auto_filter_field if ownership else "createdById"
                if ownership and ownership.auto_filter:
                    ownership_check = f"""
    // Check ownership (unless admin)
    if (existing && request.user?.role !== 'admin' && existing.{auto_filter_field} !== request.user?.userId) {{
      return reply.status(403).send({{ error: 'Forbidden' }})
    }}
"""

            soft_delete_where = ", deletedAt: null" if entity.soft_delete else ""

            # Use soft delete if configured
            if entity.soft_delete:
                delete_operation = f"""const item = await db.{db_model}.update({{
      where: {{ id }},
      data: {{ deletedAt: new Date() }},
    }})"""
            else:
                delete_operation = f"""await db.{db_model}.delete({{
      where: {{ id }},
    }})"""

            content += f"""
  // Delete {entity.name.lower()}
  app.delete<{{ Params: {{ id: string }} }}>('/:id', {{
    preHandler: {pre_handlers},
  }}, async (request, reply) => {{
    const {{ id }} = request.params

    // Check if exists
    const existing = await db.{db_model}.findFirst({{
      where: {{ id{soft_delete_where} }},
    }})

    if (!existing) {{
      return reply.status(404).send({{ error: 'Not found' }})
    }}
{ownership_check}
    {delete_operation}

    return reply.status(204).send()
  }})
"""

        content += "}\n"
        return content

    def _generate_express_routes(self, entity: Entity, operations: list[str]) -> str:
        """Generate Express routes for entity."""

        name = pascal_case(entity.name)
        name_lower = camel_case(entity.name)

        content = f"""import {{ Router }} from 'express'
import {{ {name}, {name}Schema }} from '../types.js'

export const {name_lower}Router = Router()

// TODO: Import your database client/ORM here
// import {{ db }} from '../db.js'
"""

        if "list" in operations:
            content += f"""
// List all {entity.plural or plural(entity.name).lower()}
{name_lower}Router.get('/', async (req, res) => {{
  // TODO: Implement list query with pagination
  /* GAP: List {entity.name} implementation */
  const items: {name}[] = []
  res.json(items)
}})
"""

        if "read" in operations:
            content += f"""
// Get single {entity.name.lower()} by ID
{name_lower}Router.get('/:id', async (req, res) => {{
  const {{ id }} = req.params
  // TODO: Implement find by ID
  /* GAP: Get {entity.name} by ID implementation */
  res.status(404).json({{ error: 'Not found' }})
}})
"""

        if "create" in operations:
            content += f"""
// Create new {entity.name.lower()}
{name_lower}Router.post('/', async (req, res) => {{
  const data = {name}Schema.omit({{ id: true, createdAt: true, updatedAt: true }}).parse(req.body)
  // TODO: Implement create
  /* GAP: Create {entity.name} implementation */
  res.status(201).json(data)
}})
"""

        if "update" in operations:
            content += f"""
// Update {entity.name.lower()}
{name_lower}Router.put('/:id', async (req, res) => {{
  const {{ id }} = req.params
  const data = {name}Schema.partial().parse(req.body)
  // TODO: Implement update
  /* GAP: Update {entity.name} implementation */
  res.status(404).json({{ error: 'Not found' }})
}})
"""

        if "delete" in operations:
            content += f"""
// Delete {entity.name.lower()}
{name_lower}Router.delete('/:id', async (req, res) => {{
  const {{ id }} = req.params
  // TODO: Implement delete
  /* GAP: Delete {entity.name} implementation */
  res.status(204).send()
}})
"""

        return content

    def _generate_auth(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate authentication code."""

        if spec.stack.auth == "jwt":
            content = """import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import type { StringValue } from 'ms'

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as StringValue

export interface TokenPayload {
  userId: string
  email: string
  role: string
}

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10)
}

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload
}

// TODO: Implement authentication middleware
/* GAP: Authentication middleware implementation
   - Extract token from Authorization header
   - Verify token and attach user to request
   - Handle expired/invalid tokens
*/
"""
            self._write_file(output_dir, "src/auth.ts", content, result)

    def _generate_middleware(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate common middleware."""

        content = """// Common middleware

export const errorHandler = (err: Error, req: any, res: any, next: any) => {
  console.error(err.stack)

  // Zod validation error
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation error',
      details: (err as any).errors,
    })
  }

  // Generic error
  res.status(500).json({
    error: 'Internal server error',
  })
}

// TODO: Add rate limiting middleware
/* GAP: Rate limiting implementation */

// TODO: Add request logging middleware
/* GAP: Request logging implementation */
"""
        self._write_file(output_dir, "src/middleware.ts", content, result)

        # Generate auth middleware if auth is enabled
        if spec.stack.auth:
            self._generate_auth_middleware(spec, output_dir, result)

    def _generate_auth_middleware(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate authentication middleware with JWT support."""

        # Get identity config
        identity = spec.identity
        user_entity = identity.user_entity if identity else "User"
        role_field = identity.fields.role if identity else "role"

        content = f"""import {{ FastifyRequest, FastifyReply }} from 'fastify'
import {{ verifyToken, TokenPayload }} from '../auth.js'

// Extend Fastify request type to include user
declare module 'fastify' {{
  interface FastifyRequest {{
    user: TokenPayload | null
  }}
}}

/**
 * Auth middleware - extracts JWT from Authorization header and attaches user to request.
 * Does NOT block unauthenticated requests - use requireAuth for that.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {{
  const authHeader = request.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {{
    request.user = null
    return
  }}

  try {{
    const token = authHeader.slice(7)
    request.user = verifyToken(token)
  }} catch {{
    request.user = null
  }}
}}

/**
 * Require authentication - returns 401 if not authenticated.
 * Use as preHandler: [requireAuth]
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {{
  if (!request.user) {{
    return reply.status(401).send({{ error: 'Unauthorized', message: 'Authentication required' }})
  }}
}}

/**
 * Require specific role(s) - returns 403 if user doesn't have required role.
 * Use as preHandler: [requireAuth, requireRole('admin')]
 * @param roles - One or more roles that are allowed
 */
export function requireRole(...roles: string[]) {{
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {{
    if (!request.user) {{
      return reply.status(401).send({{ error: 'Unauthorized', message: 'Authentication required' }})
    }}

    if (!roles.includes(request.user.{role_field})) {{
      return reply.status(403).send({{
        error: 'Forbidden',
        message: `Required role: ${{roles.join(' or ')}}`
      }})
    }}
  }}
}}

/**
 * Optional auth - extracts user if present but doesn't require it.
 * Useful for endpoints that behave differently for authenticated users.
 * Use as preHandler: [optionalAuth]
 */
export const optionalAuth = authMiddleware
"""
        self._write_file(output_dir, "src/middleware/auth.ts", content, result)

        # Generate tenant middleware if tenancy is enabled
        if spec.tenancy and spec.tenancy.enabled:
            self._generate_tenant_middleware(spec, output_dir, result)

    def _generate_tenant_middleware(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate tenant middleware for multi-tenancy support."""

        tenancy = spec.tenancy
        if not tenancy:
            return

        tenant_entity = pascal_case(tenancy.tenant_entity)
        tenant_field = tenancy.tenant_field

        content = f"""import {{ FastifyRequest, FastifyReply }} from 'fastify'
import {{ db }} from '../db.js'

export interface TenantContext {{
  id: string
  slug: string
  name: string
}}

// Extend Fastify request type to include tenant
declare module 'fastify' {{
  interface FastifyRequest {{
    tenant: TenantContext | null
  }}
}}

/**
 * Tenant middleware - extracts tenant from request.
 * Checks X-Tenant-ID header, subdomain, or path parameter.
 */
export async function tenantMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {{
  let tenantId: string | null = null
  let tenantSlug: string | null = null

  // 1. Check X-Tenant-ID header (takes priority)
  const headerTenantId = request.headers['x-tenant-id'] as string | undefined
  if (headerTenantId) {{
    tenantId = headerTenantId
  }}

  // 2. Check X-Tenant-Slug header
  const headerTenantSlug = request.headers['x-tenant-slug'] as string | undefined
  if (!tenantId && headerTenantSlug) {{
    tenantSlug = headerTenantSlug
  }}

  // 3. Check subdomain (e.g., acme.example.com)
  if (!tenantId && !tenantSlug) {{
    const host = request.headers.host || ''
    const parts = host.split('.')
    // If host has at least 3 parts, first part is subdomain
    if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'api') {{
      tenantSlug = parts[0]
    }}
  }}

  // 4. Check path parameter (e.g., /tenant/:tenantSlug/...)
  const params = request.params as Record<string, string>
  if (!tenantId && !tenantSlug && params.tenantSlug) {{
    tenantSlug = params.tenantSlug
  }}

  // No tenant identifier found
  if (!tenantId && !tenantSlug) {{
    request.tenant = null
    return
  }}

  try {{
    // Look up tenant in database
    let tenant: TenantContext | null = null

    if (tenantId) {{
      const result = await db.{camel_case(tenancy.tenant_entity)}.findUnique({{
        where: {{ id: tenantId }},
        select: {{ id: true, slug: true, name: true }},
      }})
      tenant = result as TenantContext | null
    }} else if (tenantSlug) {{
      const result = await db.{camel_case(tenancy.tenant_entity)}.findUnique({{
        where: {{ slug: tenantSlug }},
        select: {{ id: true, slug: true, name: true }},
      }})
      tenant = result as TenantContext | null
    }}

    request.tenant = tenant
  }} catch (err) {{
    request.tenant = null
  }}
}}

/**
 * Require tenant - returns 400 if no tenant context.
 * Use as preHandler: [requireTenant]
 */
export async function requireTenant(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {{
  if (!request.tenant) {{
    return reply.status(400).send({{
      error: 'Bad Request',
      message: 'Tenant context required. Provide X-Tenant-ID header, X-Tenant-Slug header, or use subdomain.'
    }})
  }}
}}

/**
 * Get tenant filter for Prisma queries.
 * Returns filter object with {tenant_field} set to current tenant.
 */
export function getTenantFilter(request: FastifyRequest): {{ {tenant_field}: string }} | {{}} {{
  if (!request.tenant) {{
    return {{}}
  }}
  return {{ {tenant_field}: request.tenant.id }}
}}
"""
        self._write_file(output_dir, "src/middleware/tenant.ts", content, result)

    def _generate_query_builder(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate query builder utilities for filtering, sorting, and pagination."""

        content = """import { Prisma } from '@prisma/client'

/**
 * Query parameters for list endpoints.
 */
export interface QueryParams {
  // Pagination
  skip?: number
  take?: number
  cursor?: string

  // Sorting
  sortBy?: string
  sortDir?: 'asc' | 'desc'

  // Full-text search
  q?: string

  // Field filters (dynamic)
  [key: string]: string | number | boolean | string[] | undefined
}

/**
 * Build Prisma where clause from query parameters.
 *
 * @param params - Query parameters from request
 * @param filterableFields - Fields that can be filtered
 * @param searchableFields - Fields to search with 'q' parameter
 * @param additionalFilters - Extra filters (e.g., ownership, tenancy)
 */
export function buildWhere<T extends Record<string, any>>(
  params: QueryParams,
  filterableFields: string[],
  searchableFields: string[],
  additionalFilters: Partial<T> = {}
): T {
  const where: Record<string, any> = { ...additionalFilters }

  // Field filters
  for (const field of filterableFields) {
    // Exact match
    if (params[field] !== undefined) {
      where[field] = params[field]
    }

    // Contains (case-insensitive)
    const containsKey = `${field}.contains`
    if (params[containsKey]) {
      where[field] = {
        contains: params[containsKey] as string,
        mode: 'insensitive',
      }
    }

    // Starts with
    const startsWithKey = `${field}.startsWith`
    if (params[startsWithKey]) {
      where[field] = {
        startsWith: params[startsWithKey] as string,
        mode: 'insensitive',
      }
    }

    // In array
    const inKey = `${field}.in`
    if (params[inKey]) {
      const values = Array.isArray(params[inKey])
        ? params[inKey]
        : (params[inKey] as string).split(',')
      where[field] = { in: values }
    }

    // Not equal
    const neKey = `${field}.ne`
    if (params[neKey] !== undefined) {
      where[field] = { not: params[neKey] }
    }

    // Greater than
    const gtKey = `${field}.gt`
    if (params[gtKey] !== undefined) {
      where[field] = { ...where[field], gt: params[gtKey] }
    }

    // Greater than or equal
    const gteKey = `${field}.gte`
    if (params[gteKey] !== undefined) {
      where[field] = { ...where[field], gte: params[gteKey] }
    }

    // Less than
    const ltKey = `${field}.lt`
    if (params[ltKey] !== undefined) {
      where[field] = { ...where[field], lt: params[ltKey] }
    }

    // Less than or equal
    const lteKey = `${field}.lte`
    if (params[lteKey] !== undefined) {
      where[field] = { ...where[field], lte: params[lteKey] }
    }
  }

  // Full-text search across searchable fields
  if (params.q && searchableFields.length > 0) {
    where.OR = searchableFields.map(field => ({
      [field]: {
        contains: params.q,
        mode: 'insensitive',
      },
    }))
  }

  return where as T
}

/**
 * Build Prisma orderBy clause from query parameters.
 *
 * @param params - Query parameters from request
 * @param sortableFields - Fields that can be sorted
 * @param defaultField - Default sort field
 * @param defaultDir - Default sort direction
 */
export function buildOrderBy(
  params: QueryParams,
  sortableFields: string[],
  defaultField: string = 'createdAt',
  defaultDir: 'asc' | 'desc' = 'desc'
): Record<string, 'asc' | 'desc'> {
  const field = sortableFields.includes(params.sortBy || '')
    ? params.sortBy!
    : defaultField

  const dir = params.sortDir || defaultDir

  return { [field]: dir }
}

/**
 * Build pagination parameters.
 *
 * @param params - Query parameters from request
 * @param defaultLimit - Default page size
 * @param maxLimit - Maximum page size
 */
export function buildPagination(
  params: QueryParams,
  defaultLimit: number = 20,
  maxLimit: number = 100
): { skip: number; take: number } {
  const take = Math.min(
    Math.max(1, params.take || defaultLimit),
    maxLimit
  )

  const skip = Math.max(0, params.skip || 0)

  return { skip, take }
}

/**
 * Parse query string into QueryParams.
 * Handles type coercion for numbers and booleans.
 */
export function parseQueryParams(query: Record<string, string | string[]>): QueryParams {
  const params: QueryParams = {}

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      params[key] = value
      continue
    }

    // Try to parse as number
    const num = parseFloat(value)
    if (!isNaN(num) && isFinite(num)) {
      params[key] = num
      continue
    }

    // Try to parse as boolean
    if (value === 'true') {
      params[key] = true
      continue
    }
    if (value === 'false') {
      params[key] = false
      continue
    }

    // Keep as string
    params[key] = value
  }

  return params
}

/**
 * Add pagination headers to response.
 */
export function addPaginationHeaders(
  reply: { header: (name: string, value: string | number) => void },
  total: number,
  skip: number,
  take: number
): void {
  reply.header('X-Total-Count', total)
  reply.header('X-Page-Size', take)
  reply.header('X-Page-Offset', skip)
  reply.header('X-Has-More', skip + take < total ? 'true' : 'false')
}
"""
        self._write_file(output_dir, "src/utils/query-builder.ts", content, result)

    # ═══════════════════════════════════════════════════════════════════════
    # FRONTEND GENERATION
    # ═══════════════════════════════════════════════════════════════════════

    def _generate_frontend(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        context: dict[str, Any],
        result: GenerationResult,
    ) -> None:
        """Generate frontend code."""

        if spec.stack.frontend == "react":
            self._generate_react_app(spec, output_dir, result)

    def _generate_react_app(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate React application scaffolding."""

        # Vite config
        vite_config = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
"""
        self._write_file(output_dir, "vite.config.ts", vite_config, result)

        # index.html
        index_html = f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{spec.project.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""
        self._write_file(output_dir, "index.html", index_html, result)

        # Main entry
        main_tsx = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
"""
        self._write_file(output_dir, "src/main.tsx", main_tsx, result)

        # App component
        app_tsx = f"""import React from 'react'

function App() {{
  return (
    <div className="app">
      <h1>{spec.project.name}</h1>
      {{/* TODO: Add routing and components */}}
      {{/* GAP: Main application layout and routing */}}
    </div>
  )
}}

export default App
"""
        self._write_file(output_dir, "src/App.tsx", app_tsx, result)

        # Basic CSS
        css = """* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}
"""
        self._write_file(output_dir, "src/index.css", css, result)

    # ═══════════════════════════════════════════════════════════════════════
    # ORM GENERATION
    # ═══════════════════════════════════════════════════════════════════════

    def _generate_orm(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        context: dict[str, Any],
        result: GenerationResult,
    ) -> None:
        """Generate ORM schema and client."""

        if spec.stack.orm == "prisma":
            self._generate_prisma_schema(spec, output_dir, result)
        elif spec.stack.orm == "drizzle":
            self._generate_drizzle_schema(spec, output_dir, result)

    def _generate_prisma_schema(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate Prisma schema with proper relations, ownership, and tenancy."""

        db_provider = {
            "postgresql": "postgresql",
            "mysql": "mysql",
            "sqlite": "sqlite",
        }.get(spec.stack.database or "postgresql", "postgresql")

        # Collect enums from all entities
        enums: dict[str, list[str]] = {}
        for entity in spec.entities:
            for field in entity.fields:
                if field.type == FieldType.ENUM and field.enum_values:
                    enum_name = pascal_case(field.name)
                    enums[enum_name] = field.enum_values

        # Build relation map: target entity -> list of (source entity, fk_field, relation_name, on_delete)
        # This helps generate back-references (hasMany side)
        back_refs: dict[str, list[tuple[str, str, str, str]]] = {}
        for entity in spec.entities:
            for field in entity.fields:
                if field.type == FieldType.RELATION and field.relation:
                    rel = field.relation
                    target = rel.target
                    if target not in back_refs:
                        back_refs[target] = []
                    # Create unique relation name for multiple relations to same target
                    relation_name = f"{entity.name}{pascal_case(field.name)}"
                    on_delete = rel.on_delete.value if rel.on_delete else "cascade"
                    # Map to Prisma onDelete values
                    on_delete_prisma = {
                        "cascade": "Cascade",
                        "setNull": "SetNull",
                        "restrict": "Restrict",
                        "noAction": "NoAction",
                    }.get(on_delete, "Cascade")
                    back_refs[target].append((entity.name, field.name, relation_name, on_delete_prisma))

        # Get identity config for ownership
        identity = spec.identity
        user_entity = identity.user_entity if identity else "User"

        # Get tenancy config
        tenancy = spec.tenancy

        # Track ownership relations for back-references on User entity
        # Format: list of (entity_name, relation_type) where relation_type is "CreatedBy" or "UpdatedBy"
        ownership_back_refs: list[tuple[str, str]] = []
        for entity in spec.entities:
            if entity.ownership and pascal_case(entity.name) != pascal_case(user_entity):
                if entity.ownership.track_creator:
                    ownership_back_refs.append((entity.name, "CreatedBy"))
                if entity.ownership.track_modifier:
                    ownership_back_refs.append((entity.name, "UpdatedBy"))

        models = []
        for entity in spec.entities:
            name = pascal_case(entity.name)
            fields = ["  id String @id @default(uuid())"]

            # Track relation fields we've added (to avoid duplicates)
            relation_fields_added: set[str] = set()

            for field in entity.fields:
                if field.type == FieldType.RELATION and field.relation:
                    # Handle relation fields properly with @relation decorators
                    rel = field.relation
                    target = pascal_case(rel.target)
                    fk_name = rel.foreign_key or field.name
                    relation_name = f"{entity.name}{pascal_case(field.name)}"
                    on_delete = rel.on_delete.value if rel.on_delete else "cascade"
                    on_delete_prisma = {
                        "cascade": "Cascade",
                        "setNull": "SetNull",
                        "restrict": "Restrict",
                        "noAction": "NoAction",
                    }.get(on_delete, "Cascade")

                    # Determine if optional
                    optional = "?" if not (field.validation and field.validation.required) else ""

                    if rel.type in (RelationType.BELONGS_TO, RelationType.HAS_ONE):
                        # Add foreign key field
                        fields.append(f"  {fk_name} String{optional}")
                        # Add relation field with @relation decorator
                        # Use singular form for relation field name
                        relation_field_name = fk_name.replace("Id", "") if fk_name.endswith("Id") else f"{fk_name}Rel"
                        fields.append(
                            f"  {relation_field_name} {target}{optional} @relation(\"{relation_name}\", fields: [{fk_name}], references: [id], onDelete: {on_delete_prisma})"
                        )
                        relation_fields_added.add(fk_name)
                    continue

                # Get Prisma type for non-relation fields
                if field.type == FieldType.ENUM:
                    prisma_type = pascal_case(field.name)
                else:
                    prisma_type = field_to_prisma(field)

                attrs = []

                if field.validation:
                    if field.validation.unique:
                        attrs.append("@unique")
                    if field.validation.default is not None:
                        default = field.validation.default
                        # For enums, use without quotes
                        if field.type == FieldType.ENUM:
                            attrs.append(f"@default({default})")
                        elif isinstance(default, str):
                            attrs.append(f'@default("{default}")')
                        elif isinstance(default, bool):
                            attrs.append(f"@default({str(default).lower()})")
                        else:
                            attrs.append(f"@default({default})")

                optional = "?" if not (field.validation and field.validation.required) else ""
                attr_str = " " + " ".join(attrs) if attrs else ""
                fields.append(f"  {field.name} {prisma_type}{optional}{attr_str}")

            # Add back-references (hasMany side) from other entities pointing to this one
            if name in back_refs:
                for source_entity, fk_field, relation_name, _ in back_refs[name]:
                    source_model = pascal_case(source_entity)
                    # Pluralize for hasMany
                    back_ref_name = camel_case(source_entity) + "s"
                    fields.append(f"  {back_ref_name} {source_model}[] @relation(\"{relation_name}\")")

            # Add ownership back-references if this is the User entity
            if name == pascal_case(user_entity) and ownership_back_refs:
                for entity_name, rel_type in ownership_back_refs:
                    entity_model = pascal_case(entity_name)
                    relation_name = f"{entity_model}{rel_type}"
                    # Use descriptive names: todoListsCreated, todoListsUpdated
                    suffix = "Created" if rel_type == "CreatedBy" else "Updated"
                    back_ref_name = camel_case(entity_name) + "s" + suffix
                    fields.append(f"  {back_ref_name} {entity_model}[] @relation(\"{relation_name}\")")

            # Add ownership fields if entity has ownership config
            ownership = entity.ownership
            is_global = tenancy and name in [pascal_case(e) for e in (tenancy.global_entities or [])]
            is_user_entity = name == pascal_case(user_entity)

            if ownership and not is_user_entity:
                if ownership.track_creator and "createdById" not in relation_fields_added:
                    fields.append(f"  createdById String")
                    fields.append(f"  createdBy {pascal_case(user_entity)} @relation(\"{name}CreatedBy\", fields: [createdById], references: [id])")
                if ownership.track_modifier and "updatedById" not in relation_fields_added:
                    fields.append(f"  updatedById String?")
                    fields.append(f"  updatedBy {pascal_case(user_entity)}? @relation(\"{name}UpdatedBy\", fields: [updatedById], references: [id])")

            # Add tenancy field if enabled and entity is not global
            if tenancy and tenancy.enabled and not is_global and not is_user_entity:
                tenant_field = tenancy.tenant_field
                tenant_entity = pascal_case(tenancy.tenant_entity)
                if tenant_field not in relation_fields_added:
                    fields.append(f"  {tenant_field} String")
                    fields.append(f"  {camel_case(tenancy.tenant_entity)} {tenant_entity} @relation(fields: [{tenant_field}], references: [id])")

            if entity.timestamps:
                fields.append("  createdAt DateTime @default(now())")
                fields.append("  updatedAt DateTime @updatedAt")

            if entity.soft_delete:
                fields.append("  deletedAt DateTime?")

            models.append(f"""model {name} {{
{chr(10).join(fields)}
}}""")

        # Generate Workspace model if tenancy enabled and not already defined
        if tenancy and tenancy.enabled:
            tenant_entity = pascal_case(tenancy.tenant_entity)
            if not any(e.name == tenancy.tenant_entity for e in spec.entities):
                tenant_model = f"""model {tenant_entity} {{
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}}"""
                models.append(tenant_model)

        # Generate UserGroup models if identity config has groups
        if identity and identity.group_entity:
            group_entity = pascal_case(identity.group_entity)
            membership_entity = pascal_case(identity.membership_entity or f"{identity.group_entity}Membership")
            user_model = pascal_case(user_entity)

            if not any(e.name == identity.group_entity for e in spec.entities):
                group_fields = [
                    "  id          String   @id @default(uuid())",
                    "  name        String",
                    "  description String?",
                ]
                if identity.group_hierarchy:
                    group_fields.extend([
                        "  parentId    String?",
                        f"  parent      {group_entity}?  @relation(\"GroupHierarchy\", fields: [parentId], references: [id])",
                        f"  children    {group_entity}[] @relation(\"GroupHierarchy\")",
                    ])
                group_fields.extend([
                    f"  members     {membership_entity}[]",
                    "  createdAt   DateTime @default(now())",
                ])
                group_model = f"""model {group_entity} {{
{chr(10).join(group_fields)}
}}"""
                models.append(group_model)

            # Generate membership junction table
            membership_model = f"""model {membership_entity} {{
  id        String    @id @default(uuid())
  userId    String
  user      {user_model}      @relation(fields: [userId], references: [id], onDelete: Cascade)
  groupId   String
  group     {group_entity} @relation(fields: [groupId], references: [id], onDelete: Cascade)
  role      String    @default("member")
  createdAt DateTime  @default(now())

  @@unique([userId, groupId])
}}"""
            models.append(membership_model)

        # Generate enum definitions
        enum_defs = []
        for enum_name, values in enums.items():
            enum_values = "\n".join(f"  {v}" for v in values)
            enum_defs.append(f"enum {enum_name} {{\n{enum_values}\n}}")

        enum_section = "\n\n".join(enum_defs) + "\n\n" if enum_defs else ""

        schema = f"""// Prisma Schema
// Generated by Turbine

generator client {{
  provider = "prisma-client-js"
}}

datasource db {{
  provider = "{db_provider}"
  url      = env("DATABASE_URL")
}}

{enum_section}{chr(10).join(models)}
"""

        self._write_file(output_dir, "prisma/schema.prisma", schema, result)

        # DB client wrapper
        db_client = """import { PrismaClient } from '@prisma/client'

declare global {
  var prisma: PrismaClient | undefined
}

export const db = globalThis.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = db
}
"""
        self._write_file(output_dir, "src/db.ts", db_client, result)

    def _generate_drizzle_schema(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate Drizzle ORM schema."""

        imports = ["import { pgTable, uuid, varchar, text, boolean, timestamp, integer, jsonb } from 'drizzle-orm/pg-core'"]
        tables = []

        for entity in spec.entities:
            name = snake_case(entity.name)
            columns = ["  id: uuid('id').primaryKey().defaultRandom()"]

            for field in entity.fields:
                col_type = {
                    "string": "varchar",
                    "text": "text",
                    "email": "varchar",
                    "url": "varchar",
                    "number": "integer",
                    "integer": "integer",
                    "boolean": "boolean",
                    "date": "timestamp",
                    "datetime": "timestamp",
                    "uuid": "uuid",
                    "json": "jsonb",
                }.get(field.type.value if hasattr(field.type, 'value') else str(field.type), "varchar")

                col = f"  {camel_case(field.name)}: {col_type}('{field.name}')"

                if field.validation and field.validation.required:
                    col += ".notNull()"
                if field.validation and field.validation.default is not None:
                    default = field.validation.default
                    if isinstance(default, str):
                        col += f".default('{default}')"
                    else:
                        col += f".default({default})"

                columns.append(col)

            if entity.timestamps:
                columns.append("  createdAt: timestamp('created_at').defaultNow().notNull()")
                columns.append("  updatedAt: timestamp('updated_at').defaultNow().notNull()")

            tables.append(f"""export const {camel_case(entity.plural or plural(entity.name))} = pgTable('{name}', {{
{chr(10).join(columns)},
}})""")

        schema = f"""{chr(10).join(imports)}

{chr(10).join(tables)}
"""
        self._write_file(output_dir, "src/db/schema.ts", schema, result)

    # ═══════════════════════════════════════════════════════════════════════
    # CI/CD GENERATION
    # ═══════════════════════════════════════════════════════════════════════

    def _generate_cicd(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        context: dict[str, Any],
        result: GenerationResult,
    ) -> None:
        """Generate CI/CD configuration."""

        if not spec.cicd:
            return

        if spec.cicd.provider == "github":
            self._generate_github_actions(spec, output_dir, result)

    def _generate_github_actions(
        self,
        spec: TurbineSpec,
        output_dir: Path,
        result: GenerationResult,
    ) -> None:
        """Generate GitHub Actions workflow."""

        cicd = spec.cicd
        if not cicd:
            return

        steps = [
            {"uses": "actions/checkout@v4"},
            {"name": "Setup Node.js", "uses": "actions/setup-node@v4", "with": {"node-version": "20", "cache": "npm"}},
            {"name": "Install dependencies", "run": "npm ci"},
        ]

        if cicd.stages.typecheck:
            steps.append({"name": "Type check", "run": "npm run build"})

        if cicd.stages.test:
            steps.append({"name": "Test", "run": "npm test"})

        if cicd.stages.build:
            steps.append({"name": "Build", "run": "npm run build"})

        workflow = {
            "name": "CI",
            "on": {
                "push": {"branches": [cicd.branches.main]},
                "pull_request": {"branches": [cicd.branches.main]},
            },
            "jobs": {
                "build": {
                    "runs-on": "ubuntu-latest",
                    "steps": steps,
                }
            },
        }

        content = yaml.dump(workflow, default_flow_style=False, sort_keys=False)
        self._write_file(output_dir, ".github/workflows/ci.yml", content, result)


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════


def generate_project(
    spec: TurbineSpec | str | Path,
    output_dir: str | Path,
    templates_dir: Path | None = None,
) -> GenerationResult:
    """
    Generate a TypeScript project from a Turbine spec.

    Args:
        spec: TurbineSpec object, YAML string, or path to YAML file
        output_dir: Directory to write generated files
        templates_dir: Optional custom templates directory

    Returns:
        GenerationResult with generated files and gaps
    """
    # Parse spec if needed
    if isinstance(spec, (str, Path)):
        path = Path(spec)
        if path.exists():
            spec = TurbineSpec.from_file(path)
        else:
            spec = TurbineSpec.from_yaml(str(spec))

    # Generate
    generator = ProjectGenerator(templates_dir)
    return generator.generate(spec, Path(output_dir))
