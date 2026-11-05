/**
 * src/repeatingAdapters.ts — PHASE3 repeating group adapters (4c).
 *
 * These are the EXACT functions used by App.tsx to connect RepeatingGroup
 * UI callbacks to the canonical factRecord. Extracted to a shared module
 * so the applicant-workflow test can exercise the identical code path
 * without React component mocking.
 *
 * Data contracts:
 * - Groups: factRecord.groups[groupId].items[] with {itemId, fields, provenance, createdAt, updatedAt}
 * - Persons: factRecord.persons[personId] with {role, facts, provenance, createdAt, updatedAt}
 */

export interface RepeatingEntry {
  entryId: string;
  fields: Record<string, string>;
}

/**
 * Convert factRecord groups to RepeatingGroup entries format.
 * Used by App.tsx to populate the RepeatingGroup component.
 */
export function getGroupEntries(factRecord: any, groupId: string): RepeatingEntry[] {
  if (!factRecord?.groups?.[groupId]?.items) return [];
  return factRecord.groups[groupId].items.map((item: any) => ({
    entryId: item.itemId,
    fields: item.fields || {},
  }));
}

/**
 * Convert factRecord persons (children) to RepeatingGroup entries format.
 */
export function getChildEntries(factRecord: any): RepeatingEntry[] {
  if (!factRecord?.persons) return [];
  return Object.entries(factRecord.persons)
    .filter(([_, p]: [string, any]) => p.role === 'child')
    .map(([personId, p]: [string, any]) => ({
      entryId: personId,
      fields: p.facts || {},
    }));
}

/**
 * Handle RepeatingGroup onAdd for groups (entries, last_address, etc.).
 * This is EXACTLY what App.tsx calls when the user clicks "Add" in the UI.
 */
export function handleGroupAdd(factRecord: any, groupId: string, entry: RepeatingEntry): any {
  if (!factRecord) return factRecord;
  const next = JSON.parse(JSON.stringify(factRecord));
  if (!next.groups) next.groups = {};
  if (!next.groups[groupId]) next.groups[groupId] = { items: [] };
  const now = new Date().toISOString();
  next.groups[groupId].items.push({
    itemId: entry.entryId || `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    fields: entry.fields,
    provenance: {},
    createdAt: now,
    updatedAt: now,
  });
  return next;
}

/**
 * Handle RepeatingGroup onUpdate for groups.
 */
export function handleGroupUpdate(factRecord: any, groupId: string, entryId: string, entry: RepeatingEntry): any {
  if (!factRecord) return factRecord;
  const next = JSON.parse(JSON.stringify(factRecord));
  const items = next.groups?.[groupId]?.items;
  if (!items) return next;
  const idx = items.findIndex((i: any) => i.itemId === entryId);
  if (idx >= 0) {
    items[idx].fields = entry.fields;
    items[idx].updatedAt = new Date().toISOString();
  }
  return next;
}

/**
 * Handle RepeatingGroup onDelete for groups.
 */
export function handleGroupDelete(factRecord: any, groupId: string, entryId: string): any {
  if (!factRecord) return factRecord;
  const next = JSON.parse(JSON.stringify(factRecord));
  const items = next.groups?.[groupId]?.items;
  if (!items) return next;
  next.groups[groupId].items = items.filter((i: any) => i.itemId !== entryId);
  return next;
}

/**
 * Handle RepeatingGroup onAdd for children (persons).
 * This is EXACTLY what App.tsx calls when the user adds a child in the UI.
 */
export function handleChildAdd(factRecord: any, entry: RepeatingEntry): any {
  if (!factRecord) return factRecord;
  const next = JSON.parse(JSON.stringify(factRecord));
  if (!next.persons) next.persons = {};
  const personId = entry.entryId || `child_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  next.persons[personId] = {
    role: 'child',
    facts: entry.fields,
    provenance: {},
    createdAt: now,
    updatedAt: now,
  };
  return next;
}

/**
 * Handle RepeatingGroup onUpdate for children.
 */
export function handleChildUpdate(factRecord: any, entryId: string, entry: RepeatingEntry): any {
  if (!factRecord) return factRecord;
  const next = JSON.parse(JSON.stringify(factRecord));
  if (!next.persons?.[entryId]) return next;
  next.persons[entryId].facts = entry.fields;
  next.persons[entryId].updatedAt = new Date().toISOString();
  return next;
}

/**
 * Handle RepeatingGroup onDelete for children.
 */
export function handleChildDelete(factRecord: any, entryId: string): any {
  if (!factRecord) return factRecord;
  const next = JSON.parse(JSON.stringify(factRecord));
  if (next.persons?.[entryId]) {
    delete next.persons[entryId];
  }
  return next;
}
