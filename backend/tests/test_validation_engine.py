"""
Ported from the manual test cases in INSPECKT_APP_BUILD_SPECIFICATION.md
("Testing Guidelines"), with composition figures corrected to match the
Dairy Bible Master's regulation tables (the build spec's Buffalo Milk
minimum of 6.0% fat, for example, doesn't match FSS 2.1.2, which sets
5.0% — see README "Regulatory notes" for the full list of corrections).
"""
from app.validation_engine import validate_submission

# "ingredients", "mrp", "instructions_for_use", "consumer_care" added per
# review item B8 — five label elements the checklist used to skip
# entirely. ALL_NON_MILK_LABELS also picks up "veg_non_veg_logo" (milk is
# exempt per the Bible; paneer/cheese are not).
ALL_MILK_LABELS = {
    "product_name": True, "manufacturer_name": True, "fssai_license_number": True,
    "ingredients": True, "net_quantity": True, "mrp": True, "batch_number": True,
    "mfg_date": True, "expiry_date": True, "allergen_milk": True, "nutrition_panel": True,
    "instructions_for_use": True, "consumer_care": True, "milk_class": True, "heat_treatment_declared": True,
}
ALL_NON_MILK_LABELS = {
    **{k: v for k, v in ALL_MILK_LABELS.items() if k not in ("milk_class", "heat_treatment_declared")},
    "veg_non_veg_logo": True,
}


def test_buffalo_milk_pass():
    result = validate_submission("milk", {
        "milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1, "heat_treatment": "pasteurised",
        # Milk's real Table 2A/2B panel (MICRO_LIMITS["milk"], matching
        # frontend/js/data/dairyBible.js exactly) is just apc + coliform
        # (2A) and salmonella + listeria (2B) — no e_coli/staph_aureus/
        # enterobacteriaceae keys exist for milk. A stale, never-applied
        # "rename to enterobacteriaceae" note used to live here; corrected
        # so this fixture matches what the engine actually checks today.
        "lab": {"apc": 25000, "coliform": 2, "salmonella": False, "listeria": False},
        "label": ALL_MILK_LABELS,
    })
    assert result["overall_status"] == "PASS"
    assert result["shelf_life"] == {"days": 3, "storage_temp": "2-6°C", "note": None}
    assert result["violations"] == []


def test_buffalo_milk_fail_low_fat():
    result = validate_submission("milk", {
        "milk_type": "buffalo_milk", "fat": 4.5, "snf": 9.1, "heat_treatment": "pasteurised",
        "lab": {"apc": 25000, "enterobacteriaceae": 2, "e_coli": 2, "staph_aureus": 5, "salmonella": False, "listeria": False},
        "label": ALL_MILK_LABELS,
    })
    assert result["overall_status"] == "FAIL"
    assert result["composition"]["status"] == "FAIL"
    assert any("Milk Fat" in v["message"] for v in result["violations"])


def test_standard_paneer_pass():
    result = validate_submission("paneer", {
        "paneer_type": "paneer_standard", "moisture": 58, "fat": 52,
        # Paneer's real Table 2A panel (MICRO_LIMITS["paneer"], matching
        # the frontend exactly) is apc/coliform/staph_aureus/yeast_mould/
        # e_coli — "yeast_mould" IS a real organism here (m:50/M:150); a
        # stale note claiming it had been removed used to leave it out of
        # this fixture, which meant every "pass" scenario silently showed
        # yeast_mould as MISSING (capping the result at WARNING, never
        # PASS — see _aggregate_status()'s cross-engine-parity comment).
        # Value chosen well under the m:50 threshold.
        "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 10, "e_coli": 2,
                "salmonella": False, "listeria": False},
        "label": ALL_NON_MILK_LABELS,
    })
    assert result["overall_status"] == "PASS"
    assert result["shelf_life"]["days"] == 7


def test_cheddar_cheese_pass_long_shelf_life():
    result = validate_submission("cheese", {
        "cheese_type": "cheddar", "moisture": 35, "fat": 50,
        # Cheese's real Table 2A panel (MICRO_LIMITS["cheese"], matching
        # the frontend exactly) is coliform (m:100/M:500) / staph_aureus /
        # yeast_mould (m:100/M:500) / e_coli — there's no "apc" entry for
        # cheese at all, and "yeast_mould" IS a real organism here; a
        # stale note claiming otherwise used to leave it out of this
        # fixture, capping the result at WARNING instead of PASS. Dropped
        # the non-existent "apc" key and added a compliant yeast_mould
        # value (well under m:100).
        "lab": {"coliform": 5, "staph_aureus": 5, "yeast_mould": 20, "e_coli": 2,
                "salmonella": False, "listeria": False},
        "label": ALL_NON_MILK_LABELS,
    })
    assert result["overall_status"] == "PASS"
    assert result["shelf_life"]["days"] == 180


def test_microbiological_fail_apc_rejection_limit():
    result = validate_submission("milk", {
        "milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1, "heat_treatment": "pasteurised",
        # 600000 is above the corrected milk APC rejection limit
        # (M:500000, per A11 — the old M:50000 was roughly 10x too
        # strict).
        "lab": {"apc": 600000, "enterobacteriaceae": 2, "e_coli": 2, "staph_aureus": 5, "salmonella": False, "listeria": False},
        "label": ALL_MILK_LABELS,
    })
    assert result["overall_status"] == "FAIL"
    assert result["microbiological"]["status"] == "FAIL"
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "FAIL"
    assert apc_check["severity"] == "CRITICAL"  # exceeded M, the rejection limit


def test_microbiological_warning_between_m_and_M():
    result = validate_submission("milk", {
        "milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1, "heat_treatment": "pasteurised",
        # 40000 is between milk's real APC limits per Appendix B1's
        # Table 2A, Sr.1: m=30000, M=50000.
        "lab": {"apc": 40000, "salmonella": False, "listeria": False},
        "label": ALL_MILK_LABELS,
    })
    assert result["overall_status"] == "WARNING"
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "WARNING"


def test_labelling_fail_missing_product_name():
    # Renamed in spirit from "fail" to reflect the cross-engine-parity fix
    # in _aggregate_status()/_section_status() (see their own comments):
    # MISSING — including a CRITICAL label element not yet declared —
    # caps a section/overall result at WARNING, never FAIL, because
    # "not done yet" and "tested and non-compliant" are deliberately
    # different verdicts (matches validation.js's aggregateStatus()
    # exactly). A truly not-yet-finalized label is real outstanding work,
    # which is exactly what WARNING (not a silent PASS) surfaces.
    labels = dict(ALL_NON_MILK_LABELS)
    labels["product_name"] = False
    result = validate_submission("paneer", {
        "paneer_type": "paneer_standard", "moisture": 58, "fat": 52,
        "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 10, "e_coli": 2,
                "salmonella": False, "listeria": False},
        "label": labels,
    })
    assert result["overall_status"] == "WARNING"
    assert result["labelling"]["status"] == "WARNING"
    assert any("Product Name" in v["message"] for v in result["violations"])


def test_missing_critical_field_forces_fail_not_silent_pass():
    """A submission with no lab data at all must not read as PASS —
    untested Salmonella/Listeria is a critical gap, not a clean bill
    of health (Dairy Bible Chapter 12, escalation matrix). Per the
    cross-engine-parity fix in _aggregate_status() (matching
    validation.js's aggregateStatus() exactly), an untested/MISSING
    field — even CRITICAL — reads as WARNING, not FAIL: FAIL is reserved
    for something actually tested and found non-compliant. WARNING still
    satisfies this test's real intent: it is never a silent PASS."""
    result = validate_submission("milk", {
        # CORRECTED: Cow Milk is one flat All-India standard (min fat
        # 3.2%, min SNF 8.3%) per the primary text — no state groups.
        # 4.0%/8.5% still comfortably satisfies that flat minimum.
        "milk_type": "cow_milk", "fat": 4.0, "snf": 8.5, "heat_treatment": "pasteurised",
        "lab": {}, "label": ALL_MILK_LABELS,
    })
    assert result["overall_status"] == "WARNING"
    assert result["overall_status"] != "PASS"


# ---------------------------------------------------------------------
# Mozzarella FDM table (review item C17 follow-up) — Python port of the
# same boundary scenarios in checks/golden-tests.mjs. Mirrors
# _run_mozzarella_composition() in validation_engine.py: an overall FDM
# floor (18%/20% by moisture type) plus a per-band moisture ceiling,
# where the band's own upper edge is exclusive.
# ---------------------------------------------------------------------
def _fdm_check(result):
    return next(c for c in result["composition"]["checks"] if c["label"] == "Fat in Dry Matter (FDM)")


def _moisture_check(result):
    return next(c for c in result["composition"]["checks"] if c["label"] == "Moisture (Mozzarella)")


def test_mozzarella_low_moisture_fdm_floor():
    at_floor = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "low_moisture", "moisture": 50, "fat": 9.0})  # FDM = 18.0
    assert _fdm_check(at_floor)["status"] == "PASS"
    under_floor = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "low_moisture", "moisture": 50, "fat": 8.95})  # FDM = 17.9
    assert _fdm_check(under_floor)["status"] == "FAIL"


