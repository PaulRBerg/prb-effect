import type { SerializedError, TestModule, TestRunEndReason, TestSpecification } from "vitest/node";
import { DefaultReporter } from "vitest/reporters";

type DomainReporterOptions = {
  isTTY?: boolean;
  /** Path prefix to strip before inferring domains. Defaults to "src". */
  srcDir?: string;
  /** Auto-promote 2-level domains when parent has no direct tests. */
  promoteSingleSubdomain?: boolean;
};

type TestType = "unit" | "integration";

type Parsed = {
  module: TestModule;
  normalizedId: string;
  top: string;
  second?: string;
  testType: TestType;
};

type TopStat = {
  hasDirectTests: boolean;
  seconds: Set<string>;
};

const LEADING_DOT_SLASH = /^\.\/+/;
const TRAILING_SLASH = /\/+$/;

const normalizeModuleId = (id: string): string =>
  id.replaceAll("\\", "/").replace(LEADING_DOT_SLASH, "");

const normalizeDir = (dir: string): string => dir.replaceAll("\\", "/").replace(TRAILING_SLASH, "");

const getTestType = (normalizedId: string): TestType =>
  normalizedId.includes(".integration.") ? "integration" : "unit";

const parse = (relativeModuleId: string, srcDir: string): Omit<Parsed, "module"> => {
  const normalizedId = normalizeModuleId(relativeModuleId);
  const prefix = `${normalizeDir(srcDir)}/`;
  const inside = normalizedId.startsWith(prefix) ? normalizedId.slice(prefix.length) : normalizedId;

  const parts = inside.split("/").filter(Boolean);
  const top = parts[0] ?? "(root)";
  const second = parts.length >= 3 ? parts[1] : undefined;
  const testType = getTestType(normalizedId);

  return { normalizedId, second, testType, top };
};

/** Gather stats about each top-level domain */
function gatherTopStats(parsed: Parsed[]): Map<string, TopStat> {
  const topStats = new Map<string, TopStat>();
  for (const p of parsed) {
    const stat = topStats.get(p.top) ?? {
      hasDirectTests: false,
      seconds: new Set<string>(),
    };
    if (p.second) {
      stat.seconds.add(p.second);
    } else {
      stat.hasDirectTests = true;
    }
    topStats.set(p.top, stat);
  }
  return topStats;
}

/** Identify domains to promote to 2-level headers */
function findPromotedDomains(topStats: Map<string, TopStat>): Map<string, string> {
  const promoted = new Map<string, string>();
  for (const [top, stat] of topStats) {
    if (stat.hasDirectTests || stat.seconds.size !== 1) {
      continue;
    }
    const [onlySecond] = stat.seconds;
    if (onlySecond) {
      promoted.set(top, `${top}/${onlySecond}`);
    }
  }
  return promoted;
}

/** Group test modules by their resolved domain */
function groupByDomain(parsed: Parsed[], promoted: Map<string, string>): Map<string, Parsed[]> {
  const groups = new Map<string, Parsed[]>();
  for (const p of parsed) {
    const promotedDomain = promoted.get(p.top);
    const domain = promotedDomain && p.second ? promotedDomain : p.top;
    const arr = groups.get(domain);
    if (arr) {
      arr.push(p);
    } else {
      groups.set(domain, [p]);
    }
  }
  return groups;
}

export default class DomainReporter extends DefaultReporter {
  private readonly srcDir: string;
  private readonly promoteSingleSubdomain: boolean;
  private printingGroupedResults = false;

  constructor(options: DomainReporterOptions = {}) {
    super({ isTTY: options.isTTY });
    this.srcDir = options.srcDir ?? "src";
    this.promoteSingleSubdomain = options.promoteSingleSubdomain ?? true;
  }

  override onTestRunStart(specifications: readonly TestSpecification[]): void {
    if (this.renderSucceed === undefined) {
      this.renderSucceed = specifications.length <= 1;
    }
    super.onTestRunStart(specifications);
  }

  override onTestModuleEnd(testModule: TestModule): void {
    // Call super to update counters, but printTestModule is guarded by flag
    super.onTestModuleEnd(testModule);
  }

  override printTestModule(module: TestModule): void {
    if (this.printingGroupedResults) {
      super.printTestModule(module);
    }
  }

  override onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly SerializedError[],
    reason: TestRunEndReason
  ): void {
    this.printingGroupedResults = true;
    this.printGroupedByDomain(testModules);
    super.onTestRunEnd(testModules, unhandledErrors, reason);
  }

  private printGroupedByDomain(testModules: readonly TestModule[]): void {
    if (testModules.length === 0) {
      return;
    }

    const parsed = testModules.map(
      (module): Parsed => ({
        module,
        ...parse(module.relativeModuleId, this.srcDir),
      })
    );

    // Split by test type
    const unitTests = parsed.filter((p) => p.testType === "unit");
    const integrationTests = parsed.filter((p) => p.testType === "integration");

    // Print each type section
    if (unitTests.length > 0) {
      this.printTypeSection("unit", unitTests);
    }
    if (integrationTests.length > 0) {
      this.printTypeSection("integration", integrationTests);
    }
  }

  private printTypeSection(testType: TestType, tests: Parsed[]): void {
    this.log("");
    this.log(` ${testType.toUpperCase()}`);

    const topStats = gatherTopStats(tests);
    const promoted = this.promoteSingleSubdomain ? findPromotedDomains(topStats) : new Map();
    const groups = groupByDomain(tests, promoted);
    const domains = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

    for (const domain of domains) {
      this.printDomainGroup(domain, groups.get(domain) ?? []);
    }
  }

  private printDomainGroup(domain: string, items: Parsed[]): void {
    this.log(`   ${domain}`);

    const sorted = items.slice().sort((a, b) => a.normalizedId.localeCompare(b.normalizedId));

    for (const { module } of sorted) {
      this.printTestModule(module);
    }
  }
}
