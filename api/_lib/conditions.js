/**
 * api/_lib/conditions.js — Declarative conditional logic for IRU (Phase 1).
 *
 * Questions and fields are not always applicable. A single shared evaluator
 * determines whether a condition holds, given the fact record.
 *
 * A CONDITION is:
 * {
 *   fact: string,           // factId to check
 *   operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'exists' | 'not_exists',
 *   value: any,             // for equals/not_equals/in/not_in
 * }
 *
 * Conditions can be combined with AND/OR:
 * {
 *   and: [Condition],
 *   or: [Condition],
 * }
 *
 * Examples:
 * - Spouse section: { fact: 'marital_status', operator: 'equals', value: 'married' }
 * - I-765 Item 7: { fact: 'mailing_same_as_residence', operator: 'equals', value: 'no' }
 * - Part B explanation: { fact: 'part_b_q1', operator: 'equals', value: 'yes' }
 */

/**
 * Evaluate a single condition against a fact record.
 * @param {object} condition - The condition to evaluate
 * @param {object} facts - Flat facts object { factId: value }
 * @returns {boolean}
 */
export function evaluateCondition(condition, facts) {
  if (!condition) return true; // No condition = always applies

  // Compound conditions
  if (condition.and) {
    return condition.and.every(c => evaluateCondition(c, facts));
  }
  if (condition.or) {
    return condition.or.some(c => evaluateCondition(c, facts));
  }

  // Simple condition
  const { fact, operator, value } = condition;
  const factValue = facts[fact];

  switch (operator) {
    case 'equals':
      return factValue === value;
    case 'not_equals':
      return factValue !== value;
    case 'in':
      return Array.isArray(value) && value.includes(factValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(factValue);
    case 'exists':
      return factValue !== undefined && factValue !== null && factValue !== '';
    case 'not_exists':
      return factValue === undefined || factValue === null || factValue === '';
    default:
      throw new Error(`conditions: unknown operator "${operator}"`);
  }
}

/**
 * Check if a question/field applies given the current facts.
 * @param {object} appliesWhen - Condition object or null
 * @param {object} facts - Flat facts object
 * @returns {boolean}
 */
export function appliesWhen(appliesWhen, facts) {
  return evaluateCondition(appliesWhen, facts);
}

/**
 * Filter a list of items to those that apply.
 * @param {Array} items - Items with optional `appliesWhen` property
 * @param {object} facts - Flat facts object
 * @returns {Array} - Only the applicable items
 */
export function filterApplicable(items, facts) {
  return items.filter(item => appliesWhen(item.appliesWhen, facts));
}
