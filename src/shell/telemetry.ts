import { TelemetryAdapter } from './interpreter.js'

// ═══════════════════════════════════════════════════════════════════════════
// CONSOLE TELEMETRY (Default, no external dependencies)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple telemetry adapter that logs to console with structured JSON.
 * Suitable for local development and Docker logs.
 */
export class ConsoleTelemetryAdapter implements TelemetryAdapter {
  private spans: Map<string, { name: string; startTime: number; attributes: Record<string, unknown> }> = new Map()
  private spanCounter = 0

  startSpan(name: string, attributes: Record<string, unknown>): string {
    const spanId = `span_${++this.spanCounter}`

    this.spans.set(spanId, {
      name,
      startTime: performance.now(),
      attributes,
    })

    this.log('debug', `Span started: ${name}`, { spanId, ...attributes })

    return spanId
  }

  endSpan(spanId: string, status: 'ok' | 'error', error?: string): void {
    const span = this.spans.get(spanId)

    if (!span) {
      this.log('warn', `Unknown span: ${spanId}`)
      return
    }

    const duration = performance.now() - span.startTime

    this.log('debug', `Span ended: ${span.name}`, {
      spanId,
      status,
      duration_ms: duration.toFixed(2),
      error,
    })

    this.spans.delete(spanId)
  }

  recordMetric(name: string, value: number, tags: Record<string, string>): void {
    const logEntry = {
      type: 'metric',
      timestamp: new Date().toISOString(),
      name,
      value,
      tags,
    }

    console.log(JSON.stringify(logEntry))
  }

  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown>
  ): void {
    const logEntry = {
      type: 'log',
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    }

    switch (level) {
      case 'debug':
        if (process.env['DEBUG']) {
          console.debug(JSON.stringify(logEntry))
        }
        break
      case 'info':
        console.info(JSON.stringify(logEntry))
        break
      case 'warn':
        console.warn(JSON.stringify(logEntry))
        break
      case 'error':
        console.error(JSON.stringify(logEntry))
        break
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPENTELEMETRY ADAPTER (Optional, for production)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OpenTelemetry adapter for production observability.
 * Requires @opentelemetry packages to be configured.
 */
export class OpenTelemetryAdapter implements TelemetryAdapter {
  private tracer: any // Would be actual OTel Tracer type
  private meter: any // Would be actual OTel Meter type
  private activeSpans: Map<string, any> = new Map()
  private spanCounter = 0

  constructor(serviceName: string = 'turbine') {
    // Initialize OpenTelemetry
    this.initOTel(serviceName)
  }

  private initOTel(serviceName: string): void {
    // This would be the actual OpenTelemetry initialization
    // Keeping it as a stub for now to avoid runtime dependency issues
    console.log(`[OTel] Initializing for service: ${serviceName}`)
  }

  startSpan(name: string, attributes: Record<string, unknown>): string {
    const spanId = `otel_span_${++this.spanCounter}`

    // Would use actual OTel API:
    // const span = this.tracer.startSpan(name, { attributes })
    // this.activeSpans.set(spanId, span)

    this.activeSpans.set(spanId, {
      name,
      attributes,
      startTime: Date.now(),
    })

    return spanId
  }

  endSpan(spanId: string, status: 'ok' | 'error', error?: string): void {
    const span = this.activeSpans.get(spanId)

    if (!span) return

    // Would use actual OTel API:
    // if (status === 'error') {
    //   span.setStatus({ code: SpanStatusCode.ERROR, message: error })
    // }
    // span.end()

    this.activeSpans.delete(spanId)
  }

  recordMetric(name: string, value: number, tags: Record<string, string>): void {
    // Would use actual OTel API:
    // const counter = this.meter.createCounter(name)
    // counter.add(value, tags)
  }

  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown>
  ): void {
    // OpenTelemetry logs would include trace context automatically
    const consoleTelemetry = new ConsoleTelemetryAdapter()
    consoleTelemetry.log(level, message, context)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NOOP TELEMETRY (for testing/silent mode)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * No-op telemetry adapter for testing or when telemetry is disabled.
 */
export class NoopTelemetryAdapter implements TelemetryAdapter {
  private spanCounter = 0

  startSpan(_name: string, _attributes: Record<string, unknown>): string {
    return `noop_${++this.spanCounter}`
  }

  endSpan(_spanId: string, _status: 'ok' | 'error', _error?: string): void {
    // No-op
  }

  recordMetric(_name: string, _value: number, _tags: Record<string, string>): void {
    // No-op
  }

  log(
    _level: 'debug' | 'info' | 'warn' | 'error',
    _message: string,
    _context: Record<string, unknown>
  ): void {
    // No-op
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATING TELEMETRY (collects metrics for summary)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Telemetry adapter that aggregates metrics for end-of-run summary.
 */
export class AggregatingTelemetryAdapter implements TelemetryAdapter {
  private delegate: TelemetryAdapter
  private metrics: Map<string, { sum: number; count: number; min: number; max: number }> = new Map()
  private logs: Array<{ level: string; message: string; timestamp: Date }> = []

  constructor(delegate: TelemetryAdapter) {
    this.delegate = delegate
  }

  startSpan(name: string, attributes: Record<string, unknown>): string {
    return this.delegate.startSpan(name, attributes)
  }

  endSpan(spanId: string, status: 'ok' | 'error', error?: string): void {
    this.delegate.endSpan(spanId, status, error)
  }

  recordMetric(name: string, value: number, tags: Record<string, string>): void {
    this.delegate.recordMetric(name, value, tags)

    // Aggregate
    const existing = this.metrics.get(name) ?? { sum: 0, count: 0, min: Infinity, max: -Infinity }

    this.metrics.set(name, {
      sum: existing.sum + value,
      count: existing.count + 1,
      min: Math.min(existing.min, value),
      max: Math.max(existing.max, value),
    })
  }

  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown>
  ): void {
    this.delegate.log(level, message, context)

    // Keep recent logs for summary
    this.logs.push({ level, message, timestamp: new Date() })

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs.shift()
    }
  }

  getSummary(): {
    metrics: Map<string, { sum: number; count: number; min: number; max: number; avg: number }>
    errorCount: number
    warnCount: number
  } {
    const metricsWithAvg = new Map<string, { sum: number; count: number; min: number; max: number; avg: number }>()

    for (const [name, stats] of this.metrics) {
      metricsWithAvg.set(name, {
        ...stats,
        avg: stats.count > 0 ? stats.sum / stats.count : 0,
      })
    }

    return {
      metrics: metricsWithAvg,
      errorCount: this.logs.filter((l) => l.level === 'error').length,
      warnCount: this.logs.filter((l) => l.level === 'warn').length,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

export type TelemetryType = 'console' | 'otel' | 'noop'

export function createTelemetryAdapter(type: TelemetryType, options?: { serviceName?: string }): TelemetryAdapter {
  switch (type) {
    case 'console':
      return new ConsoleTelemetryAdapter()
    case 'otel':
      return new OpenTelemetryAdapter(options?.serviceName)
    case 'noop':
      return new NoopTelemetryAdapter()
  }
}