def test_mozzarella_high_moisture_fdm_floor_independent_of_moisture_ceiling():
    at_floor = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "high_moisture", "moisture": 50, "fat": 10.0})  # FDM = 20.0
    assert _fdm_check(at_floor)["status"] == "PASS"
    under_floor = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "high_moisture", "moisture": 50, "fat": 9.95})  # FDM = 19.9
    assert _fdm_check(under_floor)["status"] == "FAIL"
    # The FDM floor and the per-band moisture ceiling are independent
    # checks — failing the floor doesn't block the moisture check from
    # still PASSing its own band.
    assert _moisture_check(under_floor)["status"] == "PASS"


def test_mozzarella_band_boundary_is_exclusive_on_the_upper_edge():
    # FDM=29.9 falls in the 18-30% band (low-moisture ceiling 66%);
    # FDM=30.0 falls in the NEXT band, 30-40% (ceiling 61%), per the
    # source's own "equal to or above 30... but less than 40" wording.
    # Same moisture (63%) on both sides of the boundary — comfortably
    # under 66%, over 61% — so PASS-vs-FAIL here proves the lookup uses
    # an exclusive upper edge, not just a raw threshold.
    just_under = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "low_moisture", "moisture": 63, "fat": 11.063})  # FDM = 29.9
    assert _moisture_check(just_under)["status"] == "PASS"
    at_boundary = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "low_moisture", "moisture": 63, "fat": 11.1})  # FDM = 30.0
    assert _moisture_check(at_boundary)["status"] == "FAIL"


def test_mozzarella_missing_inputs_produce_missing_not_a_crash():
    result = validate_submission("cheese", {"cheese_type": "mozzarella", "moisture_type": "low_moisture"})
    assert _fdm_check(result)["status"] == "MISSING"
    assert _moisture_check(result)["status"] == "MISSING"


# ---------------------------------------------------------------------
# Ghee/Butter (review item C17 — bring not-live categories live,
# composition-only). Python port of a subset of checks/golden-tests.mjs's
# schema-driven Ghee/Butter boundary coverage: this file has no
# equivalent auto-generated loop, so these are hand-written spot checks
# on the same _run_ghee_composition() the JS engine's runFields()-style
# walk mirrors, plus the two behaviors that are genuinely new to this
# category — "equals"-rule categorical fields and a category with no
# microbiology panel at all.
# ---------------------------------------------------------------------
def _check_by_label_substring(result, section, substring):
    return next(c for c in result[section]["checks"] if substring in c["label"])


def test_ghee_pass_with_only_required_fields():
    """Moisture/Milk Fat are the only required fields — every quality-
    factor test (BR Reading, RM Value, etc.) is optional and produces no
    row at all when left blank, same treatment as milk's sodium/urea."""
    result = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.3, "fat": 99.7})
    assert result["composition"]["status"] == "PASS"
    assert len(result["composition"]["checks"]) == 2
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_ghee_fails_on_moisture_over_limit():
    result = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.6, "fat": 99.7})
    assert result["composition"]["status"] == "FAIL"
    moisture_check = _check_by_label_substring(result, "composition", "Moisture")
    assert moisture_check["status"] == "FAIL"


def test_ghee_optional_quality_factor_field_checked_only_when_entered():
    # rm_value below Ghee's minimum (24.0) — should FAIL once entered...
    with_value = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.3, "fat": 99.7, "rm_value": 20.0})
    rm_check = _check_by_label_substring(with_value, "composition", "Reichert Meissl")
    assert rm_check["status"] == "FAIL"
    # ...but produces no row at all when left blank (optional, not MISSING).
    without_value = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.3, "fat": 99.7})
    assert not any("Reichert Meissl" in c["label"] for c in without_value["composition"]["checks"])


def test_ghee_baudouin_test_categorical_field():
    """Fix per review item C17: `rule: "equals"` — a categorical
    adulteration test, not a numeric threshold. "Negative" PASSes,
    anything else FAILs, case-insensitively."""
    negative = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.3, "fat": 99.7, "baudouin_test": "Negative"})
    assert _check_by_label_substring(negative, "composition", "Baudouin")["status"] == "PASS"
    positive = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.3, "fat": 99.7, "baudouin_test": "positive"})
    assert _check_by_label_substring(positive, "composition", "Baudouin")["status"] == "FAIL"
    assert positive["overall_status"] == "FAIL"  # CRITICAL severity


def test_table_butter_and_white_butter_use_different_required_fields():
    # Table Butter: Moisture/MSNF/Common Salt all have real limits.
    table = validate_submission("ghee", {"ghee_type": "table_butter", "moisture": 15.0, "fat": 81.0, "msnf": 1.5, "common_salt": 2.5})
    assert table["composition"]["status"] == "PASS"
    # White Butter: only Milk Fat has a stated limit — no fabricated
    # Moisture/MSNF/Salt ceilings for the blank table cells.
    white = validate_submission("ghee", {"ghee_type": "white_butter", "fat": 78.0})
    assert white["composition"]["status"] == "PASS"
    assert len(white["composition"]["checks"]) == 1


# ---------------------------------------------------------------------
# Milk Powder (review item C17 — bring not-live categories live,
# composition-only). Shares _run_generic_field_composition() with Ghee/
# Butter — these spot-check the sub-type wiring (milk_powder_type /
# MILK_POWDER_TYPES) is correctly threaded through, same as the Ghee
# tests above do for ghee_type/GHEE_TYPES.
# ---------------------------------------------------------------------
def test_whole_milk_powder_pass():
    result = validate_submission("milk_powder", {
        "milk_powder_type": "whole_milk_powder", "moisture": 3.0, "fat": 30.0, "protein_snf": 35.0,
        "titrable_acidity": 15.0, "insolubility_index": 1.0, "total_ash": 8.0,
    })
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"]["days"] == 180


def test_skimmed_milk_powder_fat_ceiling():
    # Skimmed Milk Powder: Milk Fat max 1.5% — a "max" rule, unlike Whole/
    # Partly Skimmed's "between" ranges for the same key.
    passing = validate_submission("milk_powder", {
        "milk_powder_type": "skimmed_milk_powder", "moisture": 3.0, "fat": 1.5, "protein_snf": 35.0,
        "titrable_acidity": 15.0, "insolubility_index": 1.0, "total_ash": 8.0,
    })
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("milk_powder", {
        "milk_powder_type": "skimmed_milk_powder", "moisture": 3.0, "fat": 1.6, "protein_snf": 35.0,
        "titrable_acidity": 15.0, "insolubility_index": 1.0, "total_ash": 8.0,
    })
    assert failing["composition"]["status"] == "FAIL"


def test_cream_powder_has_no_titrable_acidity_or_ash_fields():
    """The source table shows "--" for Cream Powder's Titrable Acidity/
    Insolubility Index/Total Ash cells — no fabricated limits, so those
    keys produce no check rows even when a value is entered."""
    result = validate_submission("milk_powder", {
        "milk_powder_type": "cream_powder", "moisture": 3.0, "fat": 45.0, "protein_snf": 35.0,
        "titrable_acidity": 999, "insolubility_index": 999, "total_ash": 999,
    })
    assert result["composition"]["status"] == "PASS"
    labels = [c["label"] for c in result["composition"]["checks"]]
    assert not any("Titrable Acidity" in l or "Insolubility" in l or "Total Ash" in l for l in labels)


def test_milk_powder_now_has_a_real_microbiology_panel():
    """Appendix B1, Table 2A Sr.7: an APC of 60000 is over milk powder's
    real M (50000), so this must FAIL, not read as NOT_AVAILABLE."""
    result = validate_submission("milk_powder", {
        "milk_powder_type": "whole_milk_powder", "moisture": 3.0, "fat": 30.0, "protein_snf": 35.0,
        "lab": {"apc": 60000, "salmonella": False, "listeria": False},
    })
    assert result["microbiological"]["status"] == "FAIL"
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "FAIL"


def test_ghee_category_has_no_microbiology_panel_yet():
    """Real Ghee (no micro_key override) still has no matching row in
    Appendix B1 — must stay NOT_AVAILABLE regardless of lab data, even
    though Table/White Butter (below) now have a real panel."""
    result = validate_submission("ghee", {"ghee_type": "ghee", "moisture": 0.3, "fat": 99.7, "lab": {"apc": 1000}})
    assert result["microbiological"] == {
        "status": "NOT_AVAILABLE", "checks": [],
        "note": "Microbiology limits for this category haven't been compiled into Inspeckt yet.",
    }


def test_table_butter_uses_the_butter_micro_key():
    """Table Butter carries micro_key "butter" -> Appendix B1 Sr.6
    "Pasteurized Butter" — resolved even though categoryId "ghee" itself
    has no direct MICRO_LIMITS entry."""
    result = validate_submission("ghee", {
        "ghee_type": "table_butter", "moisture": 14.0, "fat": 82.0, "msnf": 1.5, "common_salt": 2.0,
        "lab": {"apc": 60000, "salmonella": False, "listeria": False, "e_coli": False},
    })
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "FAIL"  # 60000 is over butter's M (50000)
    assert result["microbiological"]["status"] == "FAIL"


