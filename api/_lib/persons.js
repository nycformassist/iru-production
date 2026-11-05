/**
 * api/_lib/persons.js — Person records for IRU (Phase 1).
 *
 * Immigration forms require information about OTHER people: spouse,
 * children, parents, siblings. Each person is a structured record with
 * their own facts, not a flat list of prefixed field names.
 *
 * Structure:
 *   persons: {
 *     [personId]: {
 *       role: 'spouse' | 'child' | 'parent' | 'sibling',
 *       facts: { [factId]: value },
 *       provenance: { [factId]: { source, status, updatedAt } },
 *       createdAt, updatedAt,
 *     }
 *   }
 *
 * Person roles and their form usage:
 * - spouse: I-589 Part A.II (gated on marital_status = married)
 * - child: I-589 Part A.II + Supplement A (up to 4 inline, overflow to Supplement A)
 * - parent: I-589 Part A.III Q5 (family table)
 * - sibling: I-589 Part A.III Q5 (family table)
 */

export const PERSON_ROLES = ['spouse', 'child', 'parent', 'sibling'];

export const PERSON_FIELD_SCHEMA = {
  spouse: [
    'full_name', 'family_name', 'given_name', 'middle_name',
    'date_of_birth', 'country_of_birth', 'citizenship', 'a_number',
    'residence_street', 'residence_city', 'residence_region', 'residence_postal_code',
  ],
  child: [
    'full_name', 'family_name', 'given_name', 'middle_name',
    'date_of_birth', 'country_of_birth', 'citizenship', 'a_number',
  ],
  parent: [
    'full_name', 'date_of_birth', 'country_of_birth', 'citizenship',
    'residence_city', 'residence_country', 'deceased',
  ],
  sibling: [
    'full_name', 'date_of_birth', 'country_of_birth', 'citizenship',
    'residence_city', 'residence_country', 'deceased',
  ],
};

// I-589 allows 4 children inline; beyond that goes to Supplement A
export const MAX_INLINE_CHILDREN = 4;

/**
 * Create an empty persons container.
 */
export function createPersons() {
  return {};
}

/**
 * Add a person record. Returns the personId.
 */
export function addPerson(persons, role, facts, source = 'answer') {
  if (!PERSON_ROLES.includes(role)) {
    throw new Error(`persons: unknown role "${role}"`);
  }

  const personId = `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const person = {
    personId,
    role,
    facts: {},
    provenance: {},
    createdAt: now,
    updatedAt: now,
  };

  const schema = PERSON_FIELD_SCHEMA[role] || [];
  for (const fieldId of schema) {
    if (facts[fieldId] !== undefined) {
      person.facts[fieldId] = facts[fieldId];
      person.provenance[fieldId] = { source, status: 'reported', updatedAt: now };
    }
  }

  persons[personId] = person;
  return personId;
}

/**
 * Update a field in a person record.
 */
export function updatePerson(persons, personId, fieldId, value, source = 'correction') {
  const person = persons[personId];
  if (!person) throw new Error(`persons: person "${personId}" not found`);

  const now = new Date().toISOString();
  person.facts[fieldId] = value;
  person.provenance[fieldId] = { source, status: 'reported', updatedAt: now };
  person.updatedAt = now;
}

/**
 * Remove a person record.
 */
export function removePerson(persons, personId) {
  if (!persons[personId]) return false;
  delete persons[personId];
  return true;
}

/**
 * Get all persons by role.
 */
export function getPersonsByRole(persons, role) {
  return Object.values(persons).filter(p => p.role === role);
}

/**
 * Get the spouse (there should be at most one).
 */
export function getSpouse(persons) {
  const spouses = getPersonsByRole(persons, 'spouse');
  return spouses[0] || null;
}

/**
 * Get children, split into inline (first 4) and supplement (rest).
 */
export function getChildrenSplit(persons) {
  const children = getPersonsByRole(persons, 'child');
  return {
    inline: children.slice(0, MAX_INLINE_CHILDREN),
    supplement: children.slice(MAX_INLINE_CHILDREN),
    needsSupplementA: children.length > MAX_INLINE_CHILDREN,
  };
}
