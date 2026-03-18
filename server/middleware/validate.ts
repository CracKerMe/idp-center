/**
 * Request Validation Middleware using Zod
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { error, ErrorCode } from '../utils/response.js';

export type ValidationSchema = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

/**
 * Create a validation middleware for request body, query, or params
 */
export function validate(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: Record<string, string[]> = {};

    // Validate body
    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      if (!result.success) {
        errors.body = formatZodErrors(result.error);
      }
    }

    // Validate query
    if (schema.query) {
      const result = schema.query.safeParse(req.query);
      if (!result.success) {
        errors.query = formatZodErrors(result.error);
      }
    }

    // Validate params
    if (schema.params) {
      const result = schema.params.safeParse(req.params);
      if (!result.success) {
        errors.params = formatZodErrors(result.error);
      }
    }

    // If there are errors, return 400
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        ...error('Validation failed', ErrorCode.VALIDATION_ERROR),
        details: errors,
      });
    }

    next();
  };
}

/**
 * Format Zod errors into a simple string array
 */
function formatZodErrors(err: z.ZodError): string[] {
  return err.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Common validation schemas
 */
export const commonSchemas = {
  id: z.string().uuid(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  otp: z.string().length(6).regex(/^\d+$/, 'OTP must be 6 digits'),
  token: z.string().min(1),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
};
