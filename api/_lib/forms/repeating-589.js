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
 *
 * ONE SOURCE OF TRUTH (Item C, 2026-11-12): this file is the live
 * filler for Part A.III (and Item 19.C entry history) in the JS draft
 * path (api/generate-form.js). The field LAYOUT it encodes is taken
 * from api/_python/i589_detailed_registry.json, whose 92 i589_bg_*
 * entries were verified correct against the 07/28/26 template with
 * PyMuPDF (widget-rect proximity to the printed table headers); the
 * Python binder no longer iterates those entries, so there is exactly
 * one live mechanism per field. Earlier versions of this file assumed
 * contiguous 4-slot strides and were WRONG for the interleaved first
 * two rows of Q1/Q2/Q3 and for the entry-history dates — see the
 * CORRECTED notes on the sets below. A "35/35 fields filled" check
 * only proves values landed in the NAMED fields, not that the named
 * fields are the right boxes; the rect verification is what grounds
 * the layout.
 */

export const REPEATING_SETS_589 = {
  // Part A.I Item 19.C — Entry history (9 fields: 3 entries × 3 fields)
  // CORRECTED 2026-11-12: the entry table is 3 rows (y606/624/642) whose
  // DATE boxes are DateTimeField2[0] / DateTimeField3[0] /
  // DateTimeField4[0] — one per row. The old mapping used
  // DateTimeField3[0..2], which put entry 1's date in row 2's box and
  // entries 2-3 in fields that DO NOT EXIST in the template
  // (DateTimeField3[1]/[2] are absent → fillErrors in generate-form.js).
  // Verified by widget rects; matches i589_detailed_registry.json
  // i589_entry_date / i589_entry2_date / i589_entry3_date.
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
      { pdfSuffix: 'DateTimeField2[0]', fieldId: 'entry_date', label: 'Entry 1 date', dateMDY: true },
      // Entry 2
      { pdfSuffix: 'TextField4[2]', fieldId: 'entry_place', label: 'Entry 2 place', itemIndex: 1 },
      { pdfSuffix: 'TextField4[3]', fieldId: 'entry_status', label: 'Entry 2 status', itemIndex: 1 },
      { pdfSuffix: 'DateTimeField3[0]', fieldId: 'entry_date', label: 'Entry 2 date', itemIndex: 1, dateMDY: true },
      // Entry 3
      { pdfSuffix: 'TextField4[4]', fieldId: 'entry_place', label: 'Entry 3 place', itemIndex: 2 },
      { pdfSuffix: 'TextField4[5]', fieldId: 'entry_status', label: 'Entry 3 status', itemIndex: 2 },
      { pdfSuffix: 'DateTimeField4[0]', fieldId: 'entry_date', label: 'Entry 3 date', itemIndex: 2, dateMDY: true },
    ],
  },

  // Part A.III Q1 — Last address (2 rows × 6 fields in #subform[4]).
  // CORRECTED 2026-11-12: the table is TWO rows — "your last address"
  // plus "the last address in the country where you fear persecution".
  // Row 1 = TextField13[0,2,4,6] + From DateTimeField21[0] / To
  // DateTimeField20[0]; row 2 = TextField13[1,3,5,7] + From
  // DateTimeField22[0] / To DateTimeField23[0]. The old mapping read
  // [0..7] as 8 fields of ONE address (street/city/region/country/
  // postal/line2/district/notes) and wrote the city into row 2's street
  // box, the region into row 1's city box, and so on; its 4 date slots
  // likewise mixed the two rows' From/To. postal_code, address_line_2,
  // district, address_notes and from/to_date_alt have NO box in this
  // table. Verified by widget rects vs the printed column headers;
  // matches i589_detailed_registry.json i589_bg_addr1/addr2.
  // maxInline is 2 so a second last address fills row 2.
  last_address: {
    groupId: 'last_address',
    section: 'Part A.III Q1',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 2,
    overflowTo: null,
    fields: [
      // Row 1
      { pdfSuffix: 'TextField13[0]', fieldId: 'street', label: 'Last address street' },
      { pdfSuffix: 'TextField13[2]', fieldId: 'city', label: 'Last address city' },
      { pdfSuffix: 'TextField13[4]', fieldId: 'region', label: 'Last address state/province' },
      { pdfSuffix: 'TextField13[6]', fieldId: 'country', label: 'Last address country' },
      { pdfSuffix: 'DateTimeField21[0]', fieldId: 'from_date', label: 'Last address from date', dateMDY: true },
      { pdfSuffix: 'DateTimeField20[0]', fieldId: 'to_date', label: 'Last address to date', dateMDY: true },
      // Row 2
      { pdfSuffix: 'TextField13[1]', fieldId: 'street', label: 'Last address 2 street', itemIndex: 1 },
      { pdfSuffix: 'TextField13[3]', fieldId: 'city', label: 'Last address 2 city', itemIndex: 1 },
      { pdfSuffix: 'TextField13[5]', fieldId: 'region', label: 'Last address 2 state/province', itemIndex: 1 },
      { pdfSuffix: 'TextField13[7]', fieldId: 'country', label: 'Last address 2 country', itemIndex: 1 },
      { pdfSuffix: 'DateTimeField22[0]', fieldId: 'from_date', label: 'Last address 2 from date', itemIndex: 1, dateMDY: true },
      { pdfSuffix: 'DateTimeField23[0]', fieldId: 'to_date', label: 'Last address 2 to date', itemIndex: 1, dateMDY: true },
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
      // CORRECTED 2026-11-12: rows 1-2 INTERLEAVE (residence 1 =
      // TextField13[8,10,12,14], residence 2 = [9,11,13,15]); rows 3-5
      // are contiguous ([16..19], [20..23], [24..27]). The old [8+4i]
      // stride wrote residence 1's city into residence 2's street box,
      // residence 1's region into residence 1's city box, and so on.
      // Date pairs are likewise interleaved for rows 1-2 (from DT24 /
      // to DT26, from DT25 / to DT27) and contiguous after (DT28/29,
      // DT30/31, DT32/33). Verified by widget rects; matches
      // i589_detailed_registry.json i589_bg_res1..res5.
      const textSlots = [
        [8, 10, 12, 14],   // residence 1
        [9, 11, 13, 15],   // residence 2
        [16, 17, 18, 19],  // residence 3
        [20, 21, 22, 23],  // residence 4
        [24, 25, 26, 27],  // residence 5
      ];
      const dateSlots = [
        [24, 26], [25, 27], [28, 29], [30, 31], [32, 33],
      ];
      for (let i = 0; i < 5; i++) {
        const [s, c, r, co] = textSlots[i];
        fields.push(
          { pdfSuffix: `TextField13[${s}]`, fieldId: 'street', label: `Residence ${i+1} street`, itemIndex: i },
          { pdfSuffix: `TextField13[${c}]`, fieldId: 'city', label: `Residence ${i+1} city`, itemIndex: i },
          { pdfSuffix: `TextField13[${r}]`, fieldId: 'region', label: `Residence ${i+1} state`, itemIndex: i },
          { pdfSuffix: `TextField13[${co}]`, fieldId: 'country', label: `Residence ${i+1} country`, itemIndex: i },
          { pdfSuffix: `DateTimeField${dateSlots[i][0]}[0]`, fieldId: 'from_date', label: `Residence ${i+1} from`, itemIndex: i, dateMDY: true },
          { pdfSuffix: `DateTimeField${dateSlots[i][1]}[0]`, fieldId: 'to_date', label: `Residence ${i+1} to`, itemIndex: i, dateMDY: true },
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
  // CORRECTED 2026-11-12: FOUR schools × 3 columns (Name of School /
  // Type of School / Location), NOT "two schools x 6 slots". Rows 1-2
  // interleave (school 1 = [28,30,32], school 2 = [29,31,33]); rows 3-4
  // are contiguous (school 3 = [34,35,36], school 4 = [37,38,39]).
  // From/To dates exist per row and were never mapped: school 1 From
  // DT41 / To DT40, school 2 From DT38 / To DT39, school 3 From DT37 /
  // To DT36, school 4 From DT34 / To DT35. The old slots wrote school
  // 1's degree into school 2's name box. degree / school_country have
  // no box on the form. Verified by widget rects; matches
  // i589_detailed_registry.json i589_bg_edu1..edu4. maxInline is 4;
  // a 5th school goes to Supplement B overflow text.
  education: {
    groupId: 'education',
    section: 'Part A.III Q3 Education',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 4,
    overflowTo: 'supplement_b',
    generateFields: (base) => {
      const fields = [];
      // Per school: [name, type, location, from, to].
      const nameSlots = [28, 29, 34, 37];
      const typeSlots = [30, 31, 35, 38];
      const locSlots = [32, 33, 36, 39];
      const dateSlots = [[41, 40], [38, 39], [37, 36], [34, 35]];
      for (let i = 0; i < 4; i++) {
        fields.push(
          { pdfSuffix: `TextField13[${nameSlots[i]}]`, fieldId: 'school_name', label: `School ${i+1} name`, itemIndex: i },
          { pdfSuffix: `TextField13[${typeSlots[i]}]`, fieldId: 'field_of_study', label: `School ${i+1} type`, itemIndex: i },
          { pdfSuffix: `TextField13[${locSlots[i]}]`, fieldId: 'school_city', label: `School ${i+1} location`, itemIndex: i },
          { pdfSuffix: `DateTimeField${dateSlots[i][0]}[0]`, fieldId: 'from_date', label: `School ${i+1} from`, itemIndex: i, dateMDY: true },
          { pdfSuffix: `DateTimeField${dateSlots[i][1]}[0]`, fieldId: 'to_date', label: `School ${i+1} to`, itemIndex: i, dateMDY: true },
        );
      }
      return fields;
    },
  },

  // Part A.III Q4 — Employment (6 fields in #subform[4])
  // CORRECTED 2026-11-12: THREE employer rows (NOT employer 1 spanning
  // two lines). Employer 1 = name [40] + occupation [42] + From DT42 /
  // To DT44; employer 2 = [41] + [43] + From DT43 / To DT45; employer 3
  // = [44] + [45] + From DT46 / To DT47. The old mapping wrote employer
  // 1's city into employer 2's name box and never mapped the From/To
  // dates. employer_city / employer_country have no separate box
  // ("Name and Address of Employer" is one column). Verified by widget
  // rects; matches i589_detailed_registry.json i589_bg_emp1..emp3.
  // maxInline is 3; a 4th employer goes to Supplement B overflow text.
  employment: {
    groupId: 'employment',
    section: 'Part A.III Q4 Employment',
    pdfBase: 'form1[0].#subform[4]',
    maxInline: 3,
    overflowTo: 'supplement_b',
    generateFields: (base) => {
      const fields = [];
      // Per employer: [name, occupation, from, to].
      const nameSlots = [40, 41, 44];
      const occSlots = [42, 43, 45];
      const dateSlots = [[42, 44], [43, 45], [46, 47]];
      for (let i = 0; i < 3; i++) {
        fields.push(
          { pdfSuffix: `TextField13[${nameSlots[i]}]`, fieldId: 'employer_name', label: `Employer ${i+1} name`, itemIndex: i },
          { pdfSuffix: `TextField13[${occSlots[i]}]`, fieldId: 'occupation', label: `Employer ${i+1} occupation`, itemIndex: i },
          { pdfSuffix: `DateTimeField${dateSlots[i][0]}[0]`, fieldId: 'from_date', label: `Employer ${i+1} from`, itemIndex: i, dateMDY: true },
          { pdfSuffix: `DateTimeField${dateSlots[i][1]}[0]`, fieldId: 'to_date', label: `Employer ${i+1} to`, itemIndex: i, dateMDY: true },
        );
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
  // relationship / country have no inline PDF slot here: the row label
  // IS the relationship, and the birth column (TextField13[49,50,51,
  // 53,55,57] — mapped in i589_detailed_registry.json as i589_bg_*_
  // birth) is NOT collected by the UI (group items carry no birth
  // field), so it stays unfilled from this path rather than guessed
  // from an ambiguous 'country' value. Unmapped item fields travel in
  // the Supplement B overflow text.
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
