"""
Cross-workflow identity and fact reuse — Phase 3.

Core principle: facts belong to PEOPLE, not workflows. A workflow collects
facts about a person; identity linking lets a new workflow inherit them —
but ONLY after explicit confirmation that it's the same human.

Model:
- Person: {person_id, display_name, facts: {fact_id: Tier1Fact}, created, workflows: [...]}
- IdentityLink: {from_person, to_person, confirmed_at, confirmed_by, method}
- Role: consumer | petitioner | beneficiary | spouse | child | parent
  (distinguishes WHO the facts describe within a multi-person application)

Rules:
- NEVER inherit without explicit identity confirmation.
- NEVER transfer one person's facts to another person's record.
- Facts carry provenance across the link (source, confidence, corrections, timestamps).
- Stale facts (older than freshness window) trigger re-confirmation, not silent reuse.
- The consumer is always a distinct person record from petitioner/beneficiary
  unless explicitly confirmed as the same.
"""

from datetime import datetime, timezone, timedelta

FRESHNESS_DAYS = 180  # facts older than this need re-confirmation

def now_iso():
    return datetime.now(timezone.utc).isoformat()

class PersonRecord:
    def __init__(self, person_id, display_name):
        self.person_id = person_id
        self.display_name = display_name
        self.facts = {}           # fact_id -> Tier1Fact dict
        self.workflows = []       # workflow keys this person appeared in
        self.roles = {}           # workflow_key -> role
        self.created = now_iso()

    def add_fact(self, fact):
        self.facts[fact["id"]] = fact

    def get_fact(self, fact_id):
        return self.facts.get(fact_id)


class IdentityStore:
    """Holds person records and confirmed identity links."""
    def __init__(self):
        self.people = {}   # person_id -> PersonRecord
        self.links = []    # list of {person_a, person_b, confirmed_at, method}

    def add_person(self, person):
        self.people[person.person_id] = person

    def confirm_identity(self, person_a_id, person_b_id, method="consumer-confirmed"):
        """Explicitly link two person records as the same human."""
        if person_a_id == person_b_id:
            return {"ok": False, "reason": "same record"}
        a, b = self.people.get(person_a_id), self.people.get(person_b_id)
        if not a or not b:
            return {"ok": False, "reason": "person not found"}
        # SAFEGUARD: name mismatch blocks accidental cross-person linking
        # (e.g., Maria Santos vs Carlos Santos must never auto-link)
        if a.display_name and b.display_name:
            na = a.display_name.lower().strip()
            nb = b.display_name.lower().strip()
            if na != nb and na not in nb and nb not in na:
                if method != "consumer-confirmed-different-names":
                    return {"ok": False, "reason": "name-mismatch",
                            "detail": f"'{a.display_name}' vs '{b.display_name}'. "
                            "These appear to be different people."}
        # Check not already linked
        for l in self.links:
            if {l["person_a"], l["person_b"]} == {person_a_id, person_b_id}:
                return {"ok": True, "already_linked": True}
        self.links.append({
            "person_a": person_a_id, "person_b": person_b_id,
            "confirmed_at": now_iso(), "method": method,
        })
        return {"ok": True, "linked": (person_a_id, person_b_id)}

    def is_same_person(self, person_a_id, person_b_id):
        if person_a_id == person_b_id:
            return True
        return any({l["person_a"], l["person_b"]} == {person_a_id, person_b_id}
                   for l in self.links)

    def inherit_facts(self, from_id, to_id, fact_ids=None, freshness_check=True):
        """Copy facts from one person to another — ONLY if identity confirmed.
        Preserves full provenance. Flags stale facts for re-confirmation.
        Returns (inherited, needs_reconfirm, blocked)."""
        if not self.is_same_person(from_id, to_id):
            return [], [], [{"reason": "identity-not-confirmed",
                             "detail": f"No confirmed identity link between {from_id} and {to_id}. "
                                       "Facts cannot be transferred."}]
        src = self.people[from_id]
        inherited, reconfirm = [], []
        wanted = fact_ids or list(src.facts.keys())
        for fid in wanted:
            fact = src.facts.get(fid)
            if not fact:
                continue
            # Provenance-preserving copy with inheritance trail
            inherited_fact = dict(fact)
            inherited_fact["inherited_from"] = from_id
            inherited_fact["inherited_at"] = now_iso()
            # Freshness: stale facts need consumer re-confirmation, not silent reuse
            if freshness_check and fact.get("updatedAt"):
                try:
                    updated = datetime.fromisoformat(fact["updatedAt"])
                    age = datetime.now(timezone.utc) - updated
                    if age > timedelta(days=FRESHNESS_DAYS):
                        reconfirm.append({
                            "fact": fid, "reason": "stale",
                            "detail": f"Fact is {age.days} days old (threshold {FRESHNESS_DAYS}). "
                                      "Ask consumer to confirm it's still accurate.",
                            "fact_copy": inherited_fact,
                        })
                        continue
                except (ValueError, TypeError):
                    pass
            inherited.append(inherited_fact)
        return inherited, reconfirm, []
