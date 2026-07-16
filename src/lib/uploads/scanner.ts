export type MalwareScannerAvailability = "available" | "disabled" | "unavailable"
export type MalwareScanOutcome = "CLEAN" | "INFECTED" | "ERROR"

export interface MalwareScanInput {
  attemptId: string
  openStream(): NodeJS.ReadableStream
}

export interface MalwareScanResult {
  outcome: MalwareScanOutcome
  scannerReference?: string
  scannedAt: Date
}

export interface MalwareScanner {
  availability(): Promise<MalwareScannerAvailability>
  scan(input: MalwareScanInput): Promise<MalwareScanResult>
}

export interface MalwareScannerAvailabilitySource {
  availability(): Promise<MalwareScannerAvailability>
}

export interface EventDrivenMalwareScanner extends MalwareScannerAvailabilitySource {
  readonly deliveryMode: "event-driven"
}

export class GuardDutyS3EventDrivenScanner implements EventDrivenMalwareScanner {
  readonly deliveryMode = "event-driven" as const

  constructor(private readonly configured: boolean, private readonly configurationValid: boolean) {}

  async availability(): Promise<MalwareScannerAvailability> {
    if (!this.configured) return "disabled"
    return this.configurationValid ? "available" : "unavailable"
  }
}

export class DisabledMalwareScanner implements MalwareScanner {
  async availability(): Promise<"disabled"> {
    return "disabled"
  }

  async scan(_input: MalwareScanInput): Promise<MalwareScanResult> {
    return { outcome: "ERROR", scannedAt: new Date() }
  }
}

abstract class DeterministicTestScanner implements MalwareScanner {
  constructor(private readonly outcome: MalwareScanOutcome, private readonly now: () => Date = () => new Date(0)) {}

  async availability(): Promise<"available"> {
    return "available"
  }

  async scan(_input: MalwareScanInput): Promise<MalwareScanResult> {
    return {
      outcome: this.outcome,
      scannerReference: `test-${this.outcome.toLowerCase()}`,
      scannedAt: this.now(),
    }
  }
}

export class DeterministicCleanTestScanner extends DeterministicTestScanner {
  constructor(now?: () => Date) {
    super("CLEAN", now)
  }
}

export class DeterministicInfectedTestScanner extends DeterministicTestScanner {
  constructor(now?: () => Date) {
    super("INFECTED", now)
  }
}

export class DeterministicErrorTestScanner extends DeterministicTestScanner {
  constructor(now?: () => Date) {
    super("ERROR", now)
  }
}
