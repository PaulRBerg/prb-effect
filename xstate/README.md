# @prb/xstate

> [!WARNING] This is experimental, beta software. It is provided "as is" without warranty of any kind, express or
> implied.

Effect-TS and xState v5 workflow utilities for React applications.

## Overview

This package provides reusable state machines and React hooks that combine Effect-TS's functional effect system with
xState v5's state management capabilities.

## Features

- **Form Machine**: Generic form workflow with validation, processing, and error handling
- **Facilitator Machine**: Check-then-create workflow for eligibility and resource creation
- **React Hooks**: Type-safe hooks for managing machine state in React components
- **Error Utilities**: Helpers for extracting and displaying structured error data

## Installation

```bash
bun add @prb/xstate effect xstate @xstate/react
```

## Usage

### Form Machine

Create a form workflow that validates inputs before processing:

```typescript
import { createFormMachine } from "@prb/xstate";
import { Effect } from "effect";

const machine = createFormMachine({
  id: "create-stream",
  services: {
    onCheck: (payload) => Effect.succeed(undefined),
    onValidate: (payload) => Effect.succeed({ validated: true }),
    onProcess: ({ payload, preprocess }) => Effect.succeed(undefined),
  },
});
```

### Facilitator Machine

Create a check-then-create workflow:

```typescript
import { createFacilitatorMachine } from "@prb/xstate";
import { Effect } from "effect";

const machine = createFacilitatorMachine({
  id: "claim-airdrop",
  services: {
    onCheck: (payload) => Effect.succeed({ status: "true", transitive: { proof: "0x..." } }),
    onCreate: ({ create, transitive }) => Effect.succeed(undefined),
  },
});
```

### React Hook

```typescript
import { useFacilitatorWorkflow } from "@prb/xstate";

function MyComponent() {
  const workflow = useFacilitatorWorkflow(machine);

  return (
    <div>
      <button onClick={() => workflow.check({ id: 123 })}>
        Check Eligibility
      </button>
      {workflow.status.isEligible && (
        <button onClick={() => workflow.create({ id: 123 })}>
          Create Resource
        </button>
      )}
    </div>
  );
}
```

## License

MIT
