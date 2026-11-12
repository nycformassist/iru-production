/**
 * api/_lib/repeating-fill.js — Repeating group PDF fill engine (Phase 3, 4c).
 *
 * Fills repeating PDF field sets from Phase 1 groups.js/persons.js data.
 *
 * Architecture:
 * - REPEATING_SETS define the PDF field layout for each repeating group
 * - buildRepeatingFillPlan(record, entry) generates fill entries
 * - Overflow items (beyond maxInline) are mapped to supplement fields
 * - The engine is config-driven: new groups need only a REPEATING_SET definition
 *
 * Data flow:
 *   record.groups[groupId].items[] → PDF fields (inline or supplement)
 *   record.persons[role][] → PDF fields (inline or supplement)
 */

import { REPEATING_SETS_589, expandRepeatingSet } from './forms/repeating-589.js';
import { TRANSFORMS } from './formmap.js';

/**
 * Build fill plan entries for repeating groups.
 *
 * @param {object} record - Sanitized fact record with groups and persons
 * @param {object} entry - Form registry entry
 * @returns {object} { fill: [], overflow: [], summary: {} }
 */
export function buildRepeatingFillPlan(record, entry) {
  const fill = [];
  const overflow = [];
  const summary = {
    groupsProcessed: 0,
    itemsInline: 0,
    itemsOverflow: 0,
    supplementsNeeded: new Set(),
  };

  if (entry.id !== 'I-589') {
    return { fill, overflow, summary };
  }

  // Process each repeating set
  // Supplement B overflow is aggregated across ALL groups first and
  // chunked once at the end (Carbon Pass 1 finding 9): the old code let
  // every overflowing group write its own chunks to TextField31[0],
  // overwriting the previous group, and wrote chunk 2 to the
  // nonexistent TextField31[2].
  const supplementBSections = [];
  for (const setId of Object.keys(REPEATING_SETS_589)) {
    const set = REPEATING_SETS_589[setId];
    const mappings = expandRepeatingSet(setId);

    // Get the data items for this group
    const items = getGroupItems(record, set.groupId);
    if (!items || items.length === 0) continue;

    summary.groupsProcessed++;

    // The supplement_b set IS the Supplement B continuation text the
    // user typed: fold it into the aggregated Supplement B text below
    // instead of writing it inline — the same three fields also carry
    // overflow, and whichever write came last used to win per field.
    if (setId === 'supplement_b') {
      for (const item of items) {
        const itemFields = item.fields || item.facts || {};
        for (const key of ['continuation_text_1', 'continuation_text_2', 'continuation_text_3']) {
          const v = itemFields[key];
          if (v && String(v).trim() !== '') supplementBSections.push(String(v).trim());
        }
      }
      continue;
    }
    // Split into inline and overflow
    const inlineItems = items.slice(0, set.maxInline);
    const overflowItems = items.slice(set.maxInline);
    
    summary.itemsInline += inlineItems.length;
    summary.itemsOverflow += overflowItems.length;
    
    // Fill inline items
    for (let itemIdx = 0; itemIdx < inlineItems.length; itemIdx++) {
      const item = inlineItems[itemIdx];
      const itemMappings = mappings.filter(m => (m.itemIndex || 0) === itemIdx);
      
      for (const mapping of itemMappings) {
        let value = item.fields?.[mapping.fieldId] ?? item.facts?.[mapping.fieldId];

        // Sex checkbox translation: 'sex' field value → sex_male/sex_female checkbox
        // The UI collects sex as 'Male'/'Female'; the PDF has separate checkboxes.
        if ((mapping.fieldId === 'sex_male' || mapping.fieldId === 'sex_female') && !value) {
          const sexValue = item.fields?.['sex'] ?? item.facts?.['sex'];
          if (sexValue) {
            const normalized = String(sexValue).toLowerCase().trim();
            if (mapping.fieldId === 'sex_male' && (normalized === 'male' || normalized === 'm')) {
              value = 'Yes'; // Checkbox checked value
            } else if (mapping.fieldId === 'sex_female' && (normalized === 'female' || normalized === 'f')) {
              value = 'Yes';
            }
          }
        }

        if (value !== null && value !== undefined && String(value).trim() !== '') {
          // M-5: date fields carry dateMDY:true from expandRepeatingSet
          // — format ISO YYYY-MM-DD to MM/DD/YYYY before pushing, so
          // USCIS date boxes never receive a raw ISO string.
          const outValue = mapping.dateMDY ? TRANSFORMS.dateMDY(value) : String(value);
          fill.push({
            pdfField: mapping.pdfField,
            value: outValue,
            label: mapping.label,
            source: 'repeating-group',
            groupId: set.groupId,
            itemIndex: itemIdx,
            ...(mapping.checkbox ? { kind: 'checkbox' } : {}),
          });
        }
      }
    }
    
    // Handle overflow
    if (overflowItems.length > 0 && set.overflowTo) {
      summary.supplementsNeeded.add(set.overflowTo);
      // Supplement B: collect this group's overflow text for the single
      // aggregated write after the loop — never write per-group chunks.
      if (set.overflowTo === 'supplement_b') {
        const text = formatOverflowText(set, overflowItems, set.maxInline);
        if (text) supplementBSections.push(text);
        continue;
      }
      // Supplement A has exactly 2 overflow slots (children 5-6).
      // Children 7+ have no Supplement A copy to land on — multi-PDF
      // merging is not implemented — so they go to the aggregated
      // Supplement B continuation text instead of emitting fake
      // #subform[12]_copyN field names (Carbon Pass 2, M-5).
      let overflowForMappings = overflowItems;
      if (set.overflowTo === 'supplement_a') {
        const extraItems = overflowItems.slice(2);
        if (extraItems.length > 0) {
          summary.supplementsNeeded.add('supplement_b');
          const text = formatOverflowText(set, extraItems, set.maxInline + 2);
          if (text) supplementBSections.push(text);
        }
        overflowForMappings = overflowItems.slice(0, 2);
      }
      const overflowMappings = getOverflowMappings(set, overflowForMappings.length, overflowForMappings);

      for (const mapping of overflowMappings) {
        // Supplement B mappings use pre-formatted _overflowText
        if (mapping._overflowText) {
          overflow.push({
            pdfField: mapping.pdfField,
            value: mapping._overflowText,
            label: mapping.label,
            source: 'repeating-group-overflow',
            groupId: set.groupId,
            itemIndex: mapping.itemIndex,
            supplement: set.overflowTo,
          });
          continue;
        }

        // Standard overflow: get value from item
        const item = overflowForMappings[mapping.itemIndex] || overflowForMappings[0];
        const value = item.fields?.[mapping.fieldId] ?? item.facts?.[mapping.fieldId];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          const outValue = mapping.dateMDY ? TRANSFORMS.dateMDY(value) : String(value);
          overflow.push({
            pdfField: mapping.pdfField,
            value: outValue,
            label: mapping.label,
            source: 'repeating-group-overflow',
            groupId: set.groupId,
            itemIndex: mapping.itemIndex,
            supplement: set.overflowTo,
          });
        }
      }
    }
  }

  // Supplement B, aggregated: user-entered continuation text first,
  // then every overflowing group's text, chunked once across the three
  // real Supplement B fields — TextField31[0], TextField31[1] and
  // TextField32[0] (verified with PyMuPDF; TextField31[2] does not
  // exist). One write per field, so no group overwrites another.
  if (supplementBSections.length > 0) {
    const fullText = supplementBSections.filter(Boolean).join('\n\n');
    const chunkFields = [
      'form1[0].#subform[13].TextField31[0]',
      'form1[0].#subform[13].TextField31[1]',
      'form1[0].#subform[13].TextField32[0]',
    ];
    const chunkSize = 1000;
    for (let i = 0; i < chunkFields.length; i++) {
      const chunk = fullText.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk) {
        overflow.push({
          pdfField: chunkFields[i],
          value: chunk,
          label: `Supplement B continuation (part ${i + 1})`,
          source: 'repeating-group-overflow',
          groupId: 'supplement_b',
          itemIndex: i,
          supplement: 'supplement_b',
        });
      }
    }
  }

  summary.supplementsNeeded = Array.from(summary.supplementsNeeded);
  return { fill, overflow, summary };
}

