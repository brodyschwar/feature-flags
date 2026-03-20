import { createHash } from 'crypto';
import type { FlagDefinition, EvaluationContext } from './types.js';

export function evaluate(definition: FlagDefinition, context?: EvaluationContext): boolean {
  switch (definition.type) {
    case 'boolean':
      return definition.rules.enabled;

    case 'percentage': {
      const userId = context?.userId;
      if (!userId) return false;
      const hash = createHash('sha256').update(`${userId}:${definition.key}`).digest('hex');
      // Use first 8 hex chars (32 bits) for a uniform bucket in 0–99
      const bucket = parseInt(hash.slice(0, 8), 16) % 100;
      return bucket < definition.rules.percentage;
    }

    case 'user_segmented': {
      const attributes = context?.attributes ?? {};
      for (const segment of definition.rules.segments) {
        const value = attributes[segment.attribute];
        if (matchesSegment(value, segment.operator, segment.values)) {
          return segment.result;
        }
      }
      return definition.rules.defaultValue;
    }
  }
}

function matchesSegment(
  value: string | undefined,
  operator: string,
  values: string[],
): boolean {
  if (value === undefined) return false;
  switch (operator) {
    case 'eq':       return value === values[0];
    case 'neq':      return value !== values[0];
    case 'in':       return values.includes(value);
    case 'not_in':   return !values.includes(value);
    case 'contains': return value.includes(values[0]);
    case 'regex':    return new RegExp(values[0]).test(value);
    default:         return false;
  }
}
