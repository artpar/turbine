"""
Turbine - Autonomous Software Generation Engine

Scaffolding-first TypeScript fullstack project generator.
80% deterministic generation, 20% LLM for business logic.
"""

__version__ = "0.1.0"

from turbine.spec import TurbineSpec, Entity, EntityField, Stack, Features
from turbine.generator import generate_project, ProjectGenerator

__all__ = [
    "TurbineSpec",
    "Entity",
    "EntityField",
    "Stack",
    "Features",
    "generate_project",
    "ProjectGenerator",
]