# ---------------------------------------------------------------------
# Yogurt / Dahi (review item C17 — bring not-live categories live,
# composition-only, per your "Everything in 2.1.13" answer). Plain Dahi
# is the one genuinely new mechanism here — a sub-type whose Fat/SNF
# checks are resolved live from MILK_TYPES instead of its own fixed
# fields (see _run_dahi_composition() in validation_engine.py) — the
# other sub-types share _run_generic_field_composition() with Ghee/
# Milk Powder and are spot-checked the same way those tests do.
# ---------------------------------------------------------------------
def test_plain_dahi_cross_references_the_selected_milk_type():
    """FSS 2.1.13, Item 2(c)(iii): Plain Dahi's own Fat/SNF minimums ARE
    whichever milk it's made from — Buffalo Milk needs >=5.0% fat here
    (CORRECTED per the primary text's Item 2(b) table, Sr. 1 — see the
    dairy_bible.py MILK_TYPES comment), not a fixed Dahi-specific
    number."""
    result = validate_submission("yogurt", {
        "yogurt_type": "plain_dahi", "milk_type": "buffalo_milk",
        "fat": 5.5, "snf": 9.2, "protein": 3.0, "titratable_acidity": 0.5,
    })
    assert result["composition"]["status"] == "PASS"
    fat_check = _check_by_label_substring(result, "composition", "Milk Fat")
    assert fat_check["label"] == "Milk Fat (Buffalo Milk)"
    assert fat_check["expected"] == "≥ 5.0%"


def test_plain_dahi_fails_below_the_milk_types_own_minimum():
    # 4.0% fat fails against Buffalo Milk's 5.0% minimum.
    result = validate_submission("yogurt", {
        "yogurt_type": "plain_dahi", "milk_type": "buffalo_milk",
        "fat": 4.0, "snf": 9.2, "protein": 3.0, "titratable_acidity": 0.5,
    })
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_plain_dahi_without_a_milk_type_selected_is_missing_not_a_crash():
    result = validate_submission("yogurt", {"yogurt_type": "plain_dahi", "protein": 3.0, "titratable_acidity": 0.5})
    # Per _section_status()'s cross-engine-parity fix, MISSING (any
    # severity) caps a section at WARNING, never FAIL — "not yet
    # selected" isn't a tested non-compliance. The real thing this test
    # guards against — a crash, or the field silently reading as PASS —
    # still can't happen: it's WARNING with an explicit MISSING check.
    assert result["composition"]["status"] == "WARNING"
    assert _check_by_label_substring(result, "composition", "same as source milk")["status"] == "MISSING"


def test_yoghurt_flavoured_dahi_fat_tier():
    result = validate_submission("yogurt", {
        "yogurt_type": "yoghurt_flavoured_dahi", "fat": 5.0, "msnf": 9.0, "protein": 3.0, "titratable_acidity": 0.7,
    })
    assert result["composition"]["status"] == "PASS"
    fat_check = _check_by_label_substring(result, "composition", "Milk Fat")
    assert fat_check["expected"] == "3.0–15.0%"


def test_chakka_types_use_different_dry_basis_fat_rules():
    # Chakka (min 33.0%) vs. Skimmed Milk Chakka (max 5.0%) vs. Full Cream
    # Chakka (min 38.0%) — three different rule shapes for the same "fat" key.
    chakka = validate_submission("yogurt", {"yogurt_type": "chakka", "total_solids": 31.0, "fat": 34.0, "protein": 31.0, "titratable_acidity": 2.0, "total_ash": 3.0})
    assert chakka["composition"]["status"] == "PASS"
    skimmed = validate_submission("yogurt", {"yogurt_type": "skimmed_milk_chakka", "total_solids": 21.0, "fat": 4.0, "protein": 61.0, "titratable_acidity": 2.0, "total_ash": 4.0})
    assert skimmed["composition"]["status"] == "PASS"
    skimmed_over = validate_submission("yogurt", {"yogurt_type": "skimmed_milk_chakka", "total_solids": 21.0, "fat": 6.0, "protein": 61.0, "titratable_acidity": 2.0, "total_ash": 4.0})
    assert skimmed_over["composition"]["status"] == "FAIL"


def test_shrikhand_types_have_a_sugar_ceiling_field():
    result = validate_submission("yogurt", {
        "yogurt_type": "shrikhand", "total_solids": 60.0, "fat": 9.0, "protein": 9.5,
        "titratable_acidity": 1.0, "sugar": 70.0, "total_ash": 0.5,
    })
    assert result["composition"]["status"] == "PASS"
    over_sugar = validate_submission("yogurt", {
        "yogurt_type": "shrikhand", "total_solids": 60.0, "fat": 9.0, "protein": 9.5,
        "titratable_acidity": 1.0, "sugar": 80.0, "total_ash": 0.5,
    })
    assert over_sugar["composition"]["status"] == "FAIL"


def test_drinks_based_on_fermented_milk_minimum_content():
    passing = validate_submission("yogurt", {"yogurt_type": "drinks_based_on_fermented_milk", "fermented_milk_content": 45.0})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("yogurt", {"yogurt_type": "drinks_based_on_fermented_milk", "fermented_milk_content": 35.0})
    assert failing["composition"]["status"] == "FAIL"


def test_yogurt_now_has_a_real_microbiology_panel():
    """Appendix B1, Table 2A Sr.12 lists E. coli as "Absent/g" — a
    presence test even though it's in Table 2A, not a CFU count."""
    result = validate_submission("yogurt", {
        "yogurt_type": "yoghurt_flavoured_dahi", "fat": 5.0, "msnf": 9.0, "protein": 3.0, "titratable_acidity": 0.7,
        "lab": {"e_coli": True, "salmonella": False, "listeria": False},
    })
    assert result["microbiological"]["status"] == "FAIL"
    e_coli_check = next(c for c in result["microbiological"]["checks"] if c["label"] == "E. coli")
    assert e_coli_check["status"] == "FAIL"


# ---------------------------------------------------------------------
# Table 2B count-vs-presence routing (bug fix discovered during Ice
# Cream/Frozen Dessert bring-up). _run_microbiology() used to treat
# every Table 2B entry as a presence/absence test unconditionally — but
# Milk Powder's real Table 2B (Appendix B1 Sr.7) has two genuine
# CFU-count organisms, Bacillus cereus (m=500, M=1000) and Sulphite
# Reducing Clostridia (m=50, M=100). A real sub-threshold count like
# 400 CFU/g was being read as a truthy "Detected" and forced to FAIL.
# This is a pre-existing bug in the already-live Milk Powder category,
# not something new to Ice Cream — it was only caught via Dried Ice
# Cream Mix's microKey sharing Milk Powder's bucket. Fixed by routing
# every Table 2A/2B entry by its own `presence` flag instead of by
# which table it's declared in. These are dedicated regression guards.
# ---------------------------------------------------------------------
def test_milk_powder_bacillus_cereus_is_a_real_count_not_a_presence_test():
    """Regression guard: 400 CFU/g is well under Bacillus cereus's
    acceptable limit (m=500) and must PASS, not be read as "Detected"."""
    result = validate_submission("milk_powder", {
        "milk_powder_type": "whole_milk_powder", "moisture": 3.0, "fat": 30.0, "protein_snf": 35.0,
        "lab": {
            "apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 25,
            "bacillus_cereus": 400, "src": 30, "salmonella": False, "listeria": False,
        },
    })
    bc_check = next(c for c in result["microbiological"]["checks"] if c["label"].startswith("Bacillus cereus"))
    src_check = next(c for c in result["microbiological"]["checks"] if c["label"].startswith("Sulphite Reducing"))
    assert bc_check["status"] == "PASS"
    assert src_check["status"] == "PASS"
    assert result["microbiological"]["status"] == "PASS"


def test_milk_powder_bacillus_cereus_still_fails_over_its_real_rejection_limit():
    result = validate_submission("milk_powder", {
        "milk_powder_type": "whole_milk_powder", "moisture": 3.0, "fat": 30.0, "protein_snf": 35.0,
        "lab": {"bacillus_cereus": 1001, "src": 30, "salmonella": False, "listeria": False},
    })
    bc_check = next(c for c in result["microbiological"]["checks"] if c["label"].startswith("Bacillus cereus"))
    assert bc_check["status"] == "FAIL"
    assert result["microbiological"]["status"] == "FAIL"


# ---------------------------------------------------------------------
# Ice Cream / Frozen Dessert (FSS 2.1.14 / 2.1.15). One category id
# spans both regulations — Appendix B1 Sr.9 lists "Ice Cream, Frozen
# Dessert, Milk Lolly, Ice Candy" as a single combined row, and the
# same one-id-two-regulations shape was already used for Ghee/Butter.
# ---------------------------------------------------------------------
def test_ice_cream_pass_with_all_required_fields():
    result = validate_submission("ice_cream", {
        "ice_cream_type": "ice_cream", "total_solids": 36.0, "weight": 525.0, "fat": 10.0, "protein": 3.5,
    })
    assert result["composition"]["status"] == "PASS"


def test_medium_fat_ice_cream_uses_a_between_rule_for_fat():
    passing = validate_submission("ice_cream", {
        "ice_cream_type": "medium_fat_ice_cream", "total_solids": 30.0, "weight": 475.0, "fat": 2.5, "protein": 3.5,
    })
    assert passing["composition"]["status"] == "PASS"
    over = validate_submission("ice_cream", {
        "ice_cream_type": "medium_fat_ice_cream", "total_solids": 30.0, "weight": 475.0, "fat": 10.1, "protein": 3.5,
    })
    assert over["composition"]["status"] == "FAIL"


