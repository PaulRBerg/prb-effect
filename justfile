# See https://github.com/sablier-labs/devkit/blob/main/just/base.just
import "./node_modules/@sablier/devkit/just/base.just"

# Package modules
mod evm "evm"
mod evm_safe "evm-safe"
mod next "next"
mod solana "solana"
mod xstate "xstate"

# ---------------------------------------------------------------------------- #
#                                    RECIPES                                   #
# ---------------------------------------------------------------------------- #

# Default: show all recipes
default:
    just --list

# Build all packages (.tgz)
@build:
    cd evm && just build
    echo ""

    cd evm-safe && just build
    echo ""

    cd next && just build
    echo ""

    cd solana && just build
    echo ""

    cd xstate && just build
    echo ""

    echo '{{ GREEN }}✓ All packages built{{ NORMAL }}'
alias b := build

# Bump beta version using jq (e.g., just bump-beta evm)
@bump-beta app:
    cd {{ app }} && jq '.version |= (split("-beta.") | .[0] + "-beta." + ((.[1] | tonumber) + 1 | tostring))' package.json > tmp.json && mv tmp.json package.json
    jq -r .version {{ app }}/package.json
alias bb := bump-beta

# Clean build artifacts
@clean:
    echo "🧹 Deleting files..."
    nlx del-cli --verbose \
        "**/dist" \
        "**/*.tsbuildinfo" \
        "**/*.tgz"

# ---------------------------------------------------------------------------- #
#                                     TESTS                                    #
# ---------------------------------------------------------------------------- #

# Run unit tests for all packages
[group("tests")]
@test-unit +args="":
    na vitest {{ args }}
alias t := test-unit
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
[group("checks")]
@type-check:
    echo "🔍 Type checking effect-evm..."
    cd evm && na tsgo --noEmit

    echo "🔍 Type checking effect-evm-safe..."
    cd evm-safe && na tsgo --noEmit

    echo "🔍 Type checking effect-next..."
    cd next && na tsgo --noEmit

    echo "🔍 Type checking effect-solana..."
    cd solana && na tsgo --noEmit

    echo "🔍 Type checking effect-xstate..."
    cd xstate && na tsgo --noEmit

    echo "✅ All type check passed"
