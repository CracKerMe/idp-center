import { config } from '../config.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  userId?: string | null;
  tenantId?: string;
  requestId?: string;
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
}

export const logger = new Logger();