def test_milk_ice_milk_lolly_has_no_weight_field():
    """FSS 2.1.14, Item 2(c)(ii): Milk Ice/Milk Lolly has no weight-per-
    litre requirement, unlike the ice cream types above."""
    result = validate_submission("ice_cream", {
        "ice_cream_type": "milk_ice_milk_lolly", "total_solids": 20.0, "fat": 2.0, "protein": 3.5,
    })
    assert result["composition"]["status"] == "PASS"
    labels = [c["label"] for c in result["composition"]["checks"]]
    assert not any("Weight" in label for label in labels)


def test_frozen_dessert_pass_with_total_fat_field():
    """FSS 2.1.15, Item 2(c)(i): same numeric minimums as Ice Cream
    (36% TS, 525 g/l, 10% fat, 3.5% protein) but under the Frozen
    Dessert regulation number and "Total Fat" terminology."""
    result = validate_submission("ice_cream", {
        "ice_cream_type": "frozen_dessert", "total_solids": 36.0, "weight": 525.0, "fat": 10.0, "protein": 3.5,
    })
    assert result["composition"]["status"] == "PASS"


def test_dried_ice_cream_mix_shares_milk_powders_real_micro_key():
    """DAIRY_PRODUCTS.ice_cream.dried_ice_cream_mix carries
    micro_key "milk_powder" — Appendix B1 Sr.7 explicitly names "Ice
    Cream Mix Powder" alongside Milk Powder. This also re-exercises the
    Table 2B count-routing fix above through the microKey redirection
    path, not just the direct milk_powder category."""
    result = validate_submission("ice_cream", {
        "ice_cream_type": "dried_ice_cream_mix", "moisture": 3.0, "total_solids": 36.0, "fat": 10.0, "protein": 3.5,
        "lab": {
            "apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 25,
            "bacillus_cereus": 500, "src": 30, "salmonella": False, "listeria": False,
        },
    })
    bc_check = next(c for c in result["microbiological"]["checks"] if c["label"].startswith("Bacillus cereus"))
    assert bc_check["status"] == "PASS"
    assert result["microbiological"]["status"] == "PASS"


def test_dried_frozen_dessert_mix_has_no_microbiology_panel():
    """DAIRY_PRODUCTS.ice_cream.dried_frozen_dessert_mix carries a
    deliberately nonexistent micro_key ("frozen_dessert_dried_mix_gap")
    — Appendix B1 has no row at all for a dried/powder form of Frozen
    Dessert (only Sr.7's Ice Cream Mix Powder and Sr.9's wet Ice Cream/
    Frozen Dessert/Milk Lolly/Ice Candy). Must stay an honest
    NOT_AVAILABLE rather than borrowing either bucket by analogy."""
    result = validate_submission("ice_cream", {
        "ice_cream_type": "dried_frozen_dessert_mix", "moisture": 3.0, "total_solids": 36.0, "fat": 10.0, "protein": 3.5,
        "lab": {"apc": 999999},
    })
    assert result["microbiological"]["status"] == "NOT_AVAILABLE"


# ---------------------------------------------------------------------
# Khoa / Mawa (FSS 2.1.6). New category — fixed on your "khoa and mawa
# fixed now, complete fix" go-ahead, not a temporary keyword removal.
# "khoa"/"mawa" used to be Milk Powder search keywords, silently
# validating Khoa submissions against the wrong regulation's numbers
# (FSS 2.1.10 instead of 2.1.6) — found while auditing Chapter 2.1's
# full table of contents for other uncovered dairy standards.
# ---------------------------------------------------------------------
def test_khoa_pass_with_all_required_fields():
    result = validate_submission("khoa", {
        "khoa_type": "khoa", "total_solids": 55.0, "fat": 27.0, "total_ash": 6.0, "titratable_acidity": 0.9,
    })
    assert result["composition"]["status"] == "PASS"


def test_khoa_fails_below_total_solids_minimum():
    result = validate_submission("khoa", {
        "khoa_type": "khoa", "total_solids": 54.9, "fat": 27.0, "total_ash": 6.0, "titratable_acidity": 0.9,
    })
    assert result["composition"]["status"] == "FAIL"
    ts_check = _check_by_label_substring(result, "composition", "Total Solids")
    assert ts_check["status"] == "FAIL"


def test_khoa_extracted_fat_quality_factors_are_optional_and_reuse_ghees_numbers():
    """FSS 2.1.6, Item 2(b) Note: "The extracted fat from Khoa shall meet
    the standards for Reichert Meissl value, Polenske value and
    Butyro-refractometer reading as prescribed for ghee" — these three
    are optional (not every FBO will have run these lab tests) and reuse
    Ghee's own column numbers (RM value >=24.0, Polenske 0.5-2.0, BR
    reading 40.0-44.0)."""
    without_quality_factors = validate_submission("khoa", {
        "khoa_type": "khoa", "total_solids": 55.0, "fat": 27.0, "total_ash": 6.0, "titratable_acidity": 0.9,
    })
    assert without_quality_factors["composition"]["status"] == "PASS"  # optional fields left blank don't block PASS

    failing_rm = validate_submission("khoa", {
        "khoa_type": "khoa", "total_solids": 55.0, "fat": 27.0, "total_ash": 6.0, "titratable_acidity": 0.9,
        "rm_value": 23.9,
    })
    rm_check = _check_by_label_substring(failing_rm, "composition", "Reichert Meissl")
    assert rm_check["status"] == "FAIL"


def test_khoa_has_its_own_real_microbiology_panel_not_milk_powders():
    """Appendix B1 Sr.14 "Khoa/ Khoa based sweets" is its own row, with
    its own numbers (APC m=25000/M=75000) — distinct from Milk Powder's
    Sr.7 (APC m=30000/M=50000), proving Khoa isn't silently sharing Milk
    Powder's panel now that it has its own category."""
    result = validate_submission("khoa", {
        "khoa_type": "khoa", "total_solids": 55.0, "fat": 27.0, "total_ash": 6.0, "titratable_acidity": 0.9,
        "lab": {"apc": 60000, "salmonella": False, "listeria": False},
    })
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "WARNING"  # 60000 is between Khoa's own m (25000) and M (75000)
    assert apc_check["expected"] != "≤ 30000 (m)"  # would indicate Milk Powder's m leaking in by mistake


# ---------------------------------------------------------------------
# Flavoured Milk (FSS 2.1.3). New category — built per your "you can
# start building on it" go-ahead, the first of the 11 remaining FSS
# Chapter 2.1 standards found uncovered while auditing the chapter's
# full table of contents. Architecturally identical to Plain Dahi above:
# its own Fat/SNF minimums ARE whichever milk it's made from (FSS 2.1.3,
# Item 2(c)), resolved live from MILK_TYPES via the renamed, generalized
# _run_milk_cross_reference_composition() (was _run_dahi_composition()
# — see that function's own comment in validation_engine.py). Unlike
# Plain Dahi, it also has NO own MICRO_LIMITS bucket at all — it reuses
# Milk's real Appendix B1 Sr.1 panel wholesale via `"micro_key": "milk"`
# (Sr.1 already groups "Pasteurized/boiled Milk/ Flavored Milk" as one
# row) — the second test below is this category's version of Khoa's
# "not sharing the wrong panel" regression guard, just checking the
# opposite direction: that it DOES correctly share Milk's panel.
# ---------------------------------------------------------------------
def test_flavoured_milk_cross_references_the_selected_milk_type():
    """FSS 2.1.3, Item 2(c): "Flavoured Milk shall have the same minimum
    percentage of milk fat and milk solids-not-fat as that of the milk
    ... from which it is prepared" — Buffalo Milk needs >=5.0% fat here
    (same MILK_TYPES numbers as every other cross-referencing category),
    not a fixed Flavoured-Milk-specific number."""
    result = validate_submission("flavoured_milk", {
        "flavoured_milk_type": "flavoured_milk", "milk_type": "buffalo_milk",
        "fat": 5.5, "snf": 9.2,
    })
    assert result["composition"]["status"] == "PASS"
    fat_check = _check_by_label_substring(result, "composition", "Milk Fat")
    assert fat_check["label"] == "Milk Fat (Buffalo Milk)"
    assert fat_check["expected"] == "≥ 5.0%"


def test_flavoured_milk_fails_below_the_milk_types_own_minimum():
    # 4.0% fat fails against Buffalo Milk's 5.0% minimum.
    result = validate_submission("flavoured_milk", {
        "flavoured_milk_type": "flavoured_milk", "milk_type": "buffalo_milk",
        "fat": 4.0, "snf": 9.2,
    })
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_flavoured_milk_without_a_milk_type_selected_is_missing_not_a_crash():
    result = validate_submission("flavoured_milk", {"flavoured_milk_type": "flavoured_milk"})
    # See test_plain_dahi_without_a_milk_type_selected_is_missing_not_a_crash
    # above: MISSING caps a section at WARNING, never FAIL, by design.
    assert result["composition"]["status"] == "WARNING"
    assert _check_by_label_substring(result, "composition", "same as source milk")["status"] == "MISSING"


