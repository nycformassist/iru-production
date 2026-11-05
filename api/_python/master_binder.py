"""
Master binder: combines all I-130 registries into a unified fill plan.
Integrates: AUTO + Address + Biographic + Detail groups.
"""
import sys
# bundled: _python is on sys.path via api/ directory

from _python.i130_full_registry import AUTO_REGISTRY
from _python.address import address_to_fill_plan, I130_ADDRESS_BLOCKS, PT4LINE12_VARIANT
from _python.address_history import bind_addresses
from _python.biographic import bind_biographic
from _python.binder import bind as bind_auto

def build_master_plan(auto_facts, address_facts, bio_facts, detail_facts=None):
    """Build complete fill plan from all fact sources.
    Returns (fill_plan, review_queue, coverage_stats)."""
    all_plan, all_review = [], []
    all_review_stats = {}

    # 1. AUTO facts (existing questionnaire)
    plan, review = bind_auto(AUTO_REGISTRY, auto_facts)
    all_plan.extend(plan); all_review.extend(review)
    all_review_stats = {"auto": (len(plan), len(review))}

    # 2. Addresses (with history + gating)
    addr_blocks = [("addr_current", "petitioner_physical_1")]
    # Add mailing if present
    if any(f["id"] == "addr_mailing" for f in address_facts):
        addr_blocks.append(("addr_mailing", "petitioner_mailing"))
    plan, review = bind_addresses(address_facts, addr_blocks)
    all_plan.extend(plan); all_review.extend(review)
    all_review_stats["address"] = (len(plan), len(review))

    # 3. Biographic
    plan, review = bind_biographic(bio_facts)
    all_plan.extend(plan); all_review.extend(review)
    all_review_stats["biographic"] = (len(plan), len(review))

    return all_plan, all_review, all_review_stats
