"""
Turbine CLI - Command-line interface for project generation

Usage:
    turbine generate <spec_file> -o <output_dir>
    turbine validate <spec_file>
    turbine init <project_name>
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich import print as rprint
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.tree import Tree

from turbine.generator import generate_project
from turbine.spec import TurbineSpec

app = typer.Typer(
    name="turbine",
    help="Generate TypeScript fullstack projects from YAML specs",
    add_completion=False,
)
console = Console()


@app.command()
def generate(
    spec_file: Path = typer.Argument(
        ...,
        help="Path to turbine.yaml spec file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
    output: Path = typer.Option(
        None,
        "--output", "-o",
        help="Output directory (defaults to spec file directory)",
        resolve_path=True,
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Show what would be generated without writing files",
    ),
) -> None:
    """Generate a TypeScript project from a turbine.yaml spec file."""
    try:
        spec = TurbineSpec.from_file(spec_file)
        rprint(f"[green]✓[/green] Loaded: [bold]{spec.project.name}[/bold]")

        if output is None:
            output = spec_file.parent / "generated"

        if dry_run:
            rprint(f"\n[yellow]Dry run - would generate to: {output}[/yellow]\n")
            _show_preview(spec)
            return

        result = generate_project(spec, output)

        if result.success:
            rprint(f"[green]✓[/green] Generated {len(result.files)} files to {output}")
            _show_next_steps(output)
        else:
            for error in result.errors:
                rprint(f"[red]✗[/red] {error}")
            raise typer.Exit(1)

    except Exception as e:
        rprint(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command()
def validate(
    spec_file: Path = typer.Argument(
        ...,
        help="Path to turbine.yaml spec file",
        exists=True,
        dir_okay=False,
        resolve_path=True,
    ),
) -> None:
    """Validate a turbine.yaml spec file."""
    try:
        spec = TurbineSpec.from_file(spec_file)
        rprint(f"[green]✓[/green] Valid: [bold]{spec.project.name}[/bold]")

        table = Table()
        table.add_column("Property", style="cyan")
        table.add_column("Value")

        table.add_row("Version", spec.project.version)
        table.add_row("Backend", spec.stack.backend or "-")
        table.add_row("Frontend", spec.stack.frontend or "-")
        table.add_row("ORM", spec.stack.orm or "-")
        table.add_row("Database", spec.stack.database or "-")
        table.add_row("Entities", str(len(spec.entities)))

        rprint(table)

    except Exception as e:
        rprint(f"[red]✗[/red] {e}")
        raise typer.Exit(1)


@app.command()
def init(
    project_name: str = typer.Argument(..., help="Project name"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", resolve_path=True),
    backend: str = typer.Option("fastify", "--backend", "-b"),
    frontend: Optional[str] = typer.Option(None, "--frontend", "-f"),
    database: str = typer.Option("postgresql", "--database", "-d"),
) -> None:
    """Create a new turbine.yaml spec file."""
    import yaml

    if output_dir is None:
        output_dir = Path.cwd()

    output_file = output_dir / "turbine.yaml"

    if output_file.exists():
        if not typer.confirm(f"{output_file} exists. Overwrite?"):
            raise typer.Exit(0)

    spec_dict = {
        "specVersion": "1.0",
        "project": {
            "name": project_name,
            "description": f"A {backend} project",
            "version": "0.1.0",
        },
        "stack": {
            "backend": backend,
            "orm": "prisma",
            "database": database,
            "auth": "jwt",
            "testing": ["vitest"],
            "containerization": True,
        },
        "features": {
            "openapi": True,
            "cors": True,
            "pagination": True,
            "logging": True,
            "healthCheck": True,
        },
        "entities": [
            {
                "name": "Item",
                "fields": [
                    {"name": "name", "type": "string", "validation": {"required": True}},
                    {"name": "description", "type": "text"},
                ],
                "operations": ["create", "read", "update", "delete", "list"],
                "timestamps": True,
            }
        ],
        "env": {
            "DATABASE_URL": {"description": "Database URL", "required": True, "secret": True},
            "JWT_SECRET": {"description": "JWT secret", "required": True, "secret": True},
            "PORT": {"description": "Server port", "default": "3000"},
        },
    }

    if frontend:
        spec_dict["stack"]["frontend"] = frontend

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w") as f:
        yaml.dump(spec_dict, f, default_flow_style=False, sort_keys=False)

    rprint(f"[green]✓[/green] Created {output_file}")
    rprint(f"\nNext: [cyan]turbine generate {output_file}[/cyan]")


@app.command()
def version() -> None:
    """Show version."""
    from turbine import __version__
    rprint(f"turbine {__version__}")


def _show_preview(spec: TurbineSpec) -> None:
    """Show what would be generated."""
    tree = Tree(f"[bold]{spec.project.name}[/bold]")

    stack = tree.add("[blue]Stack[/blue]")
    if spec.stack.backend:
        stack.add(f"Backend: {spec.stack.backend}")
    if spec.stack.frontend:
        stack.add(f"Frontend: {spec.stack.frontend}")
    if spec.stack.orm:
        stack.add(f"ORM: {spec.stack.orm}")

    entities = tree.add("[blue]Entities[/blue]")
    for entity in spec.entities:
        e = entities.add(f"[cyan]{entity.name}[/cyan]")
        for field in entity.fields:
            ftype = field.type.value if hasattr(field.type, 'value') else str(field.type)
            e.add(f"{field.name}: {ftype}")

    rprint(tree)


def _show_next_steps(output_dir: Path) -> None:
    """Show next steps."""
    steps = f"""
[bold]Next:[/bold]
  cd {output_dir}
  npm install
  cp .env.example .env
  npm run db:push
  npm run dev
"""
    rprint(Panel(steps, title="Done"))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