/**
 * Format overflow items of one group as structured Supplement B text.
 * `offset` is the number of inline items, so the item numbers match
 * the applicant's full list (e.g. residences #6, #7), not the overflow
 * slice.
 */
/**
 * Date-valued field ids in overflow text (M-5): ISO dates are
 * formatted to MM/DD/YYYY like inline date fields, so Supplement B
 * continuation text never shows a raw YYYY-MM-DD. TRANSFORMS.dateMDY
 * passes non-ISO values through unchanged.
 */
const OVERFLOW_DATE_KEYS = new Set([
  'date_of_birth', 'entry_date', 'from_date', 'to_date',
  'from_date_alt', 'to_date_alt', 'passport_expiry',
  'employment_auth_expiry',
]);

function formatOverflowText(set, items, offset = 0) {
  const overflowTexts = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fields = item.fields || item.facts || {};
    const fieldStrs = Object.entries(fields)
      .filter(([k, v]) => v && String(v).trim() !== '' && !k.startsWith('_'))
      .map(([k, v]) => {
        const out = (OVERFLOW_DATE_KEYS.has(k) || k.endsWith('_date'))
          ? TRANSFORMS.dateMDY(v) : v;
        return `${k}=${out}`;
      })
      .join(', ');
    if (fieldStrs) {
      overflowTexts.push(`${set.section} #${offset + i + 1}: ${fieldStrs}`);
    }
  }
  return overflowTexts.join('\n\n');
}

