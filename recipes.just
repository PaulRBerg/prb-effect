# Shared recipes for library packages
# Imported by each package's justfile
import "./node_modules/@sablier/devkit/just/base.just"

# ---------------------------------------------------------------------------- #
#                                    RECIPES                                   #
# ---------------------------------------------------------------------------- #

# Default: list available recipes
default:
    @just --list

# Clean build artifacts
@clean:
    echo "🧹 Deleting files..."
    nlx del-cli \
        dist \
        *.tgz

# ---------------------------------------------------------------------------- #
#                                     BUILD                                    #
# ---------------------------------------------------------------------------- #

# Build the package (clean, compile, pack)
[group("build")]
@build:
    just --quiet clean
    just tsc-build
alias b := build

# Build with TypeScript CLI
[group("build")]
@tsc-build:
    echo "🔨 Building the {{ PACKAGE_NAME }} package..."
    na tsc -p tsconfig.build.json
    echo "✅ Package built successfully"

# ---------------------------------------------------------------------------- #
#                                     TESTS                                    #
# ---------------------------------------------------------------------------- #

# Run all tests
[group("tests")]
@test *args:
    na vitest run {{ args }}
alias t := test

# Run tests with UI
[group("tests")]
@test-ui *args:
    na vitest --ui {{ args }}
alias tui := test-ui

# Run unit tests (excludes integration tests)
[group("tests")]
@test-unit *args:
    na vitest run --exclude '**/*.integration.test.ts' {{ args }}
alias tu := test-unit

# Run integration tests only
[group("tests")]
@test-integration *args:
    na vitest run '.integration.' {{ args }}
alias ti := test-integration
