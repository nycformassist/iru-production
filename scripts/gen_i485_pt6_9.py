"""Generate I-485 Parts 6-9 outputs from i485_pt6_9_questions.py.

Outputs:
  1. TS appendix -> printed to stdout (appended to i485-questions.ts by caller)
  2. i485_detailed_registry.json (merged, sorted)
  3. i485_checkbox_groups.json (new; value->short-field mappings)
  4. Verification: every mapped short exists in i485_fields.json;
     every question factId accounted for; no overlap with i485_yesno_pairs.json.
"""
import json, sys, re
sys.path.insert(0, '/home/hatch/workspace/iru-form-engine')
from i485_pt6_9_questions import QUESTIONS, TEXT_REGISTRY, CHECKBOX_GROUPS

FIELDS = json.load(open('/home/hatch/workspace/iru-form-engine/i485_fields.json'))
SHORTS = {f['short'] for f in FIELDS}
PAIRS = json.load(open('/home/hatch/workspace/iru-form-engine/i485_yesno_pairs.json'))
PAIR_SHORTS = set()
for p in PAIRS:
    for k in ('yes_field', 'no_field'):
        PAIR_SHORTS.add(p[k].split('.')[-1])

# ---- Verification -------------------------------------------------
errors = []
qids = [q[0] for q in QUESTIONS]
assert len(qids) == len(set(qids)), "duplicate question ids"
for fid, short in TEXT_REGISTRY.items():
    if short not in SHORTS:
        errors.append(f"registry {fid} -> {short} NOT IN FIELDS")
    if short in PAIR_SHORTS:
        errors.append(f"registry {fid} -> {short} OVERLAPS SIBLING PAIR")
for fid, mapping in CHECKBOX_GROUPS.items():
    for val, short in mapping.items():
        if short not in SHORTS:
            errors.append(f"checkbox {fid}:{val} -> {short} NOT IN FIELDS")
        if short in PAIR_SHORTS:
            errors.append(f"checkbox {fid}:{val} -> {short} OVERLAPS SIBLING PAIR")
# every question with options must have a checkbox mapping with matching values
for qid, step, short_label, label, qtype, options in QUESTIONS:
    if options:
        vals = {v for v, _ in options}
        if qid not in CHECKBOX_GROUPS:
            errors.append(f"question {qid} has options but no checkbox mapping")
        elif set(CHECKBOX_GROUPS[qid].keys()) != vals:
            errors.append(f"question {qid} options != checkbox mapping keys: {vals} vs {set(CHECKBOX_GROUPS[qid].keys())}")
    else:
        if qid not in TEXT_REGISTRY:
            errors.append(f"question {qid} has no options but no text registry entry")
        if qid in CHECKBOX_GROUPS:
            errors.append(f"question {qid} has no options but has checkbox mapping")
# every text registry entry must correspond to a question
for fid in TEXT_REGISTRY:
    if fid not in qids:
        errors.append(f"registry {fid} has no question")
for fid in CHECKBOX_GROUPS:
    if fid not in qids:
        errors.append(f"checkbox group {fid} has no question")

if errors:
    print("ERRORS:")
    for e in errors:
        print("  ", e)
    sys.exit(1)
print(f"VERIFIED: {len(QUESTIONS)} questions, {len(TEXT_REGISTRY)} text mappings, "
      f"{sum(len(m) for m in CHECKBOX_GROUPS.values())} checkbox mappings, 0 errors")

# ---- TS generation ------------------------------------------------
def esc(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')

lines = []
lines.append("")
lines.append("  // ── Parts 6-9 expansion (2026-11-04): marital history, children,")
lines.append("  // biographic, admissibility follow-ups, organizations, public charge.")
lines.append("  // Non-pair Pt6/Pt7/Pt8/Pt9 fields only; 84 Yes/No pairs excluded.")
lines.append("  // Pt6/Pt7/Pt8/Pt9 contain NO declaration/signature/interpreter/preparer")
lines.append("  // fields (those live under Pt3/Pt11/Pt12/P12/Pt13 prefixes, out of scope).")

STEP_HEADERS = {
    "marital": "Step 7: Marital history (Part 6)",
    "children": "Step 8: Children (Part 7)",
    "biographic": "Step 9: Biographic information (Part 8)",
    "admissibility": "Step 6 (continued): Admissibility follow-ups (Part 9)",
    "organizations": "Step 10: Organization membership (Part 9)",
    "public_charge": "Step 11: Public charge (Part 9)",
}
seen_steps = set()
for qid, step, short_label, label, qtype, options in QUESTIONS:
    if step not in seen_steps:
        seen_steps.add(step)
        lines.append("")
        lines.append(f"  // ── {STEP_HEADERS[step]} ─────────────────────────────")
    lines.append("  {")
    lines.append(f'    id: "{qid}",')
    lines.append(f'    shortLabel: "{esc(short_label)}",')
    lines.append(f'    step: "{step}",')
    lines.append(f'    type: "{qtype}",')
    lines.append(f'    factId: "{qid}",')
    if options:
        lines.append("    options: [")
        for v, lab in options:
            lines.append(f'      {{ value: "{v}", labels: {{ EN: "{esc(lab)}" }} }},')
        lines.append("    ],")
    lines.append(f'    labels: {{ EN: "{esc(label)}" }},')
    lines.append("    required: false,")
    lines.append("  },")

print("\n".join(lines))

# ---- Registry merge ------------------------------------------------
reg = json.load(open('/home/hatch/workspace/iru-form-engine/i485_detailed_registry.json'))
before = len(reg)
for fid, short in TEXT_REGISTRY.items():
    if fid in reg and reg[fid] != short:
        print(f"CONFLICT: {fid} existing {reg[fid]} vs new {short}")
        sys.exit(1)
    reg[fid] = short
reg = dict(sorted(reg.items()))
json.dump(reg, open('/home/hatch/workspace/iru-form-engine/i485_detailed_registry.json', 'w'), indent=2)
print(f"\nREGISTRY: {before} -> {len(reg)} entries (+{len(reg)-before})")

# ---- Checkbox groups file ------------------------------------------
groups = []
for fid, mapping in CHECKBOX_GROUPS.items():
    groups.append({"fact": fid, "mapping": mapping})
json.dump(groups, open('/home/hatch/workspace/iru-form-engine/i485_checkbox_groups.json', 'w'), indent=2)
print(f"CHECKBOX GROUPS: {len(groups)} groups written to i485_checkbox_groups.json")