/**
 * Get items for a group from the record.
 */
function getGroupItems(record, groupId) {
  // Check groups
  if (record.groups?.[groupId]?.items) {
    return record.groups[groupId].items;
  }
  // Check persons (for child/spouse roles)
  if (groupId === 'children' && record.persons) {
    return Object.values(record.persons).filter(p => p.role === 'child');
  }
  if (groupId === 'spouse' && record.persons) {
    const spouse = Object.values(record.persons).find(p => p.role === 'spouse');
    return spouse ? [spouse] : [];
  }
  return [];
}

/**
 * Get overflow field mappings for a set.
 * For now, overflow uses Supplement B continuation fields.
 * Full Supplement A/B generation is in 4c-2.
 */
function getOverflowMappings(set, count, items = []) {
  const mappings = [];
  
  if (set.groupId === 'children' && set.overflowTo === 'supplement_a') {
    // Supplement A (#subform[12]): Child 5 and Child 6 (2 overflow slots)
    // FULL MAPPING: All 52 fields per the 07/28/26 form (16 core + 36 detail)
    // Detail fields mapped per form structure; see SUPPLEMENT_A_DISPOSITION.md
    for (let i = 0; i < Math.min(count, 2); i++) {
      const n = 5 + i;
      const base = 'form1[0].#subform[12]';
      const tfOffset = i === 0 ? 0 : 10;
      const dtIdx = i;
      
      // Core fields (16 mapped previously)
      mappings.push(
        { pdfField: `${base}.TextField12[${tfOffset}]`, fieldId: 'family_name', label: `SuppA Child ${n} last`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+1}]`, fieldId: 'given_name', label: `SuppA Child ${n} first`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+2}]`, fieldId: 'middle_name', label: `SuppA Child ${n} middle`, itemIndex: i },
        { pdfField: `${base}.DateTimeField14[${dtIdx}]`, fieldId: 'date_of_birth', label: `SuppA Child ${n} DOB`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+3}]`, fieldId: 'nationality', label: `SuppA Child ${n} nationality`, itemIndex: i },
        { pdfField: `${base}.ChildEntry${n}[0]`, fieldId: 'entry_place', label: `SuppA Child ${n} entry`, itemIndex: i },
        { pdfField: `${base}.ChildINum${n}[0]`, fieldId: 'i94_number', label: `SuppA Child ${n} I-94`, itemIndex: i },
        { pdfField: `${base}.ChildStatus${n}[0]`, fieldId: 'entry_status', label: `SuppA Child ${n} status`, itemIndex: i },
      );

      // Detail fields (36 total: 18 per child)
      // Text fields [4-9] follow inline pattern: race, city, passport, a-number, marital, extra
      mappings.push(
        { pdfField: `${base}.TextField12[${tfOffset+4}]`, fieldId: 'race', label: `SuppA Child ${n} race`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+5}]`, fieldId: 'birth_city', label: `SuppA Child ${n} birth city`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+6}]`, fieldId: 'passport_number', label: `SuppA Child ${n} passport`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+7}]`, fieldId: 'a_number', label: `SuppA Child ${n} A-number`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+8}]`, fieldId: 'marital_status', label: `SuppA Child ${n} marital`, itemIndex: i },
        { pdfField: `${base}.TextField12[${tfOffset+9}]`, fieldId: 'other_names', label: `SuppA Child ${n} other names`, itemIndex: i },
      );

      // Named detail fields
      mappings.push(
        { pdfField: `${base}.ChildExp${n}[0]`, fieldId: 'passport_expiry', label: `SuppA Child ${n} passport expiry`, itemIndex: i },
        { pdfField: `${base}.ChildCurrent${n}[0]`, fieldId: 'current_status', label: `SuppA Child ${n} current status`, itemIndex: i },
        { pdfField: `${base}.ChildExpAuth${n}[0]`, fieldId: 'employment_auth_expiry', label: `SuppA Child ${n} auth expiry`, itemIndex: i },
      );

      // Sex checkboxes (Child 5 only has them in the PDF; Child 6 does not)
      if (i === 0) {
        mappings.push(
          { pdfField: `${base}.CheckBox12_Sex[2]`, fieldId: 'sex_male', label: `SuppA Child 5 sex Male`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.CheckBox12_Sex[3]`, fieldId: 'sex_female', label: `SuppA Child 5 sex Female`, itemIndex: i, checkbox: true },
        );
      }

      // Status/attestation checkboxes (Yes/No pairs)
      // These correspond to per-child questions on Supplement A
      if (i === 0) {
        // Child 5 checkboxes
        mappings.push(
          { pdfField: `${base}.SuppA_CheckBox20[0]`, fieldId: 'suppa_q20_yes', label: `SuppA Child 5 Q20 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppA_CheckBox20[1]`, fieldId: 'suppa_q20_no', label: `SuppA Child 5 Q20 No`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppA_CheckBox21[0]`, fieldId: 'suppa_q21_yes', label: `SuppA Child 5 Q21 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppA_CheckBox21[1]`, fieldId: 'suppa_q21_no', label: `SuppA Child 5 Q21 No`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppLALine13_Specify[0]`, fieldId: 'suppa_line13_specify', label: `SuppA Child 5 line 13 specify`, itemIndex: i },
          { pdfField: `${base}.CheckBox57[0]`, fieldId: 'suppa_q57_yes', label: `SuppA Child 5 Q57 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.CheckBox57[1]`, fieldId: 'suppa_q57_no', label: `SuppA Child 5 Q57 No`, itemIndex: i, checkbox: true },
        );
      } else {
        // Child 6 checkboxes (different field names)
        mappings.push(
          { pdfField: `${base}.SuppAL12_CheckBox[0]`, fieldId: 'suppa_q12_yes', label: `SuppA Child 6 Q12 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppAL12_CheckBox[1]`, fieldId: 'suppa_q12_no', label: `SuppA Child 6 Q12 No`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppALine20_CheckBox2[0]`, fieldId: 'suppa_q20_yes', label: `SuppA Child 6 Q20 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppALine20_CheckBox2[1]`, fieldId: 'suppa_q20_no', label: `SuppA Child 6 Q20 No`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppALine21_CheckBox[0]`, fieldId: 'suppa_q21_yes', label: `SuppA Child 6 Q21 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppALine21_CheckBox[1]`, fieldId: 'suppa_q21_no', label: `SuppA Child 6 Q21 No`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppLALine13_Specify2[0]`, fieldId: 'suppa_line13_specify', label: `SuppA Child 6 line 13 specify`, itemIndex: i },
          { pdfField: `${base}.SuppAL13_CheckBox[0]`, fieldId: 'suppa_q13_yes', label: `SuppA Child 6 Q13 Yes`, itemIndex: i, checkbox: true },
          { pdfField: `${base}.SuppAL13_CheckBox[1]`, fieldId: 'suppa_q13_no', label: `SuppA Child 6 Q13 No`, itemIndex: i, checkbox: true },
        );
      }
    }

    // 7+ children: there is NO further Supplement A copy to map to.
    // Children 7+ are appended to the aggregated Supplement B
    // continuation text by buildRepeatingFillPlan (Carbon Pass 2,
    // M-5) — emitting fake `#subform[12]_copyN` field names only
    // produced fillErrors in generate-form.js and silently lost the
    // children's data. This function maps at most the 2 real
    // Supplement A slots (children 5-6).
  } else {
    // Supplement B overflow is NOT mapped per-group here anymore: the
    // old code wrote each group's chunks to TextField31[0..2]
    // (TextField31[2] does not exist) and each group overwrote the
    // last. buildRepeatingFillPlan aggregates all groups' overflow
    // text via formatOverflowText() and chunks it once across
    // TextField31[0], TextField31[1], TextField32[0]. Nothing to map.
  }
  return mappings;
}

/**
 * Check if a repeating set can be added via configuration.
 * Returns { configurable: boolean, reason: string }
 */
export function isSetConfigurable(setId) {
  const set = REPEATING_SETS_589[setId];
  if (!set) return { configurable: false, reason: 'Set not defined' };
  
  // Sets are configurable if they use standard group/person data
  // and have a regular field pattern
  const hasRegularPattern = set.fields.length > 0 || set.generateFields;
  const usesStandardGroups = ['entries', 'addresses', 'employment', 'education', 'children'].includes(set.groupId);
  
  if (hasRegularPattern && usesStandardGroups) {
    return { configurable: true, reason: 'Standard group with regular field pattern' };
  }
  
  return { configurable: false, reason: 'Requires custom logic' };
}
