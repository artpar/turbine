"""
Turbine Spec Models - Pydantic models for turbine.yaml

Defines the complete schema for project specifications.
Pydantic handles validation, defaults, and serialization.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# ═══════════════════════════════════════════════════════════════════════════
# ENUMS
# ═══════════════════════════════════════════════════════════════════════════


class FieldType(str, Enum):
    STRING = "string"
    TEXT = "text"
    NUMBER = "number"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    UUID = "uuid"
    EMAIL = "email"
    URL = "url"
    JSON = "json"
    ENUM = "enum"
    RELATION = "relation"


class RelationType(str, Enum):
    HAS_ONE = "hasOne"
    HAS_MANY = "hasMany"
    BELONGS_TO = "belongsTo"
    MANY_TO_MANY = "manyToMany"


class OnDeleteAction(str, Enum):
    CASCADE = "cascade"
    SET_NULL = "setNull"
    RESTRICT = "restrict"
    NO_ACTION = "noAction"


class BackendFramework(str, Enum):
    FASTIFY = "fastify"
    EXPRESS = "express"
    HONO = "hono"
    ELYSIA = "elysia"


class FrontendFramework(str, Enum):
    REACT = "react"
    VUE = "vue"
    SVELTE = "svelte"
    SOLID = "solid"
    NEXTJS = "nextjs"
    NUXT = "nuxt"
    NONE = "none"


class ORM(str, Enum):
    PRISMA = "prisma"
    DRIZZLE = "drizzle"
    TYPEORM = "typeorm"
    KYSELY = "kysely"


class Database(str, Enum):
    POSTGRESQL = "postgresql"
    MYSQL = "mysql"
    SQLITE = "sqlite"
    MONGODB = "mongodb"


class AuthStrategy(str, Enum):
    JWT = "jwt"
    SESSION = "session"
    OAUTH = "oauth"
    PASSKEY = "passkey"
    NONE = "none"


class TestingFramework(str, Enum):
    VITEST = "vitest"
    JEST = "jest"
    PLAYWRIGHT = "playwright"
    CYPRESS = "cypress"


class CICDProvider(str, Enum):
    GITHUB = "github"
    GITLAB = "gitlab"
    NONE = "none"


class EntityOperation(str, Enum):
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    LIST = "list"
    SEARCH = "search"


class HTTPMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"


class FieldVisibility(str, Enum):
    """Field visibility levels for projections"""
    PUBLIC = "public"      # Everyone can see
    PRIVATE = "private"    # Only owner/admin can see
    INTERNAL = "internal"  # Never returned in API responses


class PermissionModel(str, Enum):
    """Permission/access control model"""
    OWNER = "owner"    # Ownership-first (default)
    RBAC = "rbac"      # Role-based access control
    ABAC = "abac"      # Attribute-based access control
    PUBLIC = "public"  # No restrictions


class TenancyModel(str, Enum):
    """Multi-tenancy model"""
    WORKSPACE = "workspace"
    ORGANIZATION = "organization"
    ACCOUNT = "account"


class PaginationStyle(str, Enum):
    """Pagination style"""
    OFFSET = "offset"
    CURSOR = "cursor"


# ═══════════════════════════════════════════════════════════════════════════
# FIELD MODELS
# ═══════════════════════════════════════════════════════════════════════════


class ValidationRule(BaseModel):
    """Field validation rules"""

    min: float | None = None
    max: float | None = None
    min_length: int | None = Field(None, alias="minLength")
    max_length: int | None = Field(None, alias="maxLength")
    pattern: str | None = None
    required: bool = False
    unique: bool = False
    default: Any | None = None

    model_config = {"populate_by_name": True}


class RelationConfig(BaseModel):
    """Relation field configuration"""

    type: RelationType
    target: str
    foreign_key: str | None = Field(None, alias="foreignKey")
    through: str | None = None  # For manyToMany
    on_delete: OnDeleteAction | None = Field(None, alias="onDelete")

    model_config = {"populate_by_name": True}


class EntityField(BaseModel):
    """Entity field definition"""

    name: str
    type: FieldType
    validation: ValidationRule | None = None
    enum_values: list[str] | None = Field(None, alias="enumValues")
    relation: RelationConfig | None = None
    description: str | None = None
    searchable: bool = False
    sortable: bool = False
    filterable: bool = False
    visibility: FieldVisibility = FieldVisibility.PUBLIC

    model_config = {"populate_by_name": True}

    @field_validator("enum_values")
    @classmethod
    def validate_enum_values(cls, v: list[str] | None, info) -> list[str] | None:
        """Ensure enum_values is set when type is enum"""
        # Note: Can't access other fields in field_validator easily in Pydantic v2
        return v


# ═══════════════════════════════════════════════════════════════════════════
# ENTITY HOOKS
# ═══════════════════════════════════════════════════════════════════════════


class EntityHooks(BaseModel):
    """Lifecycle hooks for entity"""

    before_create: str | None = Field(None, alias="beforeCreate")
    after_create: str | None = Field(None, alias="afterCreate")
    before_update: str | None = Field(None, alias="beforeUpdate")
    after_update: str | None = Field(None, alias="afterUpdate")
    before_delete: str | None = Field(None, alias="beforeDelete")
    after_delete: str | None = Field(None, alias="afterDelete")

    model_config = {"populate_by_name": True}


# ═══════════════════════════════════════════════════════════════════════════
# ORTHOGONAL CONCERNS: IDENTITY, TENANCY, OWNERSHIP, PERMISSIONS, QUERYING
# ═══════════════════════════════════════════════════════════════════════════


class IdentityFields(BaseModel):
    """Standard field mappings for user entity"""
    identifier: str = "email"         # Login field
    credential: str = "passwordHash"  # Password field
    display_name: str = Field("name", alias="displayName")  # For UI
    role: str = "role"                # Inline role field
    active: str = "isActive"          # For soft-disable

    model_config = {"populate_by_name": True}


class IdentityConfig(BaseModel):
    """Identity/authentication configuration"""
    user_entity: str = Field("User", alias="userEntity")
    group_entity: str | None = Field(None, alias="groupEntity")
    membership_entity: str | None = Field(None, alias="membershipEntity")
    group_hierarchy: bool = Field(False, alias="groupHierarchy")
    group_permissions: bool = Field(False, alias="groupPermissions")
    fields: IdentityFields = IdentityFields()

    model_config = {"populate_by_name": True}


class TenancyConfig(BaseModel):
    """Multi-tenancy configuration"""
    enabled: bool = False
    model: TenancyModel = TenancyModel.WORKSPACE
    tenant_entity: str = Field("Workspace", alias="tenantEntity")
    tenant_field: str = Field("workspaceId", alias="tenantField")
    user_tenant_relation: Literal["one", "many"] = Field("many", alias="userTenantRelation")
    auto_filter: bool = Field(True, alias="autoFilter")
    scoped_entities: list[str] = Field(["*"], alias="scopedEntities")
    global_entities: list[str] = Field(["User"], alias="globalEntities")

    model_config = {"populate_by_name": True}


class EntityOwnership(BaseModel):
    """Ownership tracking for an entity"""
    track_creator: bool = Field(True, alias="trackCreator")
    track_modifier: bool = Field(True, alias="trackModifier")
    transferable: bool = False
    transfer_field: str | None = Field(None, alias="transferField")
    auto_filter: bool = Field(True, alias="autoFilter")
    auto_filter_field: str = Field("createdById", alias="autoFilterField")

    model_config = {"populate_by_name": True}


class PermissionRule(BaseModel):
    """Single permission rule"""
    role: str | None = None
    actions: list[EntityOperation] = []
    resources: list[str] = ["*"]
    conditions: dict[str, Any] | None = None


class RoleDefinition(BaseModel):
    """Role definition for RBAC"""
    description: str = ""
    inherits: list[str] = []


class PermissionsConfig(BaseModel):
    """Global permissions configuration"""
    model: PermissionModel = PermissionModel.OWNER
    default_access: Literal["allow", "deny"] = Field("deny", alias="defaultAccess")
    roles: dict[str, RoleDefinition] = {}
    rules: list[PermissionRule] = []

    model_config = {"populate_by_name": True}


class EntityPermissions(BaseModel):
    """Entity-level permission configuration"""
    ownership: EntityOwnership | None = None
    rules: list[PermissionRule] = []


class Projection(BaseModel):
    """Named field projection"""
    include: list[str] = ["*"]
    exclude: list[str] = []


class QueryingConfig(BaseModel):
    """Entity querying configuration"""
    default_limit: int = Field(20, alias="defaultLimit")
    max_limit: int = Field(100, alias="maxLimit")
    pagination_style: PaginationStyle = Field(PaginationStyle.OFFSET, alias="paginationStyle")
    default_sort_field: str = Field("createdAt", alias="defaultSortField")
    default_sort_direction: Literal["asc", "desc"] = Field("desc", alias="defaultSortDirection")
    max_sort_fields: int = Field(3, alias="maxSortFields")

    model_config = {"populate_by_name": True}


# ═══════════════════════════════════════════════════════════════════════════
# ENTITY
# ═══════════════════════════════════════════════════════════════════════════


class Entity(BaseModel):
    """Domain entity definition"""

    name: str
    plural: str | None = None
    table_name: str | None = Field(None, alias="tableName")
    description: str | None = None
    fields: list[EntityField]
    operations: list[EntityOperation] = [
        EntityOperation.CREATE,
        EntityOperation.READ,
        EntityOperation.UPDATE,
        EntityOperation.DELETE,
        EntityOperation.LIST,
    ]
    timestamps: bool = True
    soft_delete: bool = Field(False, alias="softDelete")
    audit: bool = False
    hooks: EntityHooks | None = None

    # Orthogonal concerns
    ownership: EntityOwnership | None = None
    permissions: EntityPermissions | None = None
    projections: dict[str, Projection] = {}
    querying: QueryingConfig | None = None

    model_config = {"populate_by_name": True}

    def model_post_init(self, __context: Any) -> None:
        """Derive plural and table_name if not provided"""
        if self.plural is None:
            self.plural = self._pluralize(self.name)
        if self.table_name is None:
            self.table_name = self._to_snake_case(self.plural)

    @staticmethod
    def _pluralize(name: str) -> str:
        """Simple pluralization"""
        if name.endswith("y"):
            return name[:-1] + "ies"
        if name.endswith(("s", "x", "ch", "sh")):
            return name + "es"
        return name + "s"

    @staticmethod
    def _to_snake_case(name: str) -> str:
        """Convert to snake_case"""
        import re

        return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()

    def get_all_fields(self) -> list[EntityField]:
        """Get all fields including auto-generated ones (id, timestamps, etc.)"""
        fields = list(self.fields)

        # Add id if not present
        if not any(f.name == "id" for f in fields):
            fields.insert(
                0,
                EntityField(
                    name="id",
                    type=FieldType.UUID,
                    validation=ValidationRule(required=True, unique=True),
                ),
            )

        # Add timestamps
        if self.timestamps:
            if not any(f.name == "createdAt" for f in fields):
                fields.append(EntityField(name="createdAt", type=FieldType.DATETIME))
            if not any(f.name == "updatedAt" for f in fields):
                fields.append(EntityField(name="updatedAt", type=FieldType.DATETIME))

        # Add soft delete
        if self.soft_delete:
            if not any(f.name == "deletedAt" for f in fields):
                fields.append(EntityField(name="deletedAt", type=FieldType.DATETIME))

        return fields


# ═══════════════════════════════════════════════════════════════════════════
# STACK CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════


class Stack(BaseModel):
    """Technology stack configuration"""

    backend: BackendFramework = BackendFramework.FASTIFY
    frontend: FrontendFramework = FrontendFramework.REACT
    orm: ORM = ORM.PRISMA
    database: Database = Database.POSTGRESQL
    auth: AuthStrategy = AuthStrategy.JWT
    testing: list[TestingFramework] = [TestingFramework.VITEST]
    containerization: bool = True
    cicd: CICDProvider = CICDProvider.GITHUB


# ═══════════════════════════════════════════════════════════════════════════
# FEATURES
# ═══════════════════════════════════════════════════════════════════════════


class Features(BaseModel):
    """Feature flags"""

    # API Features
    openapi: bool = True
    graphql: bool = False
    websockets: bool = False
    rate_limit: bool = Field(True, alias="rateLimit")
    cors: bool = True

    # Data Features
    pagination: bool = True
    filtering: bool = True
    sorting: bool = True
    search: bool = True

    # Observability
    logging: bool = True
    metrics: bool = True
    tracing: bool = True
    health_check: bool = Field(True, alias="healthCheck")

    # Documentation
    readme: bool = True
    api_docs: bool = Field(True, alias="apiDocs")
    wiki: bool = False
    changelog: bool = True

    # UI Features
    dark_mode: bool = Field(True, alias="darkMode")
    i18n: bool = False
    pwa: bool = False
    storybook: bool = False

    model_config = {"populate_by_name": True}


# ═══════════════════════════════════════════════════════════════════════════
# CI/CD
# ═══════════════════════════════════════════════════════════════════════════


class CICDBranches(BaseModel):
    """CI/CD branch configuration"""

    main: str = "main"
    develop: str | None = None
    release: str | None = None


class CICDStages(BaseModel):
    """CI/CD pipeline stages"""

    lint: bool = True
    typecheck: bool = True
    test: bool = True
    build: bool = True
    e2e: bool = False
    deploy: bool = False


class Deployment(BaseModel):
    """Deployment configuration"""

    name: str
    environment: Literal["staging", "production"]
    provider: Literal["vercel", "railway", "fly", "aws", "gcp", "docker"]
    branch: str
    auto_merge: bool = Field(False, alias="autoMerge")

    model_config = {"populate_by_name": True}


class CICD(BaseModel):
    """CI/CD configuration"""

    provider: CICDProvider = CICDProvider.GITHUB
    branches: CICDBranches = CICDBranches()
    stages: CICDStages = CICDStages()
    deployments: list[Deployment] = []


# ═══════════════════════════════════════════════════════════════════════════
# PROJECT METADATA
# ═══════════════════════════════════════════════════════════════════════════


class ProjectMeta(BaseModel):
    """Project metadata"""

    name: str
    version: str = "0.1.0"
    description: str
    author: str | None = None
    license: str = "MIT"
    repository: str | None = None
    keywords: list[str] = []


# ═══════════════════════════════════════════════════════════════════════════
# CUSTOM ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════


class CustomEndpoint(BaseModel):
    """Custom API endpoint beyond CRUD"""

    method: HTTPMethod
    path: str
    description: str
    handler: str | None = None
    auth: bool = True
    rate_limit: int | None = Field(None, alias="rateLimit")

    model_config = {"populate_by_name": True}


# ═══════════════════════════════════════════════════════════════════════════
# ENVIRONMENT VARIABLE
# ═══════════════════════════════════════════════════════════════════════════


class EnvVar(BaseModel):
    """Environment variable definition"""

    description: str
    default: str | None = None
    required: bool = True
    secret: bool = False


# ═══════════════════════════════════════════════════════════════════════════
# COMPLETE SPEC
# ═══════════════════════════════════════════════════════════════════════════


class TurbineSpec(BaseModel):
    """Complete Turbine specification"""

    spec_version: str = Field("1.0", alias="specVersion")
    project: ProjectMeta
    stack: Stack = Stack()
    features: Features = Features()
    cicd: CICD = CICD()
    entities: list[Entity]
    custom_endpoints: list[CustomEndpoint] = Field([], alias="customEndpoints")
    seeds: dict[str, list[dict[str, Any]]] | None = None
    env: dict[str, EnvVar] = {}

    # Orthogonal concerns (global configuration)
    identity: IdentityConfig | None = None
    tenancy: TenancyConfig | None = None
    permissions: PermissionsConfig | None = None

    model_config = {"populate_by_name": True}

    @classmethod
    def from_yaml(cls, yaml_content: str) -> "TurbineSpec":
        """Parse YAML content into TurbineSpec"""
        import yaml

        data = yaml.safe_load(yaml_content)
        return cls.model_validate(data)

    @classmethod
    def from_file(cls, path: str) -> "TurbineSpec":
        """Load spec from YAML file"""
        from pathlib import Path

        content = Path(path).read_text()
        return cls.from_yaml(content)

    def to_yaml(self) -> str:
        """Export spec to YAML"""
        import yaml

        return yaml.dump(
            self.model_dump(by_alias=True, exclude_none=True),
            default_flow_style=False,
            sort_keys=False,
        )

    def get_entity(self, name: str) -> Entity | None:
        """Get entity by name"""
        return next((e for e in self.entities if e.name == name), None)

    def get_dependency_order(self) -> list[str]:
        """Get entities in dependency order (topological sort)"""
        graph: dict[str, set[str]] = {e.name: set() for e in self.entities}

        # Build dependency graph from relations
        for entity in self.entities:
            for field in entity.fields:
                if field.type == FieldType.RELATION and field.relation:
                    if field.relation.type == RelationType.BELONGS_TO:
                        graph[entity.name].add(field.relation.target)

        # Topological sort
        sorted_names: list[str] = []
        visited: set[str] = set()
        visiting: set[str] = set()

        def visit(name: str) -> None:
            if name in visited:
                return
            if name in visiting:
                raise ValueError(f"Circular dependency involving {name}")

            visiting.add(name)
            for dep in graph.get(name, set()):
                visit(dep)
            visiting.remove(name)
            visited.add(name)
            sorted_names.append(name)

        for entity in self.entities:
            visit(entity.name)

        return sorted_names


# ═══════════════════════════════════════════════════════════════════════════
# TYPE CONVERSIONS
# ═══════════════════════════════════════════════════════════════════════════


def field_to_typescript(field: EntityField) -> str:
    """Convert field type to TypeScript type"""
    type_map = {
        FieldType.STRING: "string",
        FieldType.TEXT: "string",
        FieldType.EMAIL: "string",
        FieldType.URL: "string",
        FieldType.NUMBER: "number",
        FieldType.INTEGER: "number",
        FieldType.BOOLEAN: "boolean",
        FieldType.DATE: "Date",
        FieldType.DATETIME: "Date",
        FieldType.UUID: "string",
        FieldType.JSON: "unknown",
    }

    if field.type == FieldType.ENUM:
        return " | ".join(f"'{v}'" for v in (field.enum_values or []))
    if field.type == FieldType.RELATION:
        return field.relation.target if field.relation else "unknown"

    return type_map.get(field.type, "unknown")


def field_to_zod(field: EntityField) -> str:
    """Convert field to Zod schema string"""
    base_map = {
        FieldType.STRING: "z.string()",
        FieldType.TEXT: "z.string()",
        FieldType.EMAIL: "z.string().email()",
        FieldType.URL: "z.string().url()",
        FieldType.NUMBER: "z.number()",
        FieldType.INTEGER: "z.number().int()",
        FieldType.BOOLEAN: "z.boolean()",
        FieldType.DATE: "z.coerce.date()",
        FieldType.DATETIME: "z.coerce.date()",
        FieldType.UUID: "z.string().uuid()",
        FieldType.JSON: "z.record(z.any()).or(z.array(z.any())).or(z.null()).optional()",
    }

    if field.type == FieldType.ENUM:
        values = ", ".join(f"'{v}'" for v in (field.enum_values or []))
        schema = f"z.enum([{values}])"
    elif field.type == FieldType.RELATION:
        schema = "z.string().uuid()"
    else:
        schema = base_map.get(field.type, "z.unknown()")

    # Add validation modifiers
    if field.validation:
        v = field.validation
        if v.min is not None:
            schema += f".min({v.min})"
        if v.max is not None:
            schema += f".max({v.max})"
        if v.min_length is not None:
            schema += f".min({v.min_length})"
        if v.max_length is not None:
            schema += f".max({v.max_length})"
        if v.pattern:
            schema += f".regex(/{v.pattern}/)"
        if v.default is not None:
            if isinstance(v.default, str):
                default_val = f"'{v.default}'"
            elif isinstance(v.default, bool):
                default_val = "true" if v.default else "false"
            else:
                default_val = str(v.default)
            schema += f".default({default_val})"
        if not v.required:
            schema += ".optional()"

    return schema


def field_to_prisma(field: EntityField) -> str:
    """Convert field to Prisma type"""
    type_map = {
        FieldType.STRING: "String",
        FieldType.TEXT: "String",
        FieldType.EMAIL: "String",
        FieldType.URL: "String",
        FieldType.NUMBER: "Float",
        FieldType.INTEGER: "Int",
        FieldType.BOOLEAN: "Boolean",
        FieldType.DATE: "DateTime",
        FieldType.DATETIME: "DateTime",
        FieldType.UUID: "String",
        FieldType.JSON: "Json",
    }

    if field.type == FieldType.ENUM:
        return f"{field.name}Type"
    if field.type == FieldType.RELATION:
        return "String"  # Foreign key

    return type_map.get(field.type, "String")
