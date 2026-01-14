# Shared recipes for library packages
# Imported by each package's justfile
import "./node_modules/@sablier/devkit/just/base.just"

# ---------------------------------------------------------------------------- #
#                                    RECIPES                                   #
# ---------------------------------------------------------------------------- #

# Default: list available recipes
default:
    @just --list

# ---------------------------------------------------------------------------- #
#                                  BUILD & DEV                                 #
# ---------------------------------------------------------------------------- #

# Build the package (clean, compile, pack)
[group("dev")]
@build:
    just clean
    just tsc-build
alias b := build

# Clean build artifacts
@clean:
    nlx del-cli dist *.tgz
    echo "🗑️  Cleaned build files"

# Build with TypeScript CLI
@tsc-build:
    echo "🔨 Building the package..."
    bun tsc -p tsconfig.build.json
    bun tsc-alias -p tsconfig.build.json
    npm pack --silent
    echo "✅ Package built successfully"

# ---------------------------------------------------------------------------- #
#                                     TESTS                                    #
# ---------------------------------------------------------------------------- #

# Run all tests
[group("tests")]
@test *args:
    bun vitest run {{ args }}
alias t := test

# Run tests with UI
[group("tests")]
@test-ui *args:
    bun vitest --ui {{ args }}
alias tui := test-ui

# Run unit tests (excludes integration tests)
[group("tests")]
@test-unit *args:
    bun vitest run --exclude '**/*.integration.test.ts' {{ args }}
alias tu := test-unit

# Run integration tests only
[group("tests")]
@test-integration *args:
    bun vitest run '.integration.' {{ args }}
alias ti := test-integration
