# @prb/fmt

Effect-TS formatting utilities for numbers, dates, and durations.

## Installation

```bash
bun add @prb/fmt
```

## Usage

```typescript
import { fmt } from "@prb/fmt";

// Number formatting
fmt.number.integer(1234567); // "1,234,567"
fmt.number.decimal(123.456); // "123.456"
fmt.number.withFractionDigits(123.456789, { maxFractionDigits: 2 }); // "123.46"

// Date formatting
fmt.date.dateTimeMillis(Date.now()); // "Dec 17 '25 @ 3:45 pm"
fmt.date.dateMillis(Date.now()); // "Dec 17 '25"
fmt.date.relativeTime(Date.now() - 60000); // "1 minute ago"

// Duration formatting
fmt.duration.durationSecondsLargestUnit(3600); // "1 hour"
fmt.duration.elapsedDaysHoursSince(Date.now() - 86400000); // "1 day 0 hours"
```

## Direct imports

You can also import individual modules directly:

```typescript
import * as fmtNumber from "@prb/fmt/number";
import * as fmtDate from "@prb/fmt/date";
import * as fmtDuration from "@prb/fmt/duration";

fmtNumber.integer(1234567);
fmtDate.dateTimeMillis(Date.now());
fmtDuration.durationSecondsLargestUnit(3600);
```

## License

MIT
