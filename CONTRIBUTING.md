# Contributing

## Prerequisites

- [Node.js](https://nodejs.org) (v20+)
- [Bun](https://bun.sh) (package manager)
- [Just](https://github.com/casey/just) (command runner)
- [Ni](https://github.com/antfu-collective/ni) (package manager resolver)

## Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/PaulRBerg/prb-effect.git
cd prb-effect
bun install
```

## Available Commands

```bash
# Code quality
just full-check               # Run all checks (prettier, biome, types)
just full-write               # Auto-fix formatting and linting issues
just biome-check              # Lint with Biome

# Testing
just tu                       # Run unit tests
just tuui                     # Run tests in interactive UI mode

# Package-specific
just effect-next::build       # Build effect-next
just effect-next::test        # Test effect-next
just effect-web3::build       # Build effect-web3
just effect-web3::test        # Test effect-web3

# Utilities
just --list                   # Show all available commands
just clean                    # Clean build artifacts
```

## Development Workflow

1. **Fork the repository** and create a feature branch from `main`
2. **Make your changes** following the guidelines in [CLAUDE.md](CLAUDE.md)
3. **Run quality checks** with `just full-check` before committing
4. **Write tests** for new features or bug fixes
5. **Submit a pull request** with a clear description of your changes

## Quality Gates

Before submitting a pull request, ensure:

- ✅ Code is properly linted and formatted (`just full-check`)
- ✅ Unit tests pass (`just tu`)