def test_flavoured_milk_reuses_milks_real_microbiology_panel_via_micro_key():
    """Appendix B1 Sr.1 already covers "Pasteurized/boiled Milk/ Flavored
    Milk" — proving the `"micro_key": "milk"` override actually resolves
    to Milk's real panel (APC m=30000/M=50000) rather than falling back
    to a nonexistent MICRO_LIMITS["flavoured_milk"] bucket and reporting
    NOT_AVAILABLE."""
    result = validate_submission("flavoured_milk", {
        "flavoured_milk_type": "flavoured_milk", "milk_type": "buffalo_milk", "fat": 5.5, "snf": 9.2,
        "lab": {"apc": 40000, "coliform": 5, "salmonella": False, "listeria": False},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "WARNING"  # 40000 is between Milk's own m (30000) and M (50000)


# ---------------------------------------------------------------------
# Evaporated / Concentrated Milk (FSS 2.1.4). New category — second of
# the 11 further FSS Chapter 2.1 standards found missing during the same
# audit that turned up Flavoured Milk, built on the same "you can start
# building on it" go-ahead. Shares _run_generic_field_composition() with
# Ghee/Milk Powder — these spot-check the 4-tier sub-type wiring
# (evaporated_milk_type / EVAPORATED_MILK_TYPES) is correctly threaded
# through, same as the Ghee/Milk Powder tests above do for their own
# sub-type keys. No MICRO_LIMITS entry: Appendix B1 Sr.3 reads "NA"
# across every numeric CFU column for this product (confirmed via
# pdfplumber's extract_tables()) — same composition-only treatment as
# Ghee, spot-checked the same way as test_ghee_category_has_no_
# microbiology_panel_yet() above.
# ---------------------------------------------------------------------
def test_evaporated_milk_pass_with_all_required_fields():
    result = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_milk", "fat": 7.5, "milk_solids": 25.0, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_evaporated_milk_fails_below_fat_minimum():
    result = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_milk", "fat": 7.4, "milk_solids": 25.0, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_evaporated_partly_skimmed_milk_uses_a_between_rule_for_fat():
    """FSS 2.1.4, Item 2(c): "More than 1 and Less than 7.5" — coded as an
    inclusive 1.0-7.5 between rule (adjacent tiers cover both exact
    boundary values, same reasoning as Paneer's Medium Fat band)."""
    at_low_boundary = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_partly_skimmed_milk", "fat": 1.0, "milk_solids": 20.0, "protein_snf": 34.0,
    })
    assert at_low_boundary["composition"]["status"] == "PASS"
    at_high_boundary = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_partly_skimmed_milk", "fat": 7.5, "milk_solids": 20.0, "protein_snf": 34.0,
    })
    assert at_high_boundary["composition"]["status"] == "PASS"
    over_high_boundary = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_partly_skimmed_milk", "fat": 7.6, "milk_solids": 20.0, "protein_snf": 34.0,
    })
    assert over_high_boundary["composition"]["status"] == "FAIL"


def test_evaporated_skimmed_milk_fat_ceiling():
    # Evaporated Skimmed Milk: Milk Fat max 1.0% — a "max" rule, unlike
    # Evaporated Milk/High Fat Milk's "min" rules for the same key.
    passing = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_skimmed_milk", "fat": 1.0, "milk_solids": 20.0, "protein_snf": 34.0,
    })
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_skimmed_milk", "fat": 1.1, "milk_solids": 20.0, "protein_snf": 34.0,
    })
    assert failing["composition"]["status"] == "FAIL"


def test_evaporated_high_fat_milk_pass():
    result = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_high_fat_milk", "fat": 15.0, "milk_solids": 26.5, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "PASS"


def test_evaporated_milk_category_has_no_microbiology_panel():
    """Appendix B1 Sr.3 ("Sterilized milk /UHT milk / Evaporated Milk")
    reads "NA" across every numeric CFU column — must stay NOT_AVAILABLE
    regardless of lab data, same as real Ghee's no-micro_key case."""
    result = validate_submission("evaporated_milk", {
        "evaporated_milk_type": "evaporated_milk", "fat": 7.5, "milk_solids": 25.0, "protein_snf": 34.0,
        "lab": {"apc": 1000},
    })
    assert result["microbiological"] == {
        "status": "NOT_AVAILABLE", "checks": [],
        "note": "Microbiology limits for this category haven't been compiled into Inspeckt yet.",
    }


# ---------------------------------------------------------------------
# Sweetened Condensed Milk (FSS 2.1.5). New category — third of the 11
# further FSS Chapter 2.1 standards found missing during the same audit
# that turned up Flavoured Milk and Evaporated Milk, built on the same
# "you can start building on it" go-ahead. Shares
# _run_generic_field_composition() with Ghee/Milk Powder/Evaporated
# Milk — these spot-check the 4-tier sub-type wiring
# (sweetened_condensed_milk_type / SWEETENED_CONDENSED_MILK_TYPES), the
# "--" blank-cell handling (each tier states EITHER Milk Solids OR Milk
# Solids-Not-Fat, never both), and — unlike Evaporated Milk — a REAL
# Appendix B1 Sr.5 microbiology panel.
# ---------------------------------------------------------------------
def test_sweetened_condensed_milk_pass_with_all_required_fields():
    result = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_milk", "fat": 8.0, "milk_solids": 28.0, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_sweetened_condensed_milk_fails_below_fat_minimum():
    result = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_milk", "fat": 7.9, "milk_solids": 28.0, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_sweetened_condensed_partly_skimmed_milk_has_both_milk_solids_and_msnf():
    """Unlike every other tier (which states only ONE of Milk Solids /
    Milk Solids-Not-Fat), the source table gives Sweetened Condensed
    Partly Skimmed Milk BOTH: Milk Solids >=24.0% and MSNF >=20.0%."""
    result = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_partly_skimmed_milk",
        "fat": 4.0, "milk_solids": 24.0, "msnf": 20.0, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "PASS"
    failing = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_partly_skimmed_milk",
        "fat": 4.0, "milk_solids": 24.0, "msnf": 19.9, "protein_snf": 34.0,
    })
    assert failing["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(failing, "composition", "Milk Solids-Not-Fat")["status"] == "FAIL"


def test_sweetened_condensed_skimmed_milk_fat_ceiling():
    passing = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_skimmed_milk", "fat": 1.0, "milk_solids": 24.0, "protein_snf": 34.0,
    })
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_skimmed_milk", "fat": 1.1, "milk_solids": 24.0, "protein_snf": 34.0,
    })
    assert failing["composition"]["status"] == "FAIL"


def test_sweetened_condensed_high_fat_milk_has_msnf_not_milk_solids():
    """The source table's "--" cell for this tier's Milk Solids column
    means no fabricated limit — only MSNF (>=14.0%) is stated, unlike the
    plain/Skimmed tiers which state Milk Solids instead."""
    result = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_high_fat_milk", "fat": 16.0, "msnf": 14.0, "protein_snf": 34.0,
    })
    assert result["composition"]["status"] == "PASS"
    labels = [c["label"] for c in result["composition"]["checks"]]
    assert not any("Milk Solids (" in l for l in labels)  # no Milk Solids row fabricated for this tier


def test_sweetened_condensed_milk_has_its_own_real_microbiology_panel():
    """Appendix B1 Sr.5 gives Sweetened Condensed Milk a real panel (APC
    m=500/M=1000) — unlike Evaporated Milk's Sr.3, which is all "NA"."""
    result = validate_submission("sweetened_condensed_milk", {
        "sweetened_condensed_milk_type": "sweetened_condensed_milk", "fat": 8.0, "milk_solids": 28.0, "protein_snf": 34.0,
        "lab": {"apc": 750, "coliform": 5, "staph_aureus": 5, "yeast_mould": 5, "salmonella": False, "listeria": False},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "WARNING"  # 750 is between Sweetened Condensed Milk's own m (500) and M (1000)


def test_cream_pass_with_minimum_fat():
    """FSS 2.1.7, Item 2(c): "The product shall contain minimum 10.0 per
    cent. (m/m) milk fat." — the only mandatory composition number,
    shared by Cream and Malai alike (see CREAM_TYPES's own comment for
    why the Low/Medium/High Fat Cream labelling bands aren't separate
    composition tiers)."""
    result = validate_submission("cream", {"cream_type": "cream", "fat": 10.0})
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 7, "storage_temp": "2-6°C",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_cream_fails_below_fat_minimum():
    result = validate_submission("cream", {"cream_type": "cream", "fat": 9.9})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_malai_shares_creams_10_percent_fat_floor_but_not_its_microbiology():
    """Item 2(a)'s Raw Material clause groups "All creams, prepared
    creams and malai" together under the same Item 2(c) composition rule
    — but Appendix B1 has no row naming Malai at all, so its microbiology
    must NOT silently inherit Cream's real Sr.2 panel."""
    result = validate_submission("cream", {
        "cream_type": "malai", "fat": 10.0,
        "lab": {"apc": 999999, "coliform": 999999, "salmonella": True, "listeria": True},
    })
    assert result["composition"]["status"] == "PASS"
    assert result["microbiological"]["status"] == "NOT_AVAILABLE"
    failing = validate_submission("cream", {"cream_type": "malai", "fat": 9.9})
    assert failing["composition"]["status"] == "FAIL"


def test_cream_acidity_is_optional_and_only_checked_when_entered():
    """FSS 2.1.7, Item 2(c): "Acidity of the finished products, other
    than fermented and acidified creams, should not be more than 0.15%
    (as lactic acid)." — optional since this app has no cream-type
    selector distinguishing fermented/acidified cream from the rest."""
    skipped = validate_submission("cream", {"cream_type": "cream", "fat": 10.0})
    labels = [c["label"] for c in skipped["composition"]["checks"]]
    assert not any("Acidity" in l for l in labels)

    passing = validate_submission("cream", {"cream_type": "cream", "fat": 10.0, "acidity": 0.15})
    assert _check_by_label_substring(passing, "composition", "Acidity")["status"] == "PASS"

    failing = validate_submission("cream", {"cream_type": "cream", "fat": 10.0, "acidity": 0.16})
    assert _check_by_label_substring(failing, "composition", "Acidity")["status"] == "FAIL"


def test_cream_has_its_own_real_microbiology_panel():
    """Appendix B1 Sr.2 ("Pasteurized Cream") gives Cream a real panel of
    its own (APC m=5x10^4=50000, M=7.5x10^4=75000)."""
    result = validate_submission("cream", {
        "cream_type": "cream", "fat": 10.0,
        "lab": {"apc": 60000, "coliform": 5, "salmonella": False, "listeria": False},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    apc_check = next(c for c in result["microbiological"]["checks"] if "Aerobic" in c["label"])
    assert apc_check["status"] == "WARNING"  # 60000 is between Cream's own m (50000) and M (75000)


_DAIRY_WHITENER_BASE = {
    "dairy_whitener_type": "skimmed_milk_dairy_whitener",
    "moisture": 4.0, "fat": 1.5, "protein_snf": 34.0, "insolubility_index": 1.5,
    "total_ash": 9.3, "acid_insoluble_ash": 0.1, "added_sugar": 18.0, "titratable_acidity": 1.5,
}


def test_dairy_whitener_pass_with_all_required_fields():
    result = validate_submission("dairy_whitener", dict(_DAIRY_WHITENER_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_dairy_whitener_skimmed_fails_above_fat_ceiling():
    result = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "fat": 1.6})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_dairy_whitener_low_fat_uses_a_between_rule_for_fat():
    """Source wording is the open interval "More than 1.5 and less than
    10.0" — coded inclusive 1.5-10.0, same boundary-choice reasoning as
    Evaporated Milk/Sweetened Condensed Milk's partly-skimmed tiers."""
    passing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "low_fat_dairy_whitener", "fat": 1.5})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "low_fat_dairy_whitener", "fat": 10.1})
    assert failing["composition"]["status"] == "FAIL"


