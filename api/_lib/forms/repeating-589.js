/**
 * api/_lib/forms/repeating-589.js — I-589 repeating field mappings (Phase 3, 4c).
 *
 * Maps the 266 Class 5 (repeating information) fields to the Phase 1
 * groups.js/persons.js infrastructure.
 *
 * Each REPEATING_SET defines:
 *   - groupId: the groups.js group or persons.js role
 *   - pdfBase: the PDF field name pattern
 *   - fields: array of { pdfSuffix, fieldId, label }
 *   - maxInline: how many fit on the main form before overflow
 *   - overflowTo: where excess items go (Supplement A/B)
 */

export const REPEATING_SETS_589 = {
  // Part A.I Item 19.C — Entry history (9 fields: 3 entries × 3 fields)
  entry_history: {
    groupId: 'entries',
    section: 'Part A.I Item 19.C',
    pdfBase: 'form1[0].#subform[0]',
    maxInline: 3,
    overflowTo: null, // Additional entries go to Supplement B
    fields: [
      // Entry 1 (most recent)
      { pdfSuffix: 'TextField4[0]', fieldId: 'entry_place', label: 'Entry 1 place' },
      { pdfSuffix: 'TextField4[1]', fieldId: 'entry_status', label: 'Entry 1 status' },
      { pdfSuffix: 'DateTimeField3[0]', fieldId: 'entry_date', label: 'Entry 1 date', dateMDY: true },
      // Entry 2
      { pdfSuffix: 'TextField4[2]', fieldId: 'entry_place', label: 'Entry 2 place', itemIndex: 1 },
      { pdfSuffix: 'TextField4[3]', fieldId: 'entry_status', label: 'Entry 2 status', itemIndex: 1 },
      { pdfSuffix: 'DateTimeField3[1]', fieldId: 'entry_date', label: 'Entry 2 date', itemIndex: 1, dateMDY: true },
      // Entry 3
      { pdfSuffix: 'TextField4[4]', fieldId: 'entry_place', label: 'Entry 3 place', itemIndex: 2 },
      { pdfSuffix: 'TextField4[5]', fieldId: 'entry_status', label: 'Entry 3 status', itemIndex: 2 },
      { pdfSuffix: 'DateTimeField3[2]', fieldId: 'entry_date', label: 'Entry 3 date', itemIndex: 2, dateMDY: true },
    ],
  },

  // Part A.III Q1 — Last address (12 fields in #subform[4])
  last_address: {
    groupId: 'last_address',
    section: 'Part A.III Q1',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 1,
    overflowTo: null,
    fields: [
      { pdfSuffix: 'TextField13[0]', fieldId: 'street', label: 'Last address street' },
      { pdfSuffix: 'TextField13[1]', fieldId: 'city', label: 'Last address city' },
      { pdfSuffix: 'TextField13[2]', fieldId: 'region', label: 'Last address state/province' },
      { pdfSuffix: 'TextField13[3]', fieldId: 'country', label: 'Last address country' },
      { pdfSuffix: 'TextField13[4]', fieldId: 'postal_code', label: 'Last address postal code' },
      { pdfSuffix: 'TextField13[5]', fieldId: 'address_line_2', label: 'Last address line 2' },
      { pdfSuffix: 'TextField13[6]', fieldId: 'district', label: 'Last address district' },
      { pdfSuffix: 'TextField13[7]', fieldId: 'address_notes', label: 'Last address notes' },
      { pdfSuffix: 'DateTimeField20[0]', fieldId: 'from_date_alt', label: 'Last address from date (alt)', dateMDY: true },
      { pdfSuffix: 'DateTimeField21[0]', fieldId: 'from_date', label: 'Last address from date', dateMDY: true },
      { pdfSuffix: 'DateTimeField22[0]', fieldId: 'to_date', label: 'Last address to date', dateMDY: true },
      { pdfSuffix: 'DateTimeField23[0]', fieldId: 'to_date_alt', label: 'Last address to date (alt)', dateMDY: true },
    ],
  },

  // Part A.III Q2 — Residences last 5 years (30 fields in #subform[4])
  residences_5yr: {
    groupId: 'addresses',
    section: 'Part A.III Q2',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 5,
    overflowTo: 'supplement_b',
    generateFields: (base) => {
      const fields = [];
      // TextField13[8-27]: 5 residences × 4 text fields
      for (let i = 0; i < 5; i++) {
        const o = 8 + (i * 4);
        fields.push(
          { pdfSuffix: `TextField13[${o}]`, fieldId: 'street', label: `Residence ${i+1} street`, itemIndex: i },
          { pdfSuffix: `TextField13[${o+1}]`, fieldId: 'city', label: `Residence ${i+1} city`, itemIndex: i },
          { pdfSuffix: `TextField13[${o+2}]`, fieldId: 'region', label: `Residence ${i+1} state`, itemIndex: i },
          { pdfSuffix: `TextField13[${o+3}]`, fieldId: 'country', label: `Residence ${i+1} country`, itemIndex: i },
        );
      }
      // DateTimeField24-33: 5 residences × 2 dates (from, to)
      const dateFields = [24, 26, 28, 30, 32];
      for (let i = 0; i < 5; i++) {
        fields.push(
          { pdfSuffix: `DateTimeField${dateFields[i]}[0]`, fieldId: 'from_date', label: `Residence ${i+1} from`, itemIndex: i, dateMDY: true },
          { pdfSuffix: `DateTimeField${dateFields[i]+1}[0]`, fieldId: 'to_date', label: `Residence ${i+1} to`, itemIndex: i, dateMDY: true },
        );
      }
      return fields;
    },
  },

  // Part A.II — Children (104 fields: 4 inline × 26, overflow to Supplement A)
  // Note: Child 1 in #subform[1], Children 2-4 in #subform[3]
  children: {
    groupId: 'children',
    section: 'Part A.II Children',
    pdfBase: 'form1[0]',
    maxInline: 4,
    overflowTo: 'supplement_a',
    generateFields: (base) => {
      const fields = [];
      const coreFields = [
        ['ChildLast', 'family_name', 'Last name'],
        ['ChildFirst', 'given_name', 'First name'],
        ['ChildMiddle', 'middle_name', 'Middle name'],
        ['ChildDOB', 'date_of_birth', 'Date of birth', true],
        ['ChildNat', 'nationality', 'Nationality'],
        ['ChildRace', 'race', 'Race/ethnic group'],
        ['ChildCity', 'birth_city', 'Birth city'],
        ['ChildPassport', 'passport_number', 'Passport number'],
        ['ChildAlien', 'a_number', 'A-Number'],
        ['ChildMarital', 'marital_status', 'Marital status'],
      ];
      const subforms = ['#subform[1]', '#subform[3]', '#subform[3]', '#subform[3]'];
      const sexBoxes = [
        ['CheckBox12_Sex', 0],  // Child 1
        ['CheckBox26_Sex', 0],  // Child 2
        ['CheckBox36_Sex', 0],  // Child 3
        ['CheckBox46_Sex', 0],  // Child 4
      ];
      for (let i = 0; i < 4; i++) {
        const n = i + 1;
        const sf = subforms[i];
        for (const [prefix, fieldId, label, dateMDY] of coreFields) {
          fields.push({
            pdfField: `form1[0].${sf}.${prefix}${n}[0]`,
            fieldId: fieldId,
            label: `Child ${n} ${label.toLowerCase()}`,
            itemIndex: i,
            ...(dateMDY ? { dateMDY: true } : {}),
          });
        }
        // Sex checkboxes (Male[0], Female[1])
        const [sexBoxName] = sexBoxes[i];
        fields.push({
          pdfField: `form1[0].${sf}.${sexBoxName}[0]`,
          fieldId: 'sex_male',
          label: `Child ${n} sex Male`,
          itemIndex: i,
          checkbox: true,
        });
        fields.push({
          pdfField: `form1[0].${sf}.${sexBoxName}[1]`,
          fieldId: 'sex_female',
          label: `Child ${n} sex Female`,
          itemIndex: i,
          checkbox: true,
        });
      }
      return fields;
    },
  },

  // Part A.III Q3 — Education (12 fields in #subform[4])
  // VERIFIED against public/forms/i-589.pdf with PyMuPDF (Carbon Pass 1
  // finding 9): TextField13 in #subform[4] runs 0..57 only. Q3 occupies
  // 28..39 — two schools x 6 slots (3 columns x 2 rows each: Name of
  // School / Type of School / Location). The old 28..47 range (4 schools)
  // collided with employment at 40..47. maxInline is 2; further schools
  // go to Supplement B overflow text.
  education: {
    groupId: 'education',
    section: 'Part A.III Q3 Education',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 2,
    overflowTo: 'supplement_b',
    generateFields: (base) => {
      const fields = [];
      // Per school: [name, degree, field_of_study, city, country] ->
      // TextField13 slots [col1 row1, col1 row2, col2 row1, col3 row1,
      // col3 row2]. Col2 row2 (31 / 38) has no matching abstract field.
      const slots = [
        [28, 29, 30, 32, 33],
        [34, 37, 35, 36, 39],
      ];
      const fieldIds = ['school_name', 'degree', 'field_of_study', 'school_city', 'school_country'];
      for (let i = 0; i < 2; i++) {
        fieldIds.forEach((fieldId, j) => {
          fields.push(
            { pdfSuffix: `TextField13[${slots[i][j]}]`, fieldId, label: `School ${i+1} ${fieldId.replace(/_/g, ' ')}`, itemIndex: i },
          );
        });
      }
      return fields;
    },
  },

  // Part A.III Q4 — Employment (6 fields in #subform[4])
  // VERIFIED with PyMuPDF: Q4 occupies TextField13[40..45] only —
  // employer 1 rows y512/y530 (name/address + occupation, two lines
  // each) and employer 2 row y548 (one line each). The old 40..51 range
  // (3 employers) collided with education at 40..47 and family at
  // 46..51. maxInline is 2; further employers go to Supplement B.
  employment: {
    groupId: 'employment',
    section: 'Part A.III Q4 Employment',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 2,
    overflowTo: 'supplement_b',
    generateFields: (base) => {
      const fields = [];
      // Employer 1: name 40, city 41, occupation 42, country 43.
      // Employer 2: name 44, occupation 45 (city/country overflow).
      const slots = [
        [40, 41, 42, 43],
        [44, 45],
      ];
      const fieldIds = [
        ['employer_name', 'employer_city', 'occupation', 'employer_country'],
        ['employer_name', 'occupation'],
      ];
      for (let i = 0; i < 2; i++) {
        fieldIds[i].forEach((fieldId, j) => {
          fields.push(
            { pdfSuffix: `TextField13[${slots[i][j]}]`, fieldId, label: `Employer ${i+1} ${fieldId.replace(/_/g, ' ')}`, itemIndex: i },
          );
        });
      }
      return fields;
    },
  },

  // Part A.III Q5 — Parents and siblings (12 TextField13 + 6 TextField35)
  // VERIFIED with PyMuPDF: Q5 occupies TextField13[46..57] — six rows
  // (Mother, Father, 4x Sibling) x 2 columns (Full Name | City/Town and
  // Country of Birth) — plus TextField35[0..5] (Current Location, one
  // per row) and a Deceased checkbox per row. The old 46..69 range
  // (6 members x 4 fields) ran past the end of the field (58..69 do not
  // exist) and collided with employment at 46..51. maxInline is 6.
  // Inline slots: family_name -> Full Name; city -> Current Location
  // (TextField35, matching the UI label "City where they live").
  // relationship / country have no inline PDF column (the row label IS
  // the relationship; there is no birth-country column for a current
  // location) — they travel in the Supplement B overflow text.
  family_members: {
    groupId: 'family',
    section: 'Part A.III Q5 Parents/Siblings',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 6,
    overflowTo: 'supplement_b',
    generateFields: (base) => {
      const fields = [];
      // Row order on the form: Mother, Father, Sibling, Sibling,
      // Sibling, Sibling.
      const nameSlots = [46, 47, 48, 52, 54, 56];
      for (let i = 0; i < 6; i++) {
        fields.push(
          { pdfSuffix: `TextField13[${nameSlots[i]}]`, fieldId: 'family_name', label: `Family ${i+1} name`, itemIndex: i },
          { pdfSuffix: `TextField35[${i}]`, fieldId: 'city', label: `Family ${i+1} current location (city)`, itemIndex: i },
        );
      }
      return fields;
    },
  },

  // Supplement B — Continuation sheet (3 fields in #subform[13])
  supplement_b: {
    groupId: 'supplement_b',
    section: 'Supplement B',
    pdfBase: 'form1[0].#subform[13]',
    maxInline: 1,
    overflowTo: null,  // Terminal - no further overflow
    fields: [
      { pdfSuffix: 'TextField31[0]', fieldId: 'continuation_text_1', label: 'Continuation 1' },
      { pdfSuffix: 'TextField31[1]', fieldId: 'continuation_text_2', label: 'Continuation 2' },
      { pdfSuffix: 'TextField32[0]', fieldId: 'continuation_text_3', label: 'Continuation 3' },
    ],
  },
};

