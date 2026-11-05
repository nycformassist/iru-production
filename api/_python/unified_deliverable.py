"""
Phase 7: Unified consumer experience.
Generates the three deliverables as one coherent package:
1. Completed government application draft (PDF)
2. Review document (missing/conflicting/uncertain, fields needing attention)
3. Consolidated master readiness report (across workflows)

The consumer reviews, corrects, downloads, and decides next steps.
Declarations/signatures/certifications remain with the consumer.
"""
from datetime import datetime, timezone

def generate_review_document(form_key, fill_plan, review_queue, facts, output_path):
    """Generate the human-readable review document."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with open(output_path, "w") as f:
        f.write(f"# {form_key.upper()} — Preparation Review\n")
        f.write(f"Generated: {now}\n\n")

        f.write(f"## Summary\n")
        f.write(f"- Fields completed: {len(fill_plan)}\n")
        f.write(f"- Items needing your attention: {len(review_queue)}\n\n")

        f.write("## Completed from your information\n")
        f.write("The following were filled from confirmed information you provided.\n")
        f.write("Please verify each is correct.\n\n")
        for field, value, kind, fid in sorted(fill_plan, key=lambda x: x[3]):
            fact = facts.get(fid, {})
            conf = fact.get("confidence", 0)
            src = fact.get("source", "unknown")
            inh = " (inherited)" if "inherited_from" in fact else ""
            f.write(f"- **{fid}** = {value} (confidence {conf:.0%}, {src}{inh})\n")

        if review_queue:
            f.write("\n## Needs your attention\n")
            f.write("These were NOT filled. Please review and provide or correct.\n\n")
            for r in review_queue:
                f.write(f"### {r['fact']}\n")
                f.write(f"**Issue:** {r['reason']}\n\n{r['detail']}\n\n")

        f.write("\n## Next steps\n")
        f.write("1. Review the completed draft PDF alongside this document.\n")
        f.write("2. Correct any information above that needs attention.\n")
        f.write("3. Sign and date the form where indicated (your signature is required).\n")
        f.write("4. Decide: file independently, or bring these documents to an ")
        f.write("attorney or community legal resource for review.\n")
        f.write("\n*IRU prepares information. It does not provide legal advice or ")
        f.write("make legal determinations.*\n")
    return output_path


def generate_master_report(workflows, output_path):
    """Consolidated readiness report across selected workflows."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with open(output_path, "w") as f:
        f.write("# IRU Consolidated Readiness Report\n")
        f.write(f"Generated: {now}\n\n")
        f.write(f"Workflows prepared: {len(workflows)}\n\n")
        for wf in workflows:
            f.write(f"## {wf['form_key'].upper()}\n")
            f.write(f"- Fields completed: {wf['filled']}\n")
            f.write(f"- Review items: {wf['review_count']}\n")
            f.write(f"- Readiness: {wf.get('readiness', 'See workflow report')}\n\n")
        f.write("## Important\n")
        f.write("Review each form's preparation review document. Your signature ")
        f.write("is required on each application. Consider having an attorney or ")
        f.write("accredited representative review before filing.\n")
    return output_path
