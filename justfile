# See https://github.com/sablier-labs/devkit/blob/main/just/base.just
import "./node_modules/@sablier/devkit/just/base.just"

# Package modules
mod evm "evm"
mod next "next"
mod solana "solana"
mod xstate "xstate"

# ---------------------------------------------------------------------------- #
#                                    RECIPES                                   #
# ---------------------------------------------------------------------------- #

# Default: show all recipes
default:
    just --list

# Clean build artifacts
clean:
    nlx del-cli "**/dist" "**/*.tsbuildinfo" "**/*.tgz"

# Build all packages (.tgz)
[group("dev")]
@build-tgz:
    echo '{{ CYAN }}→ Building @prb/effect-next...{{ NORMAL }}'
    cd next && npm pack --silent
    echo ""

    echo '{{ CYAN }}→ Building @prb/effect-evm...{{ NORMAL }}'
    cd evm && npm pack --silent
    echo ""

    echo '{{ CYAN }}→ Building @prb/effect-xstate...{{ NORMAL }}'
    cd xstate && npm pack --silent
    echo ""

    echo '{{ GREEN }}✓ All packages built{{ NORMAL }}'
alias bt := build-tgz

# ---------------------------------------------------------------------------- #
#                                     TESTS                                    #
# ---------------------------------------------------------------------------- #

# Run unit tests for all packages
[group("tests")]
@test-unit +args="":
    na vitest {{ args }}
alias tu := test-unit

# Run integration tests for all packages
[group("tests")]
@test-integration +args="":
    na vitest run '.integration.' {{ args }}
alias ti := test-integration

# ---------------------------------------------------------------------------- #
#                                    TYPE CHECK                                #
# ---------------------------------------------------------------------------- #

# Run TypeScript check for all packages
@type-check:
    echo "🔍 Type checking effect-evm..."
    cd evm && na tsgo --noEmit

    echo "🔍 Type checking effect-next..."
    cd next && na tsgo --noEmit

    echo "🔍 Type checking effect-solana..."
    cd solana && na tsgo --noEmit

    echo "🔍 Type checking effect-xstate..."
    cd xstate && na tsgo --noEmit

    echo "✅ All type check passed"
