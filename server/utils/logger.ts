import { config } from '../config.js';
import type { Request } from 'express';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  userId?: string | null;
  tenantId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  action?: string;
  [key: string]: any;
}

class Logger {
  private formatLog(level: LogLevel, message: string, context: LogContext = {}) {
    const timestamp = new Date().toISOString();
    const data = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...context,
    };

    if (config.NODE_ENV === 'production') {
      return JSON.stringify(data);
    }

    // Development formatting
    const ctxString = Object.keys(context).length 
      ? ` | ${JSON.stringify(context)}` 
      : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${ctxString}`;
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatLog('info', message, context));
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatLog('warn', message, context));
  }

  error(message: string, context?: LogContext) {
    console.error(this.formatLog('error', message, context));
  }

  debug(message: string, context?: LogContext) {
    if (config.NODE_ENV === 'development') {
      console.log(this.formatLog('debug', message, context));
    }
  }

  /**
   * Create a child logger with request context pre-populated.
   * Extracts requestId, traceId, spanId, userId, tenantId from the request.
   * 
   * Usage:
   *   const reqLogger = logger.withRequest(req);
   *   reqLogger.info('Processing request');
   */
  withRequest(req: Request): RequestLogger {
    const context: LogContext = {
      requestId: req.requestId,
      userId: (req as any).user?.id,
      tenantId: (req as any).tenantId,
    };

    // Extract trace context from headers (for OpenTelemetry / W3C Trace Context)
    const traceparent = req.headers['traceparent'] as string;
    if (traceparent) {
      // Format: version-traceId-spanId-traceFlags (e.g., 00-<32hex>-<16hex>-01)
      const parts = traceparent.split('-');
      if (parts.length === 4) {
        context.traceId = parts[1];
        context.spanId = parts[2];
      }
    }

    return new RequestLogger(context);
  }
}

/**
 * Logger with pre-populated request context.
 * All log methods automatically include requestId, traceId, spanId, userId, tenantId.
 */
class RequestLogger {
  private context: LogContext;

  constructor(context: LogContext) {
    this.context = context;
  }

  private formatLog(level: LogLevel, message: string, extra: LogContext = {}) {
    const timestamp = new Date().toISOString();
    const data = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...this.context,
      ...extra,
    };

    if (config.NODE_ENV === 'production') {
      return JSON.stringify(data);
    }

    const ctxString = Object.keys(data).length > 3 // > 3 because timestamp, level, message are always there
      ? ` | ${JSON.stringify({ ...this.context, ...extra })}` 
      : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${ctxString}`;
  }

  info(message: string, context?: LogContext) {
    console.log(this.formatLog('info', message, context));
  }

  warn(message: string, context?: LogContext) {
    console.warn(this.formatLog('warn', message, context));
  }

  error(message: string, context?: LogContext) {
    console.error(this.formatLog('error', message, context));
  }

  debug(message: string, context?: LogContext) {
    if (config.NODE_ENV === 'development') {
      console.log(this.formatLog('debug', message, context));
    }
  }
}

export const logger = new Logger();
export type { RequestLogger };
