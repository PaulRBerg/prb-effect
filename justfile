# See https://github.com/sablier-labs/devkit/blob/main/just/base.just
import "./node_modules/@prb/devkit/just/base.just"

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

build package:
    cd {{ package }} && just build
alias b := build

# Build all packages (.tgz)
@build-all:
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
alias ba := build-all

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

# Run Claude to bump release, push the commit and release tag, and publish to npm
@release package:
    zsh -ic 'ccbump {{ package }}'
    git push origin
    git push origin "{{ package }}@$(jq -r .version {{ package }}/package.json)"
    cd {{ package }} && bun pm pack --filename "$PWD/release.tgz" && test -f ./release.tgz
    cd {{ package }} && npm publish ./release.tgz --tag "$(jq -r '.version | capture("^[^-]+-(?<tag>[^.+]+)").tag // "latest"' package.json)"
alias rel := release

# ---------------------------------------------------------------------------- #
#                                     TESTS                                    #
# ---------------------------------------------------------------------------- #

# Run unit tests
[group("tests")]
@test-unit +args="":
    na vitest --exclude '**/*.test.integration.ts' {{ args }}
alias t := test-unit
alias tu := test-unit

# Run integration tests with env vars decrypted from .env via dotenvx
[group("tests")]
@test-integration +args="":
    na dotenvx run --quiet -- na vitest run --exclude '**/*.test.ts' {{ args }}
alias ti := test-integration

# ---------------------------------------------------------------------------- #
#                                    TYPE CHECK                                #
# ---------------------------------------------------------------------------- #

[group("checks")]
@type-check package="":
    {{ if package == "" {
        "just type-check-all"
    } else {
        "cd " + package + " && na tsgo --noEmit"
    } }}

# Run TypeScript check for all packages
[group("checks")]
@type-check-all:
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