/**
 * Get all PDF field mappings for a repeating set, expanded for maxInline items.
 */
export function expandRepeatingSet(setId) {
  const set = REPEATING_SETS_589[setId];
  if (!set) return [];
  
  let fields = set.fields;
  if (set.generateFields) {
    fields = set.generateFields(set.pdfBase);
  }
  
  return fields.map(f => ({
    pdfField: f.pdfField || `${set.pdfBase}.${f.pdfSuffix}`,
    fieldId: f.fieldId,
    label: f.label,
    itemIndex: f.itemIndex || 0,
    groupId: set.groupId,
    section: set.section,
    // Carbon Pass 2, M-5: the flags MUST survive expansion — the old
    // map dropped them, so dateMDY (set on residences_5yr from/to and
    // the date fields above) never reached the fill loop and ISO dates
    // were written raw into MM/DD/YYYY boxes; likewise `checkbox`
    // (sex boxes) never reached the fill loop's kind:'checkbox'.
    ...(f.dateMDY ? { dateMDY: true } : {}),
    ...(f.checkbox ? { checkbox: true } : {}),
  }));
}

/**
 * Get all repeating field mappings for I-589.
 */
export function getAllRepeatingMappings() {
  const all = [];
  for (const setId of Object.keys(REPEATING_SETS_589)) {
    all.push(...expandRepeatingSet(setId));
  }
  return all;
}
