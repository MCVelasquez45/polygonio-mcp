// Typed errors for the automation module. Each carries a stable `code` so
// routes and tests can assert on behavior rather than message strings.

export class AutomationError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 500) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** MongoDB is not connected — automation fails closed. */
export class MongoUnavailableError extends AutomationError {
  constructor(detail = 'MongoDB is not connected') {
    super('AUTOMATION_MONGO_UNAVAILABLE', `${detail}. Automation is UNAVAILABLE (fail-closed).`, 503);
  }
}

/** Any live-trading configuration is structurally rejected. */
export class LiveTradingBlockedError extends AutomationError {
  constructor(detail: string) {
    super('AUTOMATION_LIVE_TRADING_BLOCKED', `Live trading configuration rejected: ${detail}`, 403);
  }
}

export class BrokerUnavailableError extends AutomationError {
  constructor(detail: string) {
    super('AUTOMATION_BROKER_UNAVAILABLE', `Broker unavailable: ${detail}`, 503);
  }
}

/** Entry blocked because the market clock is not verifiably OPEN. */
export class MarketClockBlockedError extends AutomationError {
  constructor(state: string, reasons: string[]) {
    super(
      'AUTOMATION_MARKET_CLOCK_BLOCKED',
      `Entries blocked: market clock state=${state} (${reasons.join('; ') || 'no reasons provided'})`,
      409
    );
  }
}

export class SessionNotRunnableError extends AutomationError {
  constructor(sessionId: string, status: string) {
    super('AUTOMATION_SESSION_NOT_RUNNABLE', `Session ${sessionId} is not runnable (status=${status})`, 409);
  }
}

export class IllegalBrokerStateSourceError extends AutomationError {
  constructor(detail: string) {
    super(
      'AUTOMATION_ILLEGAL_BROKER_STATE_SOURCE',
      `Broker order states may only come from broker responses: ${detail}`,
      500
    );
  }
}

export class NotFoundError extends AutomationError {
  constructor(what: string) {
    super('AUTOMATION_NOT_FOUND', `${what} not found`, 404);
  }
}
