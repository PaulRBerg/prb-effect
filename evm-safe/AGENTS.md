# @prb/effect-evm-safe

## References

- Project overview: @README.md
- Dependencies: @package.json

## Testing

Tests resolve `@prb/effect-evm` from the built `evm/dist` (see `vitest.config.ts`), while type checks read `evm/src`
through `tsconfig.json` paths. After changing `evm`, run `just build evm` from the root before running evm-safe tests.
