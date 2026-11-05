/**
 * api/_lib/groups.js — Repeating information groups for IRU (Phase 1).
 *
 * Some form data is naturally repeating: a person may have multiple
 * entries into the US, multiple addresses, multiple employers, multiple
 * names. The flat fact record cannot represent these.
 *
 * A GROUP is an ordered list of ITEMS. Each item is a set of field values
 * with the same provenance/conflict semantics as single facts.
 *
 * Structure:
 *   groups: {
 *     [groupId]: {
 *       definition: GroupDefinition,  // schema, not stored per-record
 *       items: [GroupItem],
 *     }
 *   }
 *
 * A GroupItem:
 * {
 *   itemId: string,           // stable within the group
 *   fields: { [fieldId]: value },
 *   provenance: { [fieldId]: { source, status, updatedAt } },
 *   createdAt, updatedAt,
 * }
 *
 * Group definitions (schema):
 * {
 *   id: string,               // 'entries', 'addresses', 'employers', 'other_names', etc.
 *   fields: [{ id, type, required }],  // field schema
 *   maxItems: number|null,    // null = unlimited
 *   forms: string[],          // which forms use this group
 * }
 */

export const GROUP_DEFINITIONS = {
  entries: {
    id: 'entries',
    label: 'US entries',
    fields: [
      { id: 'entry_date', type: 'date', required: true },
      { id: 'entry_place', type: 'string', required: false },
      { id: 'entry_manner', type: 'string', required: false },
      { id: 'entry_status', type: 'string', required: false },
    ],
    maxItems: null,
    forms: ['I-589', 'I-765'],
    // I-589: Part A.I Item 19.c (first rows inline, overflow to Supplement B)
    // I-765: Items 23-25 (place of last arrival, status at last entry)
  },
  other_names: {
    id: 'other_names',
    label: 'Other names used',
    fields: [
      { id: 'family_name', type: 'string', required: true },
      { id: 'given_name', type: 'string', required: true },
      { id: 'middle_name', type: 'string', required: false },
    ],
    maxItems: null,
    forms: ['I-589', 'I-765'],
    // I-589: Part A.I Item 1 (other names)
    // I-765: Item 3 (other names used)
  },
  addresses: {
    id: 'addresses',
    label: 'Address history',
    fields: [
      { id: 'street', type: 'string', required: true },
      { id: 'city', type: 'string', required: true },
      { id: 'region', type: 'string', required: true },
      { id: 'postal_code', type: 'string', required: true },
      { id: 'country', type: 'string', required: false },
      { id: 'from_date', type: 'date', required: false },
      { id: 'to_date', type: 'date', required: false },
    ],
    maxItems: null,
    forms: ['I-589'],
    // I-589: Part A.III residence history (5-year)
  },
  employment: {
    id: 'employment',
    label: 'Employment history',
    fields: [
      { id: 'employer_name', type: 'string', required: true },
      { id: 'occupation', type: 'string', required: false },
      { id: 'from_date', type: 'date', required: false },
      { id: 'to_date', type: 'date', required: false },
    ],
    maxItems: null,
    forms: ['I-589'],
    // I-589: Part A.III employment history (5-year)
  },
  education: {
    id: 'education',
    label: 'Education history',
    fields: [
      { id: 'school_name', type: 'string', required: true },
      { id: 'from_date', type: 'date', required: false },
      { id: 'to_date', type: 'date', required: false },
    ],
    maxItems: null,
    forms: ['I-589'],
    // I-589: Part A.III education history
  },
};

/**
 * Create an empty groups container.
 */
export function createGroups() {
  return {};
}

/**
 * Add an item to a group. Returns the new itemId.
 */
export function addGroupItem(groups, groupId, fields, source = 'answer') {
  const def = GROUP_DEFINITIONS[groupId];
  if (!def) throw new Error(`groups: unknown group "${groupId}"`);

  if (!groups[groupId]) {
    groups[groupId] = { items: [] };
  }

  const group = groups[groupId];
  if (def.maxItems !== null && group.items.length >= def.maxItems) {
    throw new Error(`groups: group "${groupId}" at max capacity (${def.maxItems})`);
  }

  const itemId = `${groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const item = {
    itemId,
    fields: {},
    provenance: {},
    createdAt: now,
    updatedAt: now,
  };

  for (const fieldDef of def.fields) {
    const value = fields[fieldDef.id];
    if (value !== undefined) {
      item.fields[fieldDef.id] = value;
      item.provenance[fieldDef.id] = { source, status: 'reported', updatedAt: now };
    } else if (fieldDef.required) {
      item.fields[fieldDef.id] = null;
      item.provenance[fieldDef.id] = { source: null, status: 'unknown', updatedAt: now };
    }
  }

  group.items.push(item);
  return itemId;
}

/**
 * Update a field in a group item.
 */
export function updateGroupItem(groups, groupId, itemId, fieldId, value, source = 'correction') {
  const group = groups[groupId];
  if (!group) throw new Error(`groups: group "${groupId}" not found`);

  const item = group.items.find(i => i.itemId === itemId);
  if (!item) throw new Error(`groups: item "${itemId}" not found in "${groupId}"`);

  const now = new Date().toISOString();
  const oldValue = item.fields[fieldId];

  // Preserve history on change
  if (oldValue !== value && oldValue !== undefined) {
    if (!item.history) item.history = [];
    item.history.push({
      fieldId,
      value: oldValue,
      source: item.provenance[fieldId]?.source,
      updatedAt: item.provenance[fieldId]?.updatedAt,
    });
  }

  item.fields[fieldId] = value;
  item.provenance[fieldId] = { source, status: 'reported', updatedAt: now };
  item.updatedAt = now;
}

/**
 * Remove an item from a group.
 */
export function removeGroupItem(groups, groupId, itemId) {
  const group = groups[groupId];
  if (!group) return false;
  const idx = group.items.findIndex(i => i.itemId === itemId);
  if (idx === -1) return false;
  group.items.splice(idx, 1);
  return true;
}

/**
 * Get all items in a group.
 */
export function getGroupItems(groups, groupId) {
  return groups[groupId]?.items || [];
}