def test_dairy_whitener_medium_fat_uses_a_between_rule_for_fat():
    """Source wording is the half-open "Minimum 10.0 and less than 20.0"
    — coded inclusive 10.0-20.0, same boundary-choice reasoning."""
    passing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "medium_fat_dairy_whitener", "fat": 10.0})
    assert passing["composition"]["status"] == "PASS"
    also_passing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "medium_fat_dairy_whitener", "fat": 20.0})
    assert also_passing["composition"]["status"] == "PASS"
    failing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "medium_fat_dairy_whitener", "fat": 9.9})
    assert failing["composition"]["status"] == "FAIL"


def test_dairy_whitener_high_fat_has_its_own_tighter_titratable_acidity_ceiling():
    """The only field that differs from the other 3 tiers: 1.2% here vs
    1.5% for Skimmed/Low Fat/Medium Fat."""
    passing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "high_fat_dairy_whitener", "fat": 20.0, "titratable_acidity": 1.2})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("dairy_whitener", {**_DAIRY_WHITENER_BASE, "dairy_whitener_type": "high_fat_dairy_whitener", "fat": 20.0, "titratable_acidity": 1.3})
    assert failing["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(failing, "composition", "Titratable Acidity")["status"] == "FAIL"


def test_dairy_whitener_reuses_milk_powders_real_microbiology_panel_via_micro_key():
    """Appendix B1 Sr.7 explicitly names "Dairy Whitener" alongside Milk
    Powder as one shared row — every sub-type carries "micro_key":
    "milk_powder" rather than a duplicate bucket."""
    result = validate_submission("dairy_whitener", {
        **_DAIRY_WHITENER_BASE,
        "lab": {"apc": 30000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 5,
                "salmonella": False, "listeria": False, "bacillus_cereus": 500, "src": 50},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    bc_check = next(c for c in result["microbiological"]["checks"] if "Bacillus" in c["label"])
    assert bc_check["status"] == "PASS"  # 500 is exactly at Milk Powder's own m


# New category, built per your "you can start building on it" go-ahead —
# FSS 2.1.12 was never encoded anywhere in this app before. See
# WHEY_POWDER_TYPES in dairy_bible.py for the full sourcing note,
# including the pH inclusive-boundary choice and the deliberately
# not-encoded titratable-acidity alternate-test-method gap.
_WHEY_POWDER_BASE = {
    "whey_powder_type": "whey_powder",
    "moisture": 5.0, "fat": 2.0, "protein": 10.0, "lactose_content": 61.0,
    "ph": 5.1, "total_ash": 9.5,
}


def test_whey_powder_pass_with_all_required_fields():
    result = validate_submission("whey_powder", dict(_WHEY_POWDER_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_whey_powder_fails_above_fat_ceiling():
    result = validate_submission("whey_powder", {**_WHEY_POWDER_BASE, "fat": 2.1})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_whey_powder_ph_is_a_minimum_coded_inclusive_from_more_than_5point1():
    """Source wording is "more than 5.1" (strictly exclusive) — coded as
    an inclusive minimum, same boundary-choice reasoning as Paneer's
    Medium Fat tier / Dairy Whitener's Low Fat/Medium Fat tiers."""
    passing = validate_submission("whey_powder", {**_WHEY_POWDER_BASE, "ph": 5.1})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("whey_powder", {**_WHEY_POWDER_BASE, "ph": 5.0})
    assert failing["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(failing, "composition", "pH")["status"] == "FAIL"


def test_acid_whey_powder_ph_is_a_maximum_not_a_minimum():
    """Acid Whey Powder's column reverses the Whey Powder tier's pH rule
    (max 5.1, not min) — a different tier, different columns, and
    different limits throughout (Moisture 4.5 vs 5.0, Protein 7.0 vs
    10.0, Total Ash 15.0 vs 9.5)."""
    base = {**_WHEY_POWDER_BASE, "whey_powder_type": "acid_whey_powder",
            "moisture": 4.5, "protein": 7.0, "total_ash": 15.0}
    passing = validate_submission("whey_powder", {**base, "ph": 5.1})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("whey_powder", {**base, "ph": 5.2})
    assert failing["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(failing, "composition", "pH")["status"] == "FAIL"


def test_whey_powder_reuses_milk_powders_real_microbiology_panel_via_micro_key():
    """Appendix B1 Sr.7 explicitly names "Whey based Powder" alongside
    Milk Powder as one shared row — both sub-types carry "micro_key":
    "milk_powder" rather than a duplicate bucket."""
    result = validate_submission("whey_powder", {
        **_WHEY_POWDER_BASE,
        "lab": {"apc": 30000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 5,
                "salmonella": False, "listeria": False, "bacillus_cereus": 500, "src": 50},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    bc_check = next(c for c in result["microbiological"]["checks"] if "Bacillus" in c["label"])
    assert bc_check["status"] == "PASS"  # 500 is exactly at Milk Powder's own m


# New category, built per your "you can start building on it" go-ahead —
# FSS 2.1.18 was never encoded anywhere in this app before. See
# CASEIN_PRODUCTS_TYPES in dairy_bible.py for the full sourcing note,
# including the Edible Rennet Casein Total Ash MINIMUM (vs Edible Acid
# Casein's MAXIMUM on the same parameter) and the Casein-Powder-only
# Yeast and Mould footnote finding that gave this category its own
# dedicated micro_key instead of reusing "milk_powder".
_EDIBLE_ACID_CASEIN_BASE = {
    "casein_products_type": "edible_acid_casein",
    "moisture": 12.0, "fat": 2.0, "protein": 90.0, "casein_in_protein": 95.0,
    "lactose_content": 1.0, "total_ash": 2.5, "free_acid": 0.27,
}


def test_edible_acid_casein_pass_with_all_required_fields():
    result = validate_submission("casein_products", dict(_EDIBLE_ACID_CASEIN_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 365, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_edible_acid_casein_fails_above_fat_ceiling():
    result = validate_submission("casein_products", {**_EDIBLE_ACID_CASEIN_BASE, "fat": 2.1})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


def test_edible_rennet_casein_total_ash_is_a_minimum_not_a_maximum():
    """FSS 2.1.18, Item 2(c): Edible Rennet Casein's own Total Ash row is
    a MINIMUM (7.5%) per the table's own page-break continuation row —
    the opposite rule from Edible Acid Casein's MAXIMUM (2.5%) on the
    identically-named parameter. Confirmed via pdfplumber's
    extract_tables(), not just the flattened text, which loses the
    "(minimum)" qualifier across the page break."""
    base = {"casein_products_type": "edible_rennet_casein", "moisture": 12.0, "fat": 2.0,
            "protein": 84.0, "casein_in_protein": 95.0, "lactose_content": 1.0}
    passing = validate_submission("casein_products", {**base, "total_ash": 7.5})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("casein_products", {**base, "total_ash": 7.4})
    assert failing["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(failing, "composition", "Total Ash")["status"] == "FAIL"


def test_edible_caseinate_has_ph_but_no_total_ash_field():
    """FSS 2.1.18, Item 2(c): Edible Caseinate's Total Ash cell is blank
    ("--") in the source table — no fabricated limit, so no check row is
    produced for it regardless of what's entered. pH (max 8.0) is
    Caseinate's own field instead, stated for no other sub-type."""
    result = validate_submission("casein_products", {
        "casein_products_type": "edible_caseinate", "moisture": 8.0, "fat": 2.0,
        "protein": 88.0, "casein_in_protein": 95.0, "lactose_content": 1.0, "ph": 8.0,
    })
    assert result["composition"]["status"] == "PASS"
    labels = [c["label"] for c in result["composition"]["checks"]]
    assert not any("Total Ash" in l for l in labels)
    ph_check = _check_by_label_substring(result, "composition", "pH")
    assert ph_check["status"] == "PASS"
    failing = validate_submission("casein_products", {
        "casein_products_type": "edible_caseinate", "moisture": 8.0, "fat": 2.0,
        "protein": 88.0, "casein_in_protein": 95.0, "lactose_content": 1.0, "ph": 8.1,
    })
    assert failing["composition"]["status"] == "FAIL"


def test_casein_products_gets_its_own_microbiology_panel_with_yeast_and_mould():
    """Unlike Dairy Whitener/Whey Powder above, Casein Products does NOT
    reuse "micro_key": "milk_powder" — Appendix B1 Sr.7's own footnote 3
    restricts that shared row's Yeast and Mould Count criterion to
    Casein Powder specifically, so this category gets its own
    MICRO_LIMITS["casein_products"] bucket that correctly includes it
    (same APC/Coliform/Staph aureus/Table 2B numbers as Milk Powder's
    row, plus Yeast and Mould)."""
    result = validate_submission("casein_products", {
        **_EDIBLE_ACID_CASEIN_BASE,
        "lab": {"apc": 30000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 50,
                "salmonella": False, "listeria": False, "bacillus_cereus": 500, "src": 50},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    ym_check = next(c for c in result["microbiological"]["checks"] if "Yeast" in c["label"])
    assert ym_check["status"] == "PASS"  # 50 is exactly at Casein's own m
    failing = validate_submission("casein_products", {
        **_EDIBLE_ACID_CASEIN_BASE,
        "lab": {"apc": 30000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 51,
                "salmonella": False, "listeria": False, "bacillus_cereus": 500, "src": 50},
    })
    ym_fail_check = next(c for c in failing["microbiological"]["checks"] if "Yeast" in c["label"])
    assert ym_fail_check["status"] == "FAIL"  # 2-class plan (c=0) — one step over m fails straight away


def test_milk_powder_no_longer_checks_yeast_and_mould():
    """Regression guard for the fix found while building Edible Casein
    Products: Appendix B1 Sr.7's own footnote 3 restricts the Yeast and
    Mould Count criterion to Casein Powder specifically among that
    row's ~9 named products — Milk Powder itself included. Before this
    fix, MICRO_LIMITS["milk_powder"] carried "yeast_mould" as if it
    applied row-wide; it's been removed from there (and now lives
    correctly on MICRO_LIMITS["casein_products"] instead, see above)."""
    result = validate_submission("milk_powder", {
        "milk_powder_type": "whole_milk_powder", "moisture": 3.0, "fat": 30.0, "protein_snf": 35.0,
        "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 999999,
                "salmonella": False, "listeria": False, "bacillus_cereus": 400, "src": 30},
    })
    assert not any("Yeast" in c["label"] for c in result["microbiological"]["checks"])


# Edible Lactose (FSS 2.1.20), ninth of the 11 further Chapter 2.1
# standards. See EDIBLE_LACTOSE_TYPES in dairy_bible.py for the full
# sourcing note — a single-product standard (no sub-type split), the
# "sulphated_ash" field kept distinct from "total_ash", the not-encoded
# Disc-B "Scorched particle" gap, and the "micro_key": "milk_powder"
# reuse (Appendix B1 Sr.7 names "Lactose" directly on the shared row,
# ahead of the footnote-3 marker scoped to Casein Powder only).
_EDIBLE_LACTOSE_BASE = {
    "edible_lactose_type": "edible_lactose",
    "moisture": 6.0, "lactose_content": 99.0, "sulphated_ash": 0.3, "ph": 5.5,
}


def test_edible_lactose_pass_with_all_required_fields():
    result = validate_submission("edible_lactose", dict(_EDIBLE_LACTOSE_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 730, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_edible_lactose_fails_above_moisture_ceiling():
    result = validate_submission("edible_lactose", {**_EDIBLE_LACTOSE_BASE, "moisture": 6.1})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Moisture")["status"] == "FAIL"


def test_edible_lactose_fails_below_lactose_floor():
    # Note: every check row's label ends in "(Edible Lactose)" — the
    # product name itself — so a plain "Lactose" substring would match
    # the Moisture row first. "on dry basis" is unique to this field.
    result = validate_submission("edible_lactose", {**_EDIBLE_LACTOSE_BASE, "lactose_content": 98.9})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "on dry basis")["status"] == "FAIL"


def test_edible_lactose_ph_is_a_range_not_a_ceiling():
    """FSS 2.1.20, Item 2(b): pH (10% solution) is stated as a range,
    "4.5 - 7.0" — both ends are real limits, unlike most pH fields
    elsewhere in this chapter which are a plain min or max."""
    low_boundary = validate_submission("edible_lactose", {**_EDIBLE_LACTOSE_BASE, "ph": 4.5})
    assert low_boundary["composition"]["status"] == "PASS"
    below = validate_submission("edible_lactose", {**_EDIBLE_LACTOSE_BASE, "ph": 4.4})
    assert below["composition"]["status"] == "FAIL"
    high_boundary = validate_submission("edible_lactose", {**_EDIBLE_LACTOSE_BASE, "ph": 7.0})
    assert high_boundary["composition"]["status"] == "PASS"
    above = validate_submission("edible_lactose", {**_EDIBLE_LACTOSE_BASE, "ph": 7.1})
    assert above["composition"]["status"] == "FAIL"


def test_edible_lactose_reuses_milk_powder_microbiology_without_yeast_and_mould():
    """Same full-category-redirect shape as Dairy Whitener/Whey Powder:
    Appendix B1 Sr.7 names "Lactose" directly on the shared row, so this
    category reuses "micro_key": "milk_powder" rather than getting its
    own bucket like Casein Products needed — meaning the footnote-3
    Yeast and Mould exclusion applies here too."""
    result = validate_submission("edible_lactose", {
        **_EDIBLE_LACTOSE_BASE,
        "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 999999,
                "salmonella": False, "listeria": False, "bacillus_cereus": 400, "src": 30},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    assert not any("Yeast" in c["label"] for c in result["microbiological"]["checks"])


# Milk Protein Concentrate (FSS 2.1.21), Whey Protein Concentrate (FSS
# 2.1.22), and Colostrum Products (FSS 2.1.23) — the final 3 of the 11
# further Chapter 2.1 standards. See MILK_PROTEIN_CONCENTRATE_TYPES /
# WHEY_PROTEIN_CONCENTRATE_TYPES / COLOSTRUM_PRODUCTS_TYPES in
# dairy_bible.py for the full sourcing notes, including the IgG
# amendment finding tested below.
_MPC_BASE = {
    "milk_protein_concentrate_type": "milk_protein_concentrate",
    "moisture": 6.0, "protein": 40.0, "insolubility_index": 2.0, "total_ash": 10.0,
}


def test_milk_protein_concentrate_pass_with_all_required_fields():
    result = validate_submission("milk_protein_concentrate", dict(_MPC_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 365, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_milk_protein_concentrate_fails_below_protein_floor():
    result = validate_submission("milk_protein_concentrate", {**_MPC_BASE, "protein": 39.9})
    assert result["composition"]["status"] == "FAIL"
    # Note: every check row's label ends in "({name})" and the product name
    # here IS "Milk Protein Concentrate" — so a plain "Milk Protein"
    # substring search would match "Moisture (Milk Protein Concentrate)"
    # first (moisture is listed before protein in the fields array), same
    # collision bug already found and fixed once for Edible Lactose. Search
    # "Milk Protein (" (with the opening paren) instead, which only the
    # intended protein row's label ("Milk Protein (Milk Protein
    # Concentrate)") actually starts with.
    assert _check_by_label_substring(result, "composition", "Milk Protein (")["status"] == "FAIL"


def test_milk_protein_concentrate_reuses_milk_powder_microbiology():
    """FSS 2.1.21, Item 4, quoted directly: "The product shall conform to
    the microbiological requirements specified for milk powder in
    Appendix 'B'." — a direct textual redirect, so no Yeast and Mould
    Count either (same footnote-3 exclusion as Milk Powder itself)."""
    result = validate_submission("milk_protein_concentrate", {
        **_MPC_BASE,
        "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 999999,
                "salmonella": False, "listeria": False, "bacillus_cereus": 400, "src": 30},
    })
    assert result["microbiological"]["status"] != "NOT_AVAILABLE"
    assert not any("Yeast" in c["label"] for c in result["microbiological"]["checks"])


_WPC_BASE = {
    "whey_protein_concentrate_type": "whey_protein_concentrate",
    "moisture": 6.0, "protein": 35.0, "fat": 10,
}


def test_whey_protein_concentrate_pass_with_all_required_fields():
    result = validate_submission("whey_protein_concentrate", dict(_WPC_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_whey_protein_concentrate_fails_above_fat_ceiling():
    result = validate_submission("whey_protein_concentrate", {**_WPC_BASE, "fat": 10.1})
    assert result["composition"]["status"] == "FAIL"
    assert _check_by_label_substring(result, "composition", "Milk Fat")["status"] == "FAIL"


_COLOSTRUM_BASE = {
    "colostrum_products_type": "colostrum",
    "moisture": 80.0, "protein": 7.0, "fat": 4.0, "igg": 1.8, "lactoferrin": 0.2,
}
_COLOSTRUM_POWDER_BASE = {
    "colostrum_products_type": "colostrum_powder",
    "moisture": 4.0, "protein": 40.0, "fat": 17.5, "total_ash": 9.0, "igg": 8.5, "lactoferrin": 1.2,
}


def test_colostrum_pass_with_all_required_fields():
    result = validate_submission("colostrum_products", dict(_COLOSTRUM_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"]["days"] == 2


def test_colostrum_powder_pass_with_all_required_fields():
    result = validate_submission("colostrum_products", dict(_COLOSTRUM_POWDER_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"]["days"] == 365


def test_colostrum_has_no_total_ash_field_but_powder_does():
    """FSS 2.1.23: Total Ash only appears in the Colostrum Powder table
    (Item 2(II)(b)) — the liquid Colostrum table (Item 2(I)(a)) has no
    such row at all, so no check should be produced for it regardless of
    what's entered."""
    result = validate_submission("colostrum_products", dict(_COLOSTRUM_BASE))
    labels = [c["label"] for c in result["composition"]["checks"]]
    assert not any("Total Ash" in l for l in labels)
    powder_result = validate_submission("colostrum_products", dict(_COLOSTRUM_POWDER_BASE))
    assert _check_by_label_substring(powder_result, "composition", "Total Ash")["status"] == "PASS"


def test_colostrum_powder_igg_amendment_is_the_lowered_8_5_percent_figure():
    """FSS 2.1.23, Item 2(II)(b): the original table states "Immunoglobulins,
    minimum, %, (m/m) 12.5" for Colostrum Powder, but an "Amendment of
    highlighted provision" box directly beneath it replaces this with
    "Immunoglobulins-G (IgG), minimum, %, (m/m) 8.5" — a genuinely LOWER
    figure, not a rename — "in force on 1st May, 2025," which has
    already passed. This is a regression guard: if this ever silently
    reverted to checking the original 12.5% figure, a real,
    currently-compliant 8.5% product would incorrectly FAIL."""
    passing = validate_submission("colostrum_products", {**_COLOSTRUM_POWDER_BASE, "igg": 8.5})
    assert passing["composition"]["status"] == "PASS"
    failing = validate_submission("colostrum_products", {**_COLOSTRUM_POWDER_BASE, "igg": 8.4})
    assert failing["composition"]["status"] == "FAIL"
    igg_check = _check_by_label_substring(failing, "composition", "IgG")
    assert igg_check["status"] == "FAIL"
    # The original, superseded 12.5% figure is higher than the amended
    # 8.5% floor, so it must still comfortably PASS — this doesn't prove
    # which figure is coded, just that the amendment isn't stricter.
    still_passes_at_original_figure = validate_submission(
        "colostrum_products", {**_COLOSTRUM_POWDER_BASE, "igg": 12.5}
    )
    assert still_passes_at_original_figure["composition"]["status"] == "PASS"


def test_colostrum_products_reuses_milk_powder_microbiology_for_both_subtypes():
    """FSS 2.1.23, Item 4, quoted directly: "The product shall conform to
    the microbiological requirements specified for milk powder in
    Appendix 'B'." — covers both Colostrum and Colostrum Powder in one
    sentence, so both carry "micro_key": "milk_powder" even though
    Colostrum itself is a liquid, not a powder."""
    for base in (_COLOSTRUM_BASE, _COLOSTRUM_POWDER_BASE):
        result = validate_submission("colostrum_products", {
            **base,
            "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 999999,
                    "salmonella": False, "listeria": False, "bacillus_cereus": 400, "src": 30},
        })
        assert result["microbiological"]["status"] != "NOT_AVAILABLE"
        assert not any("Yeast" in c["label"] for c in result["microbiological"]["checks"])


# Dairy Permeate Powders (FSS 2.1.24) — found while reading FSS 2.1.23's
# own text for the prior batch (it sits immediately after Colostrum
# Products in the primary PDF), not one of the original "11 further
# standards", built per the "please build it" go-ahead. Three named
# sub-types share one Composition table (Item 2(c)) with different
# numbers per column: Lactose (anhydrous) >=76.0% for all three;
# Nitrogen <=1.1%/1.1%/0.8%; Milk Fat <=1.5% for all three; Ash
# <=14.0%/12.0%/12.0%; Moisture <=5.0% for all three.
_DAIRY_PERMEATE_POWDER_BASE = {
    "dairy_permeate_powders_type": "dairy_permeate_powder",
    "lactose": 76.0, "nitrogen": 1.1, "milk_fat": 1.5, "ash": 14.0, "moisture": 5.0,
}
_WHEY_PERMEATE_POWDER_BASE = {
    "dairy_permeate_powders_type": "whey_permeate_powder",
    "lactose": 76.0, "nitrogen": 1.1, "milk_fat": 1.5, "ash": 12.0, "moisture": 5.0,
}
_MILK_PERMEATE_POWDER_BASE = {
    "dairy_permeate_powders_type": "milk_permeate_powder",
    "lactose": 76.0, "nitrogen": 0.8, "milk_fat": 1.5, "ash": 12.0, "moisture": 5.0,
}


def test_dairy_permeate_powder_pass_with_all_required_fields():
    result = validate_submission("dairy_permeate_powders", dict(_DAIRY_PERMEATE_POWDER_BASE))
    assert result["composition"]["status"] == "PASS"
    assert result["shelf_life"] == {"days": 180, "storage_temp": "Ambient, sealed (cool & dry)",
                                     "note": "Estimated — confirm with your own shelf-life study."}


def test_whey_permeate_powder_pass_with_all_required_fields():
    result = validate_submission("dairy_permeate_powders", dict(_WHEY_PERMEATE_POWDER_BASE))
    assert result["composition"]["status"] == "PASS"


def test_milk_permeate_powder_pass_with_all_required_fields():
    result = validate_submission("dairy_permeate_powders", dict(_MILK_PERMEATE_POWDER_BASE))
    assert result["composition"]["status"] == "PASS"


def test_dairy_permeate_powder_fails_below_lactose_floor():
    result = validate_submission("dairy_permeate_powders", {**_DAIRY_PERMEATE_POWDER_BASE, "lactose": 75.9})
    assert result["composition"]["status"] == "FAIL"
    # Note: every check row's label ends in "({name})" and the product
    # name here is "Dairy Permeate Powder" — but "Lactose, Anhydrous"
    # (the field's own short label) isn't a substring of any other
    # field's label or of the product name itself, so a plain substring
    # search is safe here (unlike the Edible Lactose/Milk Protein
    # Concentrate collision bugs found earlier this session).
    assert _check_by_label_substring(result, "composition", "Lactose")["status"] == "FAIL"


def test_milk_permeate_powder_nitrogen_ceiling_is_tighter_than_the_other_two_subtypes():
    """FSS 2.1.24, Item 2(c): milk permeate powder's own Nitrogen ceiling
    (0.8%) is genuinely tighter than dairy/whey permeate powder's shared
    1.1% ceiling — 0.9% must FAIL for milk permeate powder specifically,
    while the same 0.9% figure still PASSes for the other two sub-types."""
    milk_result = validate_submission("dairy_permeate_powders", {**_MILK_PERMEATE_POWDER_BASE, "nitrogen": 0.9})
    assert milk_result["composition"]["status"] == "FAIL"
    nitrogen_check = _check_by_label_substring(milk_result, "composition", "Nitrogen")
    assert nitrogen_check["status"] == "FAIL"
    dairy_result = validate_submission("dairy_permeate_powders", {**_DAIRY_PERMEATE_POWDER_BASE, "nitrogen": 0.9})
    assert dairy_result["composition"]["status"] == "PASS"
    whey_result = validate_submission("dairy_permeate_powders", {**_WHEY_PERMEATE_POWDER_BASE, "nitrogen": 0.9})
    assert whey_result["composition"]["status"] == "PASS"


def test_dairy_permeate_powders_reuses_milk_powder_microbiology_for_all_three_subtypes():
    """FSS 2.1.24, Item 4, quoted directly: "The products shall conform
    to the microbiological requirements specified for milk powders in
    Appendix 'B' of these regulations." — covers all three sub-types in
    one sentence, so all three carry "micro_key": "milk_powder"."""
    for base in (_DAIRY_PERMEATE_POWDER_BASE, _WHEY_PERMEATE_POWDER_BASE, _MILK_PERMEATE_POWDER_BASE):
        result = validate_submission("dairy_permeate_powders", {
            **base,
            "lab": {"apc": 20000, "coliform": 5, "staph_aureus": 5, "yeast_mould": 999999,
                    "salmonella": False, "listeria": False, "bacillus_cereus": 400, "src": 30},
        })
        assert result["microbiological"]["status"] != "NOT_AVAILABLE"
        assert not any("Yeast" in c["label"] for c in result["microbiological"]["checks"])
