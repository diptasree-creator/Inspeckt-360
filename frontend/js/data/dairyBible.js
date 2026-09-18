/**
 * Inspeckt — Dairy Bible data layer
 * ----------------------------------------------------------------
 * Single source of truth for FSSAI dairy composition, microbiology,
 * labelling AND detection-keyword rules used by the validation engine,
 * the chat/search intake, and the Regulatory Brief.
 *
 * Source: INSPECKT_DAIRY_BIBLE_MASTER.md (compiled from 8 FSSAI
 * regulations, most recent versions as of 28 Jul 2026). Where the
 * earlier build spec / prototype disagreed with the Bible, the
 * Bible's numbers win — see README "Regulatory notes" for the diffs.
 *
 * SCHEMA-DRIVEN, ON PURPOSE (see Fix Plan Part 3, §2): every
 * composition rule lives as one `fields` entry — { key, rule,
 * min/max, unit, ref, severity } — under DAIRY_PRODUCTS. validation.js
 * has exactly ONE generic function (runComposition) that walks these
 * fields; there is no runMilkComposition()/runPaneerComposition()/
 * runCheeseComposition() to keep in sync by hand, and no special case
 * to bolt a bug onto (that's what produced the old skimmed-milk
 * duplicate-check bug — see the note on skimmed_milk below). The
 * Regulatory Brief and the live chat hints are ALSO generated from
 * these same `fields` — not hand-written per category — so the brief
 * text and the check that runs against it can't drift apart.
 *
 * To add a new product category or sub-type: add an entry to
 * DAIRY_PRODUCTS (with `fields`, `microLimits`-key, `keywords`, and
 * `live`) and to MICRO_LIMITS / LABEL_ELEMENTS_BY_CATEGORY. Nothing in
 * validation.js or the chat engine needs to change. See
 * CATEGORY_BIBLE_TEMPLATE.md for the full authoring + sign-off process.
 *
 * Every limit carries a `ref` back to its regulation clause so the UI
 * and reports can show FBOs exactly where a number comes from.
 */

// ---------------------------------------------------------------
// 0. PLATFORM TAXONOMY — every FSSAI food category Inspeckt covers.
//    Dairy is the only category with compiled, sign-off-ready
//    regulatory data (the Dairy Bible) so it's the only one that's
//    `live`. The rest are real FSSAI category groups shown so the
//    platform's actual scope is visible, but intentionally carry no
//    `regulation` citation yet — inventing one before the source
//    document exists would break the one rule this whole product is
//    built on: never state a number or reference you haven't
//    verified. They collect interest ("notify me") instead.
// ---------------------------------------------------------------
export const FSSAI_CATEGORIES = [
  {
    // Fix per review item C5: was "Dairy & Dairy Analogues" — but
    // NON_DAIRY_ANALOGUE_KEYWORDS (below) exists specifically to detect
    // and route plant-based/vegan "analogue" products AWAY to a
    // consultant, and neither Bible document covers them at all. A "Live"
    // card promising analogue coverage the product deliberately excludes
    // is exactly the kind of overclaim this app exists to prevent — the
    // description already only lists real dairy items, so the label now
    // matches what's actually (or eventually) checkable here.
    id: "dairy", label: "Dairy Products",
    description: "Milk, paneer, cheese, ghee, yogurt, milk powder, ice cream and more.",
    live: true,
    // Dairy's real detection runs through CATEGORIES' own, far more
    // precise per-sub-type keywords (see detectAnyCategoryId() below) —
    // this list exists only so this entry has the same shape as the
    // other nine and so a generic "which group is this" scan (if one is
    // ever written against FSSAI_CATEGORIES alone) doesn't quietly miss
    // dairy. detectFssaiGroupId() below deliberately skips `live` groups
    // for exactly this reason — don't let this list's coarser matching
    // second-guess CATEGORIES' more precise one.
    keywords: ["dairy", "milk", "paneer", "cheese", "ghee", "yogurt", "curd", "khoa"],
  },
  {
    id: "meat_poultry", label: "Meat & Poultry Products",
    description: "Fresh, processed, and frozen meat and poultry products.",
    live: false,
    keywords: ["meat", "poultry", "chicken", "mutton", "sausage", "salami", "kebab"],
  },
  {
    id: "fish_seafood", label: "Fish & Seafood Products",
    description: "Fresh, frozen, dried, and processed fish and seafood products.",
    live: false,
    keywords: ["fish", "seafood", "prawn", "shrimp", "crab", "squid"],
  },
  {
    id: "cereals_bakery", label: "Cereals, Flour & Bakery",
    description: "Bread, biscuits, flour, grains, and cereal-based products.",
    live: false,
    keywords: ["bread", "biscuit", "flour", "atta", "bakery", "cereal", "cookie", "cake", "millet", "namkeen", "rusk"],
  },
  {
    id: "fats_oils", label: "Fats, Oils & Emulsions",
    description: "Edible oils, vanaspati, margarine, and fat blends.",
    live: false,
    keywords: ["edible oil", "vanaspati", "margarine", "cooking oil", "sunflower oil", "mustard oil"],
  },
  {
    id: "fruits_vegetables", label: "Fruit & Vegetable Products",
    description: "Juices, purees, pickles, jams, and processed produce.",
    live: false,
    keywords: ["juice", "puree", "pickle", "jam", "ketchup", "pasta sauce", "chutney", "squash"],
  },
  {
    id: "confectionery", label: "Confectionery & Sweets",
    description: "Sugar confectionery, chocolate, and traditional Indian sweets.",
    live: false,
    keywords: ["chocolate", "candy", "toffee", "confectionery", "mithai", "sweet"],
  },
  {
    id: "beverages", label: "Beverages",
    description: "Non-alcoholic beverages, carbonated drinks, and drink concentrates.",
    live: false,
    keywords: ["beverage", "soft drink", "soda", "energy drink", "carbonated"],
  },
  {
    id: "proprietary_foods", label: "Proprietary & Novel Foods",
    description: "Formulated products without a defined FSSAI standard — fusion and novel foods.",
    live: false,
    // Deliberately no keywords: this bucket is "no defined standard
    // exists yet," which is a conclusion to reach after nothing else
    // matches, not something to guess a product into from a word list.
    keywords: [],
  },
  {
    id: "nutraceuticals", label: "Nutraceuticals & Health Supplements",
    description: "Health supplements, nutraceuticals, and foods for special dietary use.",
    live: false,
    keywords: ["supplement", "protein bar", "protein powder", "nutraceutical", "health drink"],
  },
];

/** Best-matching FSSAI food-group id for free text, among the nine
 * groups that AREN'T live yet — used so a visitor naming a non-dairy
 * product (e.g. "protein bar," "pasta sauce") gets an honest, specific
 * "that's [group name] — real category, not compiled yet" message
 * instead of a flat "doesn't match anything," without ever implying any
 * of these nine groups can actually be checked today. Dairy is skipped
 * on purpose: CATEGORIES' own per-sub-type keywords (detectAnyCategoryId,
 * below) already do dairy's detection more precisely, and letting this
 * coarser list second-guess that would risk the exact keyword-drift bug
 * CATEGORIES' own comments describe. */
export function detectFssaiGroupId(text) {
  const q = text.toLowerCase();
  let best = null;
  for (const group of FSSAI_CATEGORIES) {
    if (group.live) continue;
    for (const kw of group.keywords || []) {
      if (q.includes(kw) && (!best || kw.length > best.kw.length)) best = { group, kw };
    }
  }
  return best ? best.group.id : null;
}

// ---------------------------------------------------------------
// 1. DAIRY SUB-CATEGORIES (subset live today; full 18-category list
//    in the Bible, Chapter 1). This is the product picker *inside*
//    the Dairy category, not the platform-wide list above.
//
//    `keywords` is the ONLY place a sub-category's detection words
//    live. Anything that needs to know "is this a live, checkable
//    category" — the homepage search box, the chat intro — reads
//    keywords via liveDairyKeywords()/allDairyKeywords() below,
//    filtered by `live`. That's what makes it structurally impossible
//    for a non-live sub-category to route someone into a live check:
//    the routing logic and the live flag are the same field, not two
//    hand-maintained arrays that can fall out of sync (this is
//    specifically the fix for the yogurt-keyword-drift bug — "yogurt"
//    used to appear in a separately-maintained homepage keyword list
//    even though CATEGORIES marked it live:false).
// ---------------------------------------------------------------
// Fix per review item C17: `definition`/`definitionRef` power the
// research-vs-formulation fork (see detectAnyCategoryId() below and
// site-controller.js's handleIntro()/renderResearchFork()) — when
// someone names a product, before anything else happens they can see
// FSSAI's own definition of that category, self-serve, whether or not
// it's live yet. Every definition below is quoted verbatim (only PDF
// line-wrap and footnote markers cleaned up) from the primary FSSAI
// text you uploaded (Chapter 2.1, "Version 3, 07.05.2025") — not
// paraphrased, per this app's "never state a number or reference you
// haven't verified" rule. ice_cream's definition covers BOTH
// regulations its `regulation` field already cites (2.1.14 covers Ice
// Cream/Kulfi; 2.1.15 covers Frozen Dessert, which uses vegetable
// fat/protein instead of milk fat — a real product-category difference
// worth surfacing, not just a citation footnote).
export const CATEGORIES = [
  {
    id: "milk", label: "Milk", regulation: "2.1.2", live: true, keywords: ["milk"],
    definition: '"Milk" means the normal mammary secretion derived from complete milking of a healthy milch animal, without either addition thereto or extraction therefrom, and it shall be free from colostrum.',
    definitionRef: "FSS 2.1.1, Item 1(e) — General Standard for Milk and Milk Products",
  },
  // New category, built on your "start building on it" go-ahead — the
  // first of the 11 Chapter 2.1 standards found completely uncovered
  // while fixing Khoa's miscategorization (see README "Next steps" for
  // the full list). FSS 2.1.3's own Item 1 Description, quoted directly:
  // '"Flavoured Milk" means the product prepared from milk or other
  // products derived from milk, or both, and edible flavourings with or
  // without addition of sugar, nutritive sweeteners, other non-dairy
  // ingredients including, stabilisers and food colours. Flavoured milk
  // shall be subjected to heat treatment as provided in sub-regulation
  // 2.1.1.' Appendix B1's own microbiology table already groups
  // "Pasteurized/boiled Milk/ Flavored Milk" as ONE product row (Sr.1) —
  // the same row already coded as MICRO_LIMITS.milk — so this category
  // reuses that bucket via `microKey: "milk"` rather than a new one; see
  // DAIRY_PRODUCTS.flavoured_milk below for the composition mechanism.
  {
    // Fix per your "strawberry milk" report: FSS 2.1.3's own text just
    // says "edible flavourings" — it doesn't name specific flavours, so
    // these compound phrases are a detection HEURISTIC (product-naming
    // convention, not a regulatory list) added so a common flavour name
    // next to "milk" routes here instead of falling through to plain
    // Milk's keyword (detectAnyCategoryId() picks the LONGEST matching
    // keyword, so "strawberry milk" now outweighs the bare "milk" match).
    // Not exhaustive — any flavour missing from this list still falls
    // back to plain Milk, same as before.
    id: "flavoured_milk", label: "Flavoured Milk", regulation: "2.1.3", live: true,
    keywords: [
      "flavoured milk", "flavored milk",
      "strawberry milk", "chocolate milk", "mango milk", "banana milk",
      "rose milk", "badam milk", "kesar milk", "elaichi milk",
      "coffee milk", "vanilla milk", "caramel milk", "butterscotch milk",
      "pista milk", "pistachio milk", "kulfi milk",
    ],
    definition: '"Flavoured Milk" means the product prepared from milk or other products derived from milk, or both, and edible flavourings with or without addition of sugar, nutritive sweeteners, other non-dairy ingredients including, stabilisers and food colours. Flavoured milk shall be subjected to heat treatment as provided in the General Standard for Milk and Milk Products. Where flavoured milk is dried or concentrated, the dried or concentrated product on addition of prescribed amount of water shall give a product conforming to the requirements of flavoured milk.',
    definitionRef: "FSS 2.1.3, Item 1 — Standard for Flavoured Milk",
  },
  // New category, second of the 11 Chapter 2.1 standards found completely
  // uncovered (see the flavoured_milk comment above for the full list and
  // the "start building on it" go-ahead). FSS 2.1.4's own Item 1
  // Description, quoted directly: "Evaporated Milk means the product
  // obtained by partial removal of water from milk by heat or any other
  // process which leads to a product of the same composition and
  // characteristics." Appendix B1's own microbiology table (Sr.3,
  // "Sterilized milk /UHT milk / Evaporated Milk") gives "NA" across
  // every numeric CFU column — confirmed against the PDF's actual table
  // structure via pdfplumber's extract_tables(), not just the flattened
  // text — so this category is composition-only, like Ghee/Butter, with
  // one documented gap: a separate qualitative note on the same page
  // ("Sterilized /UHT milk products shall comply with a test for
  // commercial sterility as per IS: 4238 (Appendix C or Appendix D)") is
  // a pass/fail lab procedure, not a numeric limit this schema's
  // min/max/between rules can express — not encoded, same treatment as
  // Milk Powder's ordinal "Scorched particles, Disc B" gap.
  {
    id: "evaporated_milk", label: "Evaporated / Concentrated Milk", regulation: "2.1.4", live: true, keywords: ["evaporated milk", "concentrated milk", "evaporated concentrated milk"],
    definition: 'Evaporated Milk means the product obtained by partial removal of water from milk by heat or any other process which leads to a product of the same composition and characteristics. The fat and protein content of the milk may be adjusted, only to comply with the compositional requirements, by addition or withdrawal of milk constituents in such a way as not to alter the whey protein to casein ratio of the milk being adjusted.',
    definitionRef: "FSS 2.1.4, Item 1 — Standard for Evaporated or Concentrated Milk",
  },
  // New category, third of the 11 Chapter 2.1 standards found completely
  // uncovered (see the flavoured_milk comment above for the full list and
  // the "start building on it" go-ahead). FSS 2.1.5's own Item 1
  // Description, quoted directly: "Sweetened Condensed Milk is the
  // product obtained by partial removal of water from milk with the
  // addition of sugar or a combination of sucrose with other sugars, or
  // by any other process which leads to a product of the same
  // composition and characteristics." Appendix B1 Sr.5 ("Sweetened
  // Condensed Milk") DOES have a real microbiology panel — unlike
  // Evaporated Milk's Sr.3, which was all "NA" — see
  // DAIRY_PRODUCTS.sweetened_condensed_milk below for the full table and
  // the accelerated-storage-test gap.
  {
    id: "sweetened_condensed_milk", label: "Sweetened Condensed Milk", regulation: "2.1.5", live: true, keywords: ["sweetened condensed milk", "condensed milk"],
    definition: 'Sweetened Condensed Milk is the product obtained by partial removal of water from milk with the addition of sugar or a combination of sucrose with other sugars, or by any other process which leads to a product of the same composition and characteristics. The fat or protein content or both of the milk may be adjusted, only to comply with the compositional requirements, by addition or withdrawal of milk constituents in such a way as not to alter the whey protein to casein ratio of the milk being adjusted.',
    definitionRef: "FSS 2.1.5, Item 1 — Standard for Sweetened Condensed Milk",
  },
  // New category, fourth of the 11 Chapter 2.1 standards found completely
  // uncovered (see the flavoured_milk comment above for the full list and
  // the "start building on it" go-ahead). FSS 2.1.7's own Item 1
  // Description gives TWO distinct product definitions, quoted directly:
  // "(a) 'Cream' means the fluid product comparatively rich in fat, in
  // the form of an emulsion of fat-in-skimmed milk, obtained by physical
  // separation from cow milk, buffalo milk or milk of any other species
  // ... or a mixture thereof." and "(e) 'Malai' means the product rich in
  // milk fat prepared by boiling and cooling of cow milk, buffalo milk or
  // milk of any other species ... or a mixture thereof. It is
  // characterized by presence of insoluble mass, principally fat and
  // denatured protein, formed on heating and cooling of milk." See
  // DAIRY_PRODUCTS.cream below for the composition table and the
  // microbiology gap for Malai specifically.
  {
    id: "cream", label: "Cream and Malai", regulation: "2.1.7", live: true, keywords: ["cream", "malai", "whipping cream", "fresh cream"],
    definition: '"Cream" means the fluid product comparatively rich in fat, in the form of an emulsion of fat-in-skimmed milk, obtained by physical separation from cow milk, buffalo milk or milk of any other species as defined under this regulation or a mixture thereof. "Malai" means the product rich in milk fat prepared by boiling and cooling of cow milk, buffalo milk or milk of any other species as defined under this regulation or a mixture thereof, characterized by presence of insoluble mass, principally fat and denatured protein, formed on heating and cooling of milk.',
    definitionRef: "FSS 2.1.7, Item 1(a) and 1(e) — Standard for Cream and Malai",
  },
  // New category, fifth of the 11 Chapter 2.1 standards found completely
  // uncovered (see the flavoured_milk comment above for the full list and
  // the "start building on it" go-ahead). FSS 2.1.11's own Item 1
  // Description, quoted directly: "Dairy Whitener is a milk product
  // prepared through an appropriate processing of cow milk, buffalo milk
  // or milk of any other species as defined under this regulation or a
  // mixture thereof, and contains added carbohydrates such as sucrose,
  // dextrose and maltodextrin, singly or in combination." Appendix B1's
  // own microbiology table (Sr.7) already names "Dairy Whitener"
  // explicitly alongside "Milk Powder; SMP, Partly SMP; Cream Powder;
  // Ice Cream Mix Powder; ..." as one shared row — the same bucket
  // already coded as MICRO_LIMITS.milk_powder — so this category reuses
  // it via `microKey: "milk_powder"` on every sub-type rather than a new
  // one; see DAIRY_PRODUCTS.dairy_whitener below for the full 4-tier
  // composition table.
  {
    id: "dairy_whitener", label: "Dairy Whitener", regulation: "2.1.11", live: true, keywords: ["dairy whitener", "whitener", "creamer"],
    definition: 'Dairy Whitener is a milk product prepared through an appropriate processing of cow milk, buffalo milk or milk of any other species as defined under this regulation or a mixture thereof, and contains added carbohydrates such as sucrose, dextrose and maltodextrin, singly or in combination. The fat or protein content, or both, of the milk may be adjusted by addition or withdrawal of milk constituents in such a way as not to alter the whey protein to casein ratio of milk.',
    definitionRef: "FSS 2.1.11, Item 1 — Standard for Dairy Whitener",
  },
  // New category, sixth of the 11 Chapter 2.1 standards found completely
  // uncovered (see the flavoured_milk comment above for the full list and
  // the "start building on it" go-ahead). FSS 2.1.12's own Item 1
  // Description, quoted directly: "Whey powders are milk products
  // obtained by drying Whey or Acid Whey." Appendix B1's own
  // microbiology table (Sr.7) already names "Whey based Powder"
  // explicitly alongside "Milk Powder; SMP, Partly SMP; Dairy Whitener;
  // Cream Powder; ..." as one shared row — the same bucket already coded
  // as MICRO_LIMITS.milk_powder — so this category reuses it via
  // `microKey: "milk_powder"` on both sub-types, same reuse pattern as
  // Dairy Whitener above; see DAIRY_PRODUCTS.whey_powder below for the
  // full 2-tier composition table.
  {
    id: "whey_powder", label: "Whey Powder", regulation: "2.1.12", live: true, keywords: ["whey powder", "whey", "acid whey powder", "acid whey"],
    definition: 'Whey powders are milk products obtained by drying Whey or Acid Whey. Whey is the fluid milk product obtained during the manufacture of cheese, casein or similar products by separation from the curd after coagulation of milk or of products obtained from milk, or both — coagulation obtained through the action of, principally, suitable enzymes of non-animal origin. Acid whey is the fluid milk product obtained during the manufacture of cheese, casein, paneer, channa or similar products by separation from the curd after coagulation of milk and of products obtained from milk — coagulation obtained, principally, by acidification and heating.',
    definitionRef: "FSS 2.1.12, Item 1 — Standard for Whey Powder",
  },
  // New category, seventh of the 11 Chapter 2.1 standards found
  // completely uncovered (see the flavoured_milk comment above for the
  // full list and the "start building on it" go-ahead). FSS 2.1.18's
  // own Item 1 Description defines THREE distinct products under one
  // standard, quoted directly: "(b) Edible Acid Casein means the
  // product obtained by separating, washing and drying the acid
  // precipitated coagulum of skimmed milk or of other products obtained
  // from milk; (c) Edible Rennet Casein means the product obtained
  // after washing and drying the coagulum remaining after separating
  // the whey from the skimmed milk or of other products obtained from
  // milk, or both, which has been coagulated by non-animal rennet or by
  // other coagulating enzymes; (d) Edible Caseinate means the dry
  // product obtained by reaction of edible casein or casein curd
  // coagulum with food grade neutralising agents followed by drying."
  // While researching this category's own Appendix B1 microbiology row
  // (Sr.7, the same shared row Dairy Whitener/Whey Powder already reuse
  // via `microKey: "milk_powder"`), found that a footnote restricts one
  // of that row's criteria (Yeast and Mould Count) to Casein Powder
  // specifically — see the long comment on MICRO_LIMITS.milk_powder
  // above and MICRO_LIMITS.casein_products below. Because of that,
  // this category does NOT reuse `microKey: "milk_powder"` — it gets
  // its own dedicated MICRO_LIMITS.casein_products bucket instead (same
  // APC/Coliform/Staph aureus/Table 2B numbers as Milk Powder's row,
  // PLUS the Yeast and Mould criterion that's uniquely Casein's); see
  // DAIRY_PRODUCTS.casein_products below for the full 3-tier
  // composition table.
  {
    id: "casein_products", label: "Edible Casein Products", regulation: "2.1.18", live: true, keywords: ["casein", "edible casein", "acid casein", "rennet casein", "caseinate"],
    definition: 'Edible Casein products mean the products obtained by separating, washing and drying the coagulum of skimmed milk or of other products obtained from milk. Edible Acid Casein means the product obtained by separating, washing and drying the acid precipitated coagulum of skimmed milk or of other products obtained from milk. Edible Rennet Casein means the product obtained after washing and drying the coagulum remaining after separating the whey from the skimmed milk or of other products obtained from milk, or both, which has been coagulated by non-animal rennet or by other coagulating enzymes. Edible Caseinate means the dry product obtained by reaction of edible casein or casein curd coagulum with food grade neutralising agents followed by drying.',
    definitionRef: "FSS 2.1.18, Item 1 — Standard for Edible Casein Products",
  },
  // New category, eighth of the 11 Chapter 2.1 standards found
  // completely uncovered (see the flavoured_milk comment above for the
  // full list and the "start building on it" go-ahead). FSS 2.1.20 is a
  // single product with no named sub-types — unlike every other
  // category so far, DAIRY_PRODUCTS.edible_lactose below has exactly one
  // key ("edible_lactose" itself) so the generic sub-type-driven engine
  // (specFor/runComposition/etc.) needs no special-casing. Quoted
  // directly from Item 1 Description: "Lactose is a white to light
  // yellow crystalline, slightly sweet disaccharide sugar found in
  // milk." Checked this category's own Appendix B1 row while building
  // it: Sr.7 (the same shared row Dairy Whitener/Whey Powder reuse via
  // `microKey: "milk_powder"`) explicitly lists "Lactose" by name in its
  // product list, sitting well before the footnote-3 marker that's
  // attached only to "Casein Powder" later in that same list — so
  // Edible Lactose gets the same `microKey: "milk_powder"` redirect as
  // Dairy Whitener/Whey Powder (no yeast_mould), not its own bucket like
  // Casein Products needed.
  {
    id: "edible_lactose", label: "Edible Lactose", regulation: "2.1.20", live: true, keywords: ["lactose", "edible lactose", "milk sugar"],
    definition: 'Lactose is a white to light yellow crystalline, slightly sweet disaccharide sugar found in milk.',
    definitionRef: "FSS 2.1.20, Item 1 — Standard for Edible Lactose",
  },
  // Final 3 of the 11 further Chapter 2.1 standards found missing during
  // the full table-of-contents audit — see the flavoured_milk comment
  // above for the full list and go-ahead. All three explicitly cite
  // their own microbiology cross-reference IN THE PRIMARY TEXT ITSELF
  // (unlike Dairy Whitener/Whey Powder/Edible Lactose, which reuse
  // `microKey: "milk_powder"` because Appendix B1 Sr.7 shares a row
  // across product names) — quoted per category below.
  {
    id: "milk_protein_concentrate", label: "Milk Protein Concentrate", regulation: "2.1.21", live: true, keywords: ["milk protein concentrate", "mpc"],
    definition: 'Milk Protein Concentrates are complex milk proteins that contain both casein and whey protein in their native form in the same and similar ratio as milk depending upon their milk protein contents, which are generally manufactured by suitable processes that remove the majority of lactose and soluble minerals while retaining milk protein, followed by drying.',
    definitionRef: "FSS 2.1.21, Item 1 — Standard for Milk Protein Concentrate",
  },
  {
    id: "whey_protein_concentrate", label: "Whey Protein Concentrate", regulation: "2.1.22", live: true, keywords: ["whey protein concentrate", "wpc"],
    definition: 'Whey protein concentrate means a product obtained by removing non-protein constituents from whey by means of physical separation techniques such as precipitation, filtration, dialysis and other relevant techniques, followed by drying.',
    definitionRef: "FSS 2.1.22, Item 1 — Standard for Whey Protein Concentrate",
  },
  // Item 1 defines THREE sub-items — (a) Colostrum, (b) Colostrum-based
  // products, (c) Colostrum powder — but Item 5's own Labelling clause
  // only ever cites "sub-item (a)" (-> "colostrum") and "sub-item (b)"
  // (-> "colostrum powder"), never (c). That's the primary text's own
  // apparent drafting inconsistency, not a transcription error on this
  // app's part — quoted exactly in DAIRY_PRODUCTS.colostrum_products'
  // own comment below. The two sub-types built here follow the
  // Composition section's own unambiguous (I)/(II) headers ("Colostrum"
  // / "Colostrum powder") instead of guessing which lettering is "right".
  {
    id: "colostrum_products", label: "Colostrum Products", regulation: "2.1.23", live: true, keywords: ["colostrum", "colostrum powder", "cow colostrum", "buffalo colostrum"],
    definition: '"Colostrum" means the lacteal secretion from the mammary glands of cow or buffalo or a combination thereof obtained upto three to five days of parturition and preceding the production of milk, which typically contains fat, proteins, carbohydrates, vitamins, minerals and bioactive components (such as immunoglobulins and lactoferrin). "Colostrum-based products" means processed products resulting from the processing of colostrum or from further processing of such processed products. "Colostrum powder" is a colostrum-based product obtained by the drying of colostrum by suitable methods while retaining the essential characteristics of colostrum.',
    definitionRef: "FSS 2.1.23, Item 1 — Standard for Cow or Buffalo Colostrum and Colostrum Products",
  },
  // Dairy Permeate Powders (FSS 2.1.24) — found while reading FSS 2.1.23's
  // own text for the prior batch (it sits immediately after Colostrum
  // Products in the primary PDF), not one of the "11 further standards"
  // originally counted, but a real, active standard nonetheless — built
  // per your "please build it" go-ahead. Three named sub-types share ONE
  // parameter table (Item 2(c)) with different numbers per column,
  // confirmed cell-by-cell via pdfplumber's `extract_tables()` (not just
  // the flattened text, which merges the header row awkwardly):
  //   Parameter                          | Dairy permeate | Whey permeate | Milk permeate
  //   Lactose, anhydrous, min, %         | 76.0           | 76.0          | 76.0
  //   Nitrogen, max, %                   | 1.1            | 1.1           | 0.8
  //   Milk Fat, max, %                   | 1.5            | 1.5           | 1.5
  //   Ash, max, %                        | 14.0           | 12.0          | 12.0
  //   Moisture, max, %                   | 5.0            | 5.0           | 5.0
  //   Scorched particles, maximum        | Disc B         | Disc B        | Disc B
  // Same not-encoded Disc B gap as every other dry powder this session.
  // Item 4's Hygiene clause, quoted directly: "The products shall conform
  // to the microbiological requirements specified for milk powders in
  // Appendix 'B' of these regulations." — a direct textual redirect, same
  // citation style as Milk Protein Concentrate/Colostrum Products, so
  // `microKey: "milk_powder"` again.
  {
    id: "dairy_permeate_powders", label: "Dairy Permeate Powders", regulation: "2.1.24", live: true, keywords: ["dairy permeate powder", "whey permeate powder", "milk permeate powder", "permeate powder"],
    definition: '"Dairy permeate powders" are dried milk products characterised by a high content of lactose, manufactured from permeates obtained by removing (through membrane filtration or other processing techniques), to the extent practical, milk fat and milk protein but not lactose, from milk, whey, cream or sweet buttermilk or similar raw materials. "Whey permeate powder" is the dairy permeate powder manufactured from whey permeate (obtained by removing whey protein, but not lactose, from whey). "Milk permeate powder" is the dairy permeate powder manufactured from milk permeate.',
    definitionRef: "FSS 2.1.24, Item 1 — Standard for Dairy Permeate Powders",
  },
  // Fix per review item C17 (found while researching it, not C17 itself):
  // the INSPECKT_DAIRY_BIBLE_MASTER.md document's own Ch 1.1 taxonomy
  // table and chapter headers disagree with the FSSAI official
  // category-code cross-reference table the founder provided directly —
  // and that cross-reference table is the one confirmed authoritative.
  // It lists "Chhana and Paneer[01.6.1]" as 2.1.16 (not 2.1.5, and not
  // 2.1.17 either, which the Dairy Bible doc used before an earlier,
  // now-superseded fix in this same review — see A[bonus]'s comment
  // history) and every cheese variety under 2.1.17 (Cheddar
  // 2.1.17(1)(a)(aa), Processed Cheese 2.1.17(1)(b)(ba), Cottage Cheese
  // 2.1.17(1)(a)(ag), Mozzarella 2.1.17(2)(a)(aq), Gouda 2.1.17(1)(a)(ad)
  // — collapsed to the bare top-level code here and in each field's ref
  // below; the per-variety sub-clause detail is available if a more
  // granular citation is wanted later). Milk (2.1.2) and Ice Cream/Frozen
  // Dessert (2.1.14/2.1.15) both already matched the cross-reference
  // table and needed no change. Ghee/Butter's code could NOT be verified
  // against it — the table only covers GSFA category 01 (Dairy) and
  // excludes fats/oils, where Ghee likely sits; left as-is, unverified.
  {
    id: "paneer", label: "Paneer / Chhana", regulation: "2.1.16", live: true, keywords: ["paneer", "chhana"],
    definition: '"Chhana or Paneer" means the product obtained from any variant of milk, with or without added milk solids, by precipitation with permitted acidulants and heating.',
    definitionRef: "FSS 2.1.16, Item 1 — Standard for Chhana and Paneer",
  },
  {
    id: "cheese", label: "Cheese", regulation: "2.1.17", live: true, keywords: ["cheese", "cheddar", "mozzarella", "gouda"],
    definition: '"Cheese" is the ripened or unripened soft, semi-hard, hard, or extra-hard product, which may be coated with food grade waxes or polyfilm, and in which the whey protein/casein ratio does not exceed that of milk — obtained either by coagulating the protein of milk (or products obtained from milk) through the action of suitable enzymes or other coagulating agents, and partially draining the resulting whey, or by a processing technique giving an end-product with similar characteristics. All cheese shall be made from milk heat-treated to at least pasteurisation level.',
    definitionRef: "FSS 2.1.17, Item 1 — Standard for Cheese and Cheese Products",
  },
  {
    // Fix per review item C17 (bring not-live categories live, composition-
    // only): flipped live per your confirmed answer — see DAIRY_PRODUCTS.ghee
    // below for the full schema and the scope of what is/isn't encoded.
    id: "ghee", label: "Ghee / Butter", regulation: "2.1.8 / 2.1.9", live: true, keywords: ["ghee", "butter"],
    definition: '"Milk fat, ghee, butter oil, anhydrous milk fat and anhydrous butter oil" are fatty products derived exclusively from milk or products obtained from milk, or both, by processes resulting in almost total removal of water and milk solids-not-fat — ghee has an especially developed flavour and physical structure as a result of its method of manufacture. "Butter" means the fatty product principally in the form of a water-in-oil emulsion, derived exclusively from milk or milk products, or both.',
    definitionRef: "FSS 2.1.8, Item 1 (Ghee/Milk Fat Products) and FSS 2.1.9, Item 1 (Butter)",
  },
  {
    // Fix per review item C17 (bring not-live categories live, composition-
    // only): flipped live, per your "Everything in 2.1.13" sign-off — see
    // DAIRY_PRODUCTS.yogurt below for the full 11-sub-type schema (Dahi,
    // Yoghurt, Chakka, Shrikhand, and Drinks based on Fermented Milk) and
    // what is/isn't encoded.
    //
    // Fix per your "what do you mean, and do you think customers need to
    // see this" question about the "Dahi entry formally omitted" note:
    // moved out of `definition` (below) and explained here instead. What
    // it means — Item 1(a) of FSS 2.1.13 is a *description* table that
    // originally described both "Dahi" and "Yoghurt" as separate entries;
    // a later gazette amendment removed Dahi's own standalone description
    // row from that table, leaving Yoghurt's starter-culture description
    // as the only one printed there today. That is a documentation/
    // drafting detail about ONE descriptive table, not a change to Dahi's
    // legal status — Item 2(c)(iii)'s actual compositional standard for
    // Plain Dahi (its Fat/SNF tied to whichever milk it's made from) is
    // still fully in force, which is exactly why Plain Dahi still has its
    // own live, checkable sub-type below, same as before this note
    // existed. My opinion: customers shouldn't see this in the product —
    // it reads as "Dahi might not be a real category anymore," which is
    // false and would understandably worry a Dahi maker or push them into
    // an unnecessary consultant escalation, for a fact that changes
    // nothing about their actual obligations or what Inspeckt checks. It's
    // exactly the kind of citation-provenance detail that belongs in a
    // comment for whoever maintains this data next, not in a customer-
    // facing definition — kept here instead of deleted outright, since it
    // is the real reason Yoghurt's definition below is written the way it
    // is and a future editor shouldn't have to rediscover that.
    id: "yogurt", label: "Yogurt / Dahi", regulation: "2.1.13", live: true, keywords: ["yogurt", "yoghurt", "dahi", "curd", "chakka", "shrikhand", "lassi", "chhaas", "buttermilk"],
    definition: '"Fermented Milk" is a milk product obtained by fermentation of milk, which may have been manufactured using other permitted raw material, by the action of suitable microorganisms, resulting in lowering of pH with or without coagulation. "Yoghurt" is the fermented-milk product characterised by its own specific starter culture — symbiotic cultures of Streptococcus thermophilus and Lactobacillus delbrueckii subsp. bulgaricus. "Dahi" is covered by this same standard, with its own compositional requirement in Item 2(c)(iii) below.',
    definitionRef: "FSS 2.1.13, Item 1 — Standard for Fermented Milk Products",
  },
  {
    // Fix per review item C17 (bring not-live categories live, composition-
    // only): flipped live — see DAIRY_PRODUCTS.milk_powder below for the
    // full schema and what is/isn't encoded.
    //
    // Fix (found during the Ice Cream/Frozen Dessert build, fixed on your
    // "khoa and mawa fixed now, complete fix" go-ahead): "khoa" and "mawa"
    // used to be keywords HERE, routing anyone searching for Khoa into the
    // Milk Powder checker — but Khoa is its own standard, FSS 2.1.6, with
    // its own composition table (Total Solids, Milk Fat on a dry-matter
    // basis, Total Ash, Titratable Acidity) that shares no numbers with
    // Milk Powder's (FSS 2.1.10: Moisture, Milk Fat, Milk Protein/SNF,
    // Titrable Acidity, Insolubility Index). Searching "khoa" was
    // therefore validating people against the wrong regulation entirely.
    // Moved to its own `khoa` category below rather than patched here.
    id: "milk_powder", label: "Milk Powder", regulation: "2.1.10", live: true, keywords: ["milk powder"],
    definition: '"Milk powders and cream powder" are milk products obtained by partial removal of water from milk or cream. The fat or protein content, or both, may be adjusted only to comply with the compositional requirements, by addition or withdrawal of milk constituents in a way that doesn\'t alter the whey protein to casein ratio being adjusted. The product shall be free from added whey and whey preparations.',
    definitionRef: "FSS 2.1.10, Item 1 — Standard for Milk Powders and Cream Powder",
  },
  // New category, not a fix to an existing one: FSS 2.1.6 was never
  // encoded anywhere in this app before — "khoa"/"mawa" were only ever
  // present as (mis-targeted) Milk Powder keywords, per the comment
  // above. Built from the primary FSSAI text directly (Chapter 2.1,
  // "Version 3, 07.05.2025", Item 1 "Description"): "Khoa by whatever
  // name it is sold such as Khoa or Mawa or any other region specific
  // popular name means the product obtained by partial removal of water
  // from any variant of milk with or without added milk solids by
  // heating under controlled conditions." Appendix B1's own microbiology
  // table already treats it as one product row — Sr.14 "Khoa/ Khoa based
  // sweets" — so one category id, no combined-regulation split needed
  // (unlike Ghee/Butter or Ice Cream/Frozen Dessert).
  {
    id: "khoa", label: "Khoa / Mawa", regulation: "2.1.6", live: true, keywords: ["khoa", "mawa"],
    definition: 'Khoa — by whatever name it is sold, such as Khoa or Mawa or any other region specific popular name — means the product obtained by partial removal of water from any variant of milk, with or without added milk solids, by heating under controlled conditions.',
    definitionRef: "FSS 2.1.6, Item 1 — Standard for Khoa",
  },
  {
    // Brought live per your "START ICE CREAM, FROZEN DESSERT" go-ahead —
    // see DAIRY_PRODUCTS.ice_cream below for the full 13-sub-type schema
    // (built directly from the primary FSSAI text via /tmp/chapter21.txt,
    // Reg. 2.1.14 and 2.1.15) and what is/isn't encoded. One category id
    // combines both regulations, same pattern as Ghee/Butter (2.1.8/
    // 2.1.9) — Sr.9 of Appendix B1's own microbiology table already
    // groups "Ice Cream, Frozen Dessert, Milk Lolly, Ice Candy" as ONE
    // product row, so treating them as one Inspeckt category matches the
    // regulator's own grouping, not just a convenience.
    id: "ice_cream", label: "Ice Cream / Frozen Dessert", regulation: "2.1.14 / 2.1.15", live: true, keywords: ["ice cream", "frozen dessert", "kulfi", "milk lolly", "milk ice", "ice candy"],
    definition: '"Ice-Cream, Kulfi, Chocolate Ice Cream or Softy Ice-Cream" means the frozen milk product obtained by freezing a pasteurized mix prepared from milk or other products derived from milk, or both, with or without nutritive sweeteners and other permitted non-dairy ingredients — frozen hard, except softy ice-cream, which may be frozen to a soft consistency. A separate, related standard covers "Frozen Dessert or Frozen Confection" — the product obtained by freezing a pasteurised mix prepared with edible vegetable oils/fats (melting point ≤37°C) or vegetable protein products, or both, which may also contain milk fat and other milk solids — a real product-category difference from Ice Cream, not just a citation footnote, since it\'s built around vegetable fat rather than milk fat.',
    definitionRef: "FSS 2.1.14, Item 1 (Ice Cream) and FSS 2.1.15, Item 1 (Frozen Dessert)",
  },
];

/** Best-matching category id for free text, regardless of `live` status —
 * generalizes detectLiveCategoryId() below for review item C17's
 * research-vs-formulation fork, which applies to live AND not-live
 * categories alike (unlike detectLiveCategoryId(), which is deliberately
 * live-only so a not-live keyword can never route someone into a check
 * the product can't actually run). Same longest-keyword-wins matching;
 * callers still need their own NON_DAIRY_ANALOGUE_KEYWORDS check first,
 * same as detectLiveCategoryId()'s callers already do. */
export function detectAnyCategoryId(text) {
  const q = text.toLowerCase();
  let best = null;
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (q.includes(kw) && (!best || kw.length > best.kw.length)) best = { cat, kw };
    }
  }
  return best ? best.cat.id : null;
}

/** Keywords for sub-categories that are actually checkable today. Used
 * anywhere a match should mean "route into a live check" — the
 * homepage search box and the chat intro's category detection. */
export function liveDairyKeywords() {
  return CATEGORIES.filter((c) => c.live).flatMap((c) => c.keywords);
}
/** Every dairy keyword, live or not — used only for "is this a
 * recognizable dairy product at all" checks (e.g. the generic "dairy"
 * catch-all), never for deciding whether to run a live check. */
export function allDairyKeywords() {
  return [...CATEGORIES.flatMap((c) => c.keywords), "dairy"];
}
/** Which live-category id (if any) a free-text query names.
 *
 * Matches the LONGEST keyword found anywhere in the text, across every
 * category (live or not), and only returns an id if that longest match
 * belongs to a live category. Plain substring matching against only the
 * live keywords isn't enough: "milk" (live) is itself a substring of
 * "milk powder" (live:false), so a query like "milk powder 500g" used
 * to match the live "milk" keyword and get routed into a live check for
 * a product that was never actually checked — the same class of bug as
 * the yogurt-keyword-drift bug, just running the other direction
 * (mis-routing INTO a live check instead of leaking a non-live keyword
 * OUT). Preferring the longest match — "milk powder" over "milk" — is
 * what a human reading the same text would do, and it's decided purely
 * from CATEGORIES/keywords, so no new hand-written exception list. */
export function detectLiveCategoryId(text) {
  const q = text.toLowerCase();
  let best = null;
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (q.includes(kw) && (!best || kw.length > best.kw.length)) best = { cat, kw };
    }
  }
  return best && best.cat.live ? best.cat.id : null;
}

// Words that mean "this is a dairy analogue/alternative, not real dairy" —
// checked BEFORE any dairy-keyword match, because a phrase like
// "soy-based cheese analogue" contains "cheese" but isn't something our
// Dairy Bible data (real-milk composition standards) applies to. Getting
// this wrong would let someone believe a non-dairy product was checked
// against a standard it was never subject to. Single source — was
// previously duplicated verbatim in both site-controller.js and
// landing.js, which is exactly the kind of copy that can quietly drift.
export const NON_DAIRY_ANALOGUE_KEYWORDS = [
  "vegan", "plant-based", "plant based", "soy", "soya", "almond", "cashew",
  "oat milk", "coconut milk", "nut milk", "non-dairy", "non dairy",
  "dairy-free", "dairy free", "analogue", "analog", "imitation", "vegan cheese",
];

// ---------------------------------------------------------------
// 1b. COMBINATION / MULTI-COMPONENT PRODUCT DETECTION
// ---------------------------------------------------------------
// New Submission Classification Logic spec §4-6: a keyword match may
// only ever nominate a CANDIDATE standard — it must never, by itself,
// establish a classification. The concrete gap that created: a
// description that merely CONTAINS a standardized food ("a snack bar
// with paneer bits and honey") used to hit detectAnyCategoryId()'s
// "paneer" keyword and get treated as if the finished product WERE
// paneer, silently inheriting one ingredient's standard for the whole
// product (the exact thing §5/§13 prohibit). There's no live model call
// in this static build to actually read the description the way a
// person would, so this is built the same way everything else here is —
// signal-counting over the same CATEGORIES keyword data — not true
// comprehension. It answers two narrower, honest questions instead:
// "how many distinct standardized foods does this text name" and "does
// it use language that suggests components are being combined." Either
// signal means "don't silently fork into one category" — ask, rather
// than guess. See handleIntro()/renderCompositeCheck() in
// site-controller.js for how these signals are consumed; nothing here
// decides UI, only detection.
export const COMPOSITE_MARKER_PHRASES = [
  "containing", "contains", "blend of", "mix of", "mixture of",
  "combined with", "combination of", "topped with", "filled with",
  "coated with", "coated in", "infused with", "stuffed with",
  "made from", "made with", "along with", "together with",
  "fortified with", "enriched with", "as well as",
];

/** Every DISTINCT category (live or not) whose keywords appear anywhere
 * in the text — the "candidate identification" step (spec §4), kept
 * separate from any single "best match" so a caller can see when more
 * than one candidate is plausible instead of only ever being handed one
 * winner. Each candidate carries the longest keyword that category
 * matched on. Deliberately does NOT special-case "milk" here — every
 * dairy category's own FSSAI definition derives from milk, so a caller
 * that wants to treat "milk" as a base-ingredient descriptor rather
 * than a competing product claim (e.g. "buffalo milk paneer" naming
 * paneer, not a milk-and-paneer combination) does that filtering itself
 * — see handleIntro()'s comment for why that carve-out belongs at the
 * call site, not baked into detection. */
export function detectCategoryCandidates(text) {
  const q = text.toLowerCase();
  const byCategory = new Map();
  for (const cat of CATEGORIES) {
    let bestKw = null;
    for (const kw of cat.keywords) {
      if (q.includes(kw) && (!bestKw || kw.length > bestKw.length)) bestKw = kw;
    }
    if (bestKw) byCategory.set(cat.id, { id: cat.id, label: cat.label, kw: bestKw, live: cat.live });
  }
  return [...byCategory.values()].sort((a, b) => b.kw.length - a.kw.length);
}

/** True when the text contains a phrase suggesting the description names
 * a COMBINATION of components being put together into a (possibly new)
 * finished product, rather than describing one standardized food on its
 * own. A signal, not a proof — see the module comment above. */
export function hasCompositeMarker(text) {
  const q = text.toLowerCase();
  return COMPOSITE_MARKER_PHRASES.some((p) => q.includes(p));
}

// ---------------------------------------------------------------
// 2. HEAT TREATMENTS — milk's shelf-life driver (a processing choice
//    the FBO makes, not a property of the milk type itself, so this
//    stays its own lookup rather than living inside a milk sub-type).
// ---------------------------------------------------------------
export const HEAT_TREATMENTS = {
  pasteurised: { name: "Pasteurised (63°C / 30min)", shelf_days: 3, storage_temp: "2-6°C" },
  alt_pasteurised: { name: "Alternative Pasteurisation (72°C / 15s)", shelf_days: 3, storage_temp: "2-6°C" },
  boiled: { name: "Boiled (100°C)", shelf_days: 2, storage_temp: "2-6°C" },
  sterilised: { name: "Sterilised (≥115°C / 15min)", shelf_days: 30, storage_temp: "Ambient (sealed)" },
  uht: { name: "UHT (≥135°C / 1s)", shelf_days: 90, storage_temp: "Ambient (aseptic pack, unopened)" },
  raw: { name: "Raw / Untreated", shelf_days: 1, storage_temp: "2-6°C — must be labelled 'Raw'" },
};

// ---------------------------------------------------------------
// 3. MILK — cross-cutting fields that apply to every milk sub-type
//    (adulteration caps, not composition-by-type) — kept separate
//    from DAIRY_PRODUCTS.milk[subtype].fields for that reason, but
//    still plain schema, still walked generically by runComposition().
// ---------------------------------------------------------------
export const MILK_CATEGORY_FIELDS = [
  {
    key: "sodium", reportLabel: "Sodium", shortLabel: "Sodium",
    rule: "max", max: 650, unit: " mg/100g SNF",
    ref: "FSS 2.1.2, Note (iii)", severity: "HIGH", optional: true,
  },
  {
    key: "urea", reportLabel: "Urea", shortLabel: "Urea",
    rule: "max", max: 700, unit: " ppm",
    ref: "FSS 2.1.2, Item 4(b)", severity: "MEDIUM", optional: true,
  },
];
// Back-compat named export some call sites still read directly.
export const MILK_CROSS_CUTTING = {
  max_sodium_mg_per_100g_snf: { value: 650, ref: "FSS 2.1.2, Note (iii)" },
  max_urea_ppm: { value: 700, ref: "FSS 2.1.2, Item 4(b)" },
};

// ---------------------------------------------------------------
// 4. DAIRY_PRODUCTS — the schema. One object per category, one entry
//    per sub-type, each fully described by `fields` (composition
//    rules), `shelfLife` (paneer/cheese — static per sub-type), and
//    `microKey` (which MICRO_LIMITS bucket it uses). This is the
//    object the fix plan asked for: "every category/sub-type is fully
//    described by one data object — nothing about it lives in JS
//    logic."
// ---------------------------------------------------------------
export const DAIRY_PRODUCTS = {
  milk: {
    // CORRECTED per your explicit sign-off ("Chapter_2_1_...pdf —
    // authoritative document"): the primary gazetted text (Chapter 2.1,
    // Version 3, 07.05.2025), Reg. 2.1.2 Item 2(b) table, gives ONE
    // flat All-India row per species — there is no "Group A/B/C" system
    // anywhere in this document (searched the full extracted text for
    // the word "Group": zero matches). The Group A/B/C numbers and the
    // 6.0% Buffalo figure below came from the Dairy Bible document
    // instead, and conflict with the primary text. This was actually
    // already fixed once before (see the historical "Regulatory
    // corrections" table in README.md — Buffalo Milk 5.0%/9.0%, flat
    // Cow Milk) and was later regressed back to the Bible's numbers by
    // a subsequent review pass that trusted the Bible over the primary
    // text. Quoting the source table exactly (Sr. No. / Class / Locality
    // or State / Minimum Milk Fat / Minimum SNF, all "All India"):
    //   1. Buffalo Milk   5.0   9.0
    //   2. Cow Milk       3.2   8.3
    //   3. Goat Milk      3.0   8.0
    //   4. Camel Milk     2.0   6.0
    //   5. Mixed Milk     4.5   8.5
    //   6. Standardized Milk 4.5 8.5
    //   7. Toned Milk     3.0   8.5
    //   8. Double Toned Milk 1.3 9.0
    //   9. Skimmed Milk   (max 0.5) 8.7
    //  10. Full Cream Milk 6.0  9.0
    //  11. Sheep Milk     3.0   9.0
    buffalo_milk: {
      name: "Buffalo Milk", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 1 (Buffalo Milk, All India)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 5.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 1 (Buffalo Milk, All India)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 9.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 1 (Buffalo Milk, All India)", severity: "CRITICAL" },
      ],
    },
    // Replaces the three cow_milk_group_a/b/c entries — the primary
    // text has no state-group system for Cow Milk, just one All-India
    // row. State-routing (the old "Section F3" idea) is moot now: there
    // is nothing to route to.
    cow_milk: {
      name: "Cow Milk", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 2 (Cow Milk, All India)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 3.2, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 2 (Cow Milk, All India)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.3, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 2 (Cow Milk, All India)", severity: "CRITICAL" },
      ],
    },
    // New — Camel Milk is a real row (Sr. 4) in the primary text and was
    // simply never added to the code at all, under any of its prior
    // reviews.
    camel_milk: {
      name: "Camel Milk", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 4 (Camel Milk, All India)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 2.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 4 (Camel Milk, All India)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 6.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 4 (Camel Milk, All India)", severity: "CRITICAL" },
      ],
    },
    full_cream_milk: {
      name: "Full Cream Milk", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Full Cream Milk)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 6.0, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Full Cream Milk)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 9.0, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Full Cream Milk)", severity: "CRITICAL" },
      ],
    },
    // Fix per review item A6: standardised_milk and toned_milk both used
    // to cite the same fabricated "Table Row 7" — they can't both be row
    // 7, and in fact the Bible's actual Ch 1.2 "Milk Type 7-13" table has
    // NO row numbers at all (unlike Types 1-6, which have real numbered
    // section headers). Every All-India-standard milk type below now
    // cites that table by name, not a row number that isn't there.
    standardised_milk: {
      name: "Standardised Milk", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Standardised Milk)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 4.5, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Standardised Milk)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Standardised Milk)", severity: "CRITICAL" },
      ],
    },
    // Corrected comment (numbers unchanged): the primary text's Item
    // 2(b) table has no "Recombined Milk" row at all — Item 1(c) instead
    // defines Recombined Milk as one of the raw-material paths INTO
    // Full Cream/Standardised/Toned/Double Toned/Skimmed Milk, which
    // then takes on whichever of those standards it's sold as. Keeping
    // this as its own selectable entry (matching Standardised Milk's
    // 4.5%/8.5%, the most common recombined designation) rather than
    // deleting it, since an FBO may reach for it by that name — but it
    // isn't a distinct numbered standard in the source, unlike every
    // other entry in this object.
    recombined_milk: {
      name: "Recombined Milk", ref: "FSS 2.1.2, Item 1(c) + Item 2(b) Sr. 6 (raw-material path, sold as Standardised Milk)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 4.5, unit: "%", ref: "FSS 2.1.2, Item 1(c) + Item 2(b) Sr. 6 (raw-material path, sold as Standardised Milk)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.2, Item 1(c) + Item 2(b) Sr. 6 (raw-material path, sold as Standardised Milk)", severity: "CRITICAL" },
      ],
    },
    toned_milk: {
      name: "Toned Milk", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Toned Milk)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Toned Milk)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Toned Milk)", severity: "CRITICAL" },
      ],
    },
    // CORRECTED: the primary text's table (Sr. 8, itself an amendment
    // insert) gives Double Toned Milk's fat the same "Minimum Milk Fat"
    // column as every other row — 1.3%, no upper bound stated in this
    // table. Changed from an invented "between 1.3-1.5%" band to a plain
    // minimum, matching every other row's shape.
    double_toned_milk: {
      name: "Double Toned Milk", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 8 (Double Toned Milk, All India)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 1.3, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 8 (Double Toned Milk, All India)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 9.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 8 (Double Toned Milk, All India)", severity: "CRITICAL" },
      ],
    },
    // Was two check rows (a checkMin(0) that always trivially passed,
    // plus a bolted-on checkMax) because 0% is a valid "minimum" that
    // happens to make checkMin meaningless — a special case hand-added
    // around the generic helpers. A plain "between" rule (0–0.5%) is
    // the same requirement, expressed once, with no special case for
    // the next person to trip on. This is *the* skimmed-milk fix.
    skimmed_milk: {
      name: "Skimmed Milk", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Skimmed Milk)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 0.0, max: 0.5, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Skimmed Milk)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.7, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Skimmed Milk)", severity: "CRITICAL" },
      ],
    },
    mixed_milk: {
      name: "Mixed Milk", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Mixed Milk)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 4.5, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Mixed Milk)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.2, Ch 1.2 — All-India Standards (Mixed Milk)", severity: "CRITICAL" },
      ],
    },
    // CORRECTED: Goat Milk and Sheep Milk are two separate All-India
    // rows in the primary text (Sr. 3 and Sr. 11), not one combined
    // Group A/B standard — that combined-standard idea, like Cow Milk's
    // groups, doesn't exist in this document. Goat Milk's SNF corrected
    // 9.0% -> 8.0% to match Sr. 3 exactly; Sheep Milk was already
    // correct (Sr. 11 also gives 3.0%/9.0%).
    goat_milk: {
      name: "Goat Milk", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 3 (Goat Milk, All India)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 3 (Goat Milk, All India)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 8.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 3 (Goat Milk, All India)", severity: "CRITICAL" },
      ],
    },
    sheep_milk: {
      name: "Sheep Milk", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 11 (Sheep Milk, All India)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 11 (Sheep Milk, All India)", severity: "CRITICAL" },
        { key: "snf", reportLabel: "SNF (Solids-Not-Fat)", shortLabel: "SNF (Solids-Not-Fat)", rule: "min", min: 9.0, unit: "%", ref: "FSS 2.1.2, Item 2(b) — Table, Sr. 11 (Sheep Milk, All India)", severity: "CRITICAL" },
      ],
    },
  },

  // ---------------------------------------------------------------
  // Flavoured Milk (FSS 2.1.3 — "Standard for Flavoured Milk")
  // ---------------------------------------------------------------
  // Item 2(c) Composition, quoted directly: "Flavoured Milk shall have
  // the same minimum percentage of milk fat and milk solids-not-fat as
  // that of the milk, as provided for in the Standard for Milk, from
  // which it is prepared." No fixed numbers of its own — architecturally
  // identical to Plain Dahi's situation (see DAIRY_PRODUCTS.yogurt.
  // plain_dahi above), so it reuses the exact same `computed:
  // "milk_cross_reference"` mechanism: validation.js's
  // runMilkCrossReferenceComposition() / validation_engine.py's
  // _run_milk_cross_reference_composition() look Fat/SNF up live from
  // DAIRY_PRODUCTS.milk[input.milk_type] (Python: MILK_TYPES), keyed by
  // a `milk_type` input collected alongside the (single) sub-type
  // selector — same "cross-reference Milk live" pattern, no duplicated
  // numbers, no independent-drift risk.
  //
  // Only one product is defined under this standard (the flavouring
  // itself carries no separate compositional tiers) — like Khoa, this
  // category has exactly one sub-type, handled by the existing generic
  // architecture with no special-casing.
  //
  // One documented gap: Item 1's own two-sentence dried/concentrated
  // clause ("Where flavoured milk is dried or concentrated, the dried or
  // concentrated product on addition of prescribed amount of water shall
  // give a product conforming to the requirements of flavoured milk.")
  // describes a reconstitution equivalence, not a distinct product with
  // its own numbers — nothing to encode beyond the wet-product rule
  // already built.
  flavoured_milk: {
    flavoured_milk: {
      name: "Flavoured Milk",
      ref: "FSS 2.1.3, Item 2(c) — Composition",
      computed: "milk_cross_reference",
      // Appendix B1's own microbiology table groups "Pasteurized/boiled
      // Milk/ Flavored Milk" as ONE product row (Sr.1) — the same row
      // already coded as MICRO_LIMITS.milk (see that bucket's own
      // comment, which already noted it covers flavoured milk even
      // before this category was built). No separate MICRO_LIMITS
      // bucket is created for Flavoured Milk; this override just points
      // specFor()'s generic `microKey || categoryId` resolution at the
      // existing "milk" bucket instead of a nonexistent "flavoured_milk"
      // one.
      microKey: "milk",
      fields: [],
      // Matched to Milk's own general shelf-life treatment (this
      // category has no HEAT_TREATMENTS-driven lookup of its own the
      // way plain Milk does, so a single reasonable figure is used
      // instead, same operational-estimate caveat as every other
      // shelfLife value in this file) rather than treated as a dried
      // powder — Item 1 describes flavoured milk as a liquid product by
      // default (the dried/concentrated form is only a reconstitution
      // equivalence, not this category's primary shape).
      shelfLife: { days: 3, storageTemp: "2-6°C" },
    },
  },

  // Evaporated / Concentrated Milk (FSS 2.1.4 — "Standard for Evaporated
  // or Concentrated Milk"), second of the 11 Chapter 2.1 standards found
  // completely uncovered — see the flavoured_milk comment above for the
  // full list and go-ahead. Item 2(c) Composition table, quoted directly
  // (Milk fat / Milk solids / Milk protein in SNF, all %, m/m):
  //
  //   Parameter         | Evap. milk | Evap. partly skimmed | Evap. skimmed | Evap. high fat
  //   Milk fat, min/max  | 7.5 (min)  | >1 and <7.5           | 1.0 (max)     | 15.0 (min)
  //   Milk solids, min   | 25.0       | 20.0                  | 20.0          | 26.5
  //   Milk protein in SNF, min | 34.0 | 34.0                  | 34.0          | 34.0
  //
  // Evaporated partly skimmed milk's open interval ">1 and <7.5" is coded
  // as an inclusive 1.0–7.5 "between" rule — same boundary-choice pattern
  // already used for Paneer's Medium Fat tier (see that comment above):
  // the adjacent Evaporated Skimmed Milk (max 1.0%) and Evaporated Milk
  // (min 7.5%) tiers already cover both exact boundary values, so nothing
  // passes that isn't covered by some tier. Item 6(a)'s proviso — "the
  // 'evaporated partly skimmed milk' may be designated 'evaporated semi-
  // skimmed milk' when the content of milk fat is between 4.0-4.5% (m/m)
  // and minimum milk solids is 24% (m/m)" — is an alternate label name
  // for a narrower band within the same tier, not a fifth product; not
  // separately encoded, same treatment as other purely-nomenclature
  // provisos elsewhere in this file.
  //
  // Microbiology: Appendix B1 Sr.3 ("Sterilized milk /UHT milk /
  // Evaporated Milk") reads "NA" across every numeric CFU column —
  // confirmed against the PDF's actual table structure via pdfplumber's
  // extract_tables(), not just the flattened text extraction, which can
  // silently misplace cells. No MICRO_LIMITS entry here, same
  // composition-only treatment as Ghee/Butter (see that category's own
  // comment on `COMPOSITION_ONLY_CATEGORIES` in checks/check-
  // citations.mjs). A separate qualitative note on the same page —
  // "Sterilized /UHT milk products shall comply with a test for
  // commercial sterility as per IS: 4238 (Appendix C or Appendix D)" — is
  // a pass/fail lab procedure, not a numeric limit this schema's min/max/
  // between rules can express; documented as a gap, not encoded, same
  // treatment as Milk Powder's ordinal "Scorched particles, Disc B" test.
  evaporated_milk: {
    evaporated_milk: {
      name: "Evaporated Milk",
      ref: "FSS 2.1.4, Item 2(c) — Composition (Evaporated milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 7.5, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated milk column)", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 25.0, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated milk column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.4, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      // Grouped with Sterilized/UHT milk in Appendix B1 Sr.3 (canned,
      // heat-sterilized, shelf-stable) — an operational estimate, not
      // itself an FSSAI-mandated figure, same caveat as every other
      // shelfLife value in this file.
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    evaporated_partly_skimmed_milk: {
      name: "Evaporated Partly Skimmed Milk",
      ref: "FSS 2.1.4, Item 2(c) — Composition (Evaporated partly skimmed milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 1.0, max: 7.5, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated partly skimmed milk column) — source wording \"More than 1 and Less than 7.5\", see this category's own comment above for the inclusive-boundary choice", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 20.0, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated partly skimmed milk column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.4, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    evaporated_skimmed_milk: {
      name: "Evaporated Skimmed Milk",
      ref: "FSS 2.1.4, Item 2(c) — Composition (Evaporated skimmed milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.0, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated skimmed milk column)", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 20.0, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated skimmed milk column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.4, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    evaporated_high_fat_milk: {
      name: "Evaporated High Fat Milk",
      ref: "FSS 2.1.4, Item 2(c) — Composition (Evaporated high fat milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 15.0, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated high fat milk column)", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 26.5, unit: "%", ref: "FSS 2.1.4, Item 2(c) (Evaporated high fat milk column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.4, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Sweetened Condensed Milk (FSS 2.1.5 — "Standard for Sweetened
  // Condensed Milk"), third of the 11 Chapter 2.1 standards found
  // completely uncovered — see the flavoured_milk comment above for the
  // full list and go-ahead. Item 2(c) Composition table, quoted directly
  // (all %, m/m; "--" cells are genuinely blank in the source, not
  // encoded as fabricated limits, same treatment as Milk Powder's Cream
  // Powder "--" cells):
  //
  //   Parameter            | Sw. cond. milk | Sw. cond. partly skimmed | Sw. cond. skimmed | Sw. cond. high fat
  //   Milk fat, min/max     | 8.0 (min)      | >1.0 and <8.0             | 1.0 (max)          | 16.0 (min)
  //   Milk solids, min      | 28.0           | 24.0                      | 24.0               | --
  //   Milk solid-not-fat, min | --           | 20.0                      | --                 | 14.0
  //   Milk protein in SNF, min | 34.0        | 34.0                      | 34.0               | 34.0
  //
  // Sweetened Condensed Partly Skimmed Milk's open interval ">1.0 and
  // <8.0" is coded as an inclusive 1.0–8.0 "between" rule, same boundary-
  // choice pattern as Evaporated Partly Skimmed Milk and Paneer's Medium
  // Fat tier — the adjacent Skimmed (max 1.0%) and plain (min 8.0%)
  // tiers already cover both exact boundary values. Item 6(a)'s "Sweetened
  // condensed semi-skimmed milk" alias (fat 4.0-4.5%, solids min 28%) is
  // a narrower-band alternate name within the same tier, not a fifth
  // product — not separately encoded, same treatment as Evaporated
  // Milk's identical semi-skimmed proviso.
  //
  // Microbiology: Appendix B1 Sr.5 ("Sweetened Condensed Milk") DOES have
  // a real panel, unlike Evaporated Milk's all-"NA" Sr.3 — confirmed via
  // pdfplumber's extract_tables(): APC m=500/M=1000 (n=5,c=3), Coliform
  // m=10 (n=5,c=0, 2-class — no M), Staphylococcus aureus m=10 (n=5,c=0,
  // 2-class), Yeast & Mould m=10 (n=5,c=0, 2-class), E. coli entirely
  // "NA" (not tested). Table 2B: Salmonella "Absent/25g" and Listeria
  // "Absent/g", both presence tests, same shape as every other category's
  // Table 2B.
  //
  // Two documented gaps, neither encodable by this schema's numeric
  // rules: Item 6(b) — "Sweetened condensed milks which are not suitable
  // for infant feeding shall not contain any instruction of modifying
  // them for infant feeding" — is a labelling PROHIBITION (must NOT
  // contain X), not a "declared" checkbox this app's label-element
  // pattern expresses; and Appendix B1's own footnote 6 — "The Sweetened
  // condensed milk product shall comply accelerated storage test as per
  // IS: 1166 (latest version)" — is a qualitative pass/fail lab
  // procedure, same treatment as Evaporated Milk's commercial-sterility
  // gap.
  sweetened_condensed_milk: {
    sweetened_condensed_milk: {
      name: "Sweetened Condensed Milk",
      ref: "FSS 2.1.5, Item 2(c) — Composition (Sweetened condensed milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 8.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed milk column)", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 28.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed milk column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.5, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    sweetened_condensed_partly_skimmed_milk: {
      name: "Sweetened Condensed Partly Skimmed Milk",
      ref: "FSS 2.1.5, Item 2(c) — Composition (Sweetened condensed partly skimmed milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 1.0, max: 8.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed partly skimmed milk column) — source wording \"More than 1.0 and less than 8.0\", see this category's own comment above for the inclusive-boundary choice", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 24.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed partly skimmed milk column)", severity: "CRITICAL" },
        { key: "msnf", reportLabel: "Milk Solids-Not-Fat ({name})", shortLabel: "Milk Solids-Not-Fat", rule: "min", min: 20.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed partly skimmed milk column)", severity: "HIGH" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.5, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    sweetened_condensed_skimmed_milk: {
      name: "Sweetened Condensed Skimmed Milk",
      ref: "FSS 2.1.5, Item 2(c) — Composition (Sweetened condensed skimmed milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed skimmed milk column)", severity: "CRITICAL" },
        { key: "milk_solids", reportLabel: "Milk Solids ({name})", shortLabel: "Milk Solids", rule: "min", min: 24.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed skimmed milk column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.5, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    sweetened_condensed_high_fat_milk: {
      name: "Sweetened Condensed High Fat Milk",
      ref: "FSS 2.1.5, Item 2(c) — Composition (Sweetened condensed high fat milk column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 16.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed high fat milk column)", severity: "CRITICAL" },
        { key: "msnf", reportLabel: "Milk Solids-Not-Fat ({name})", shortLabel: "Milk Solids-Not-Fat", rule: "min", min: 14.0, unit: "%", ref: "FSS 2.1.5, Item 2(c) (Sweetened condensed high fat milk column)", severity: "HIGH" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.5, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Cream and Malai (FSS 2.1.7 — "Standard for Cream and Malai"), fourth
  // of the 11 Chapter 2.1 standards found completely uncovered — see the
  // flavoured_milk comment above for the full list and go-ahead. Unlike
  // every prior category, Item 2(c) Composition gives only ONE numeric
  // rule that applies uniformly, quoted directly: "The product shall
  // contain minimum 10.0 per cent. (m/m) milk fat. Acidity of the
  // finished products, other than fermented and acidified creams, should
  // not be more than 0.15% (as lactic acid)." "The product" here covers
  // every form named in Item 1 — plain Cream, Reconstituted/Recombined
  // Cream, every "Prepared cream" (pre-packaged liquid, whipping,
  // pressure-packed, whipped, fermented/cultured/sour, acidified) AND
  // Malai (Item 2(a)'s Raw Material clause groups "All creams, prepared
  // creams and malai" together) — there is no separate, higher fat floor
  // or distinct composition table for any of these named forms, so this
  // is a single-tier category by design, not an under-built one.
  //
  // Item 6(b)'s Low/Medium/High Fat Cream bands ("Minimum 10% and less
  // than 40%" / "Minimum 40% and less than 60%" / "Minimum 60%") are a
  // voluntary LABELLING convention for how a cream may describe itself
  // once its actual fat content is known — not three independent
  // composition standards with three different QA minimums, the way
  // Paneer's Standard/Medium/Low Fat tiers are. Encoding them as extra
  // composition sub-types would fabricate a mandatory-tier structure the
  // source doesn't set up (a 45%-fat product isn't out of compliance for
  // being "only" Low Fat — it just may not call itself "High fat cream"),
  // so this stays one `cream` sub-type with the one real composition
  // number, and the label declaration is tracked instead — see
  // "cream_fat_content_declared" in LABEL_ELEMENTS_BY_CATEGORY.cream
  // below.
  //
  // Acidity's exemption for "fermented and acidified creams" (Item
  // 1(d)(v)/(vi)) can't be evaluated without a cream-type selector this
  // single-sub-type category doesn't have — encoded as an optional field
  // with a hint explaining the exemption, same "optional, conditional"
  // pattern as Milk's own sodium/urea fields, rather than silently
  // applied to every submission regardless of type.
  //
  // Microbiology: Appendix B1 Sr.2 ("Pasteurized Cream") gives Cream a
  // real panel of its own — confirmed via pdfplumber's extract_tables():
  // APC m=5x10^4/g=50000, M=7.5x10^4/g=75000 (n=5,c=3); Coliform m=<10/g
  // (n=5,c=0, 2-class, no M); Staph aureus/Yeast & Mould/E. coli all "NA"
  // (not tested for this row). Table 2B: Salmonella and Listeria both
  // "Absent/25g" (presence tests). Sr.4 ("Sterilized/ UHT Cream") is a
  // separate row, all "NA" plus a qualitative "shall comply with a test
  // for commercial sterility as per IS: 4884" note — same shape as
  // Evaporated Milk's Sr.3 gap, but not separately encoded as its own
  // sub-type here: this app doesn't split Milk's own composition or
  // microbiology by heat treatment either (Sr.1 "Pasteurized/boiled Milk"
  // is MICRO_LIMITS.milk's one fixed bucket regardless of the
  // heat_treatment field selected), so Cream follows that same
  // established precedent rather than introducing heat-treatment-based
  // sub-typing for the first time here. Documented as a gap, not encoded.
  //
  // Malai has NO Appendix B1 row of its own — grep of the full extracted
  // text finds "Malai" only in Item 1(e)'s definition and Item 6(a)'s
  // naming clause, never in either microbiology table. Extending Cream's
  // Sr.2 panel to Malai by analogy would be exactly the kind of unsourced
  // assumption this whole review has been trying to eliminate (Malai's
  // own texture — "insoluble mass, principally fat and denatured
  // protein" — is nothing like Cream's fluid emulsion), so `malai` is
  // given `microKey: "malai_gap"`, a deliberately nonexistent bucket —
  // same "explicit gap, not silent default" pattern as Ice Cream's
  // `dried_frozen_dessert_mix_gap` (see that comment above). This
  // correctly produces NOT_AVAILABLE via runMicrobiology()'s null-return
  // path in validation.js, rather than inheriting Cream's real panel or
  // silently returning no microbiology signal at all.
  cream: {
    cream: {
      name: "Cream",
      ref: "FSS 2.1.7, Item 2(c) — Composition",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.7, Item 2(c) — Composition", severity: "CRITICAL" },
        { key: "acidity", reportLabel: "Acidity, as lactic acid ({name})", shortLabel: "Acidity", rule: "max", max: 0.15, unit: "%", ref: "FSS 2.1.7, Item 2(c) — Composition (\"other than fermented and acidified creams\")", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    malai: {
      name: "Malai",
      ref: "FSS 2.1.7, Item 2(c) — Composition (shared with Cream — see Item 2(a)'s \"All creams, prepared creams and malai\" Raw Material grouping)",
      // See the long comment above DAIRY_PRODUCTS.cream for why this
      // points at a deliberately nonexistent bucket instead of Cream's
      // real one or a bare categoryId fallback.
      microKey: "malai_gap",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.7, Item 2(c) — Composition", severity: "CRITICAL" },
        { key: "acidity", reportLabel: "Acidity, as lactic acid ({name})", shortLabel: "Acidity", rule: "max", max: 0.15, unit: "%", ref: "FSS 2.1.7, Item 2(c) — Composition (\"other than fermented and acidified creams\")", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 2, storageTemp: "2-6°C" },
    },
  },

  // Dairy Whitener (FSS 2.1.11 — "Standard for Dairy Whitener"), fifth of
  // the 11 Chapter 2.1 standards found completely uncovered — see the
  // flavoured_milk comment above for the full list and go-ahead. Item
  // 2's Composition table, quoted directly (all %, m/m unless noted):
  //
  //   Parameter                | Skimmed | Low Fat        | Medium Fat      | High Fat
  //   Moisture, max            | 4.0     | 4.0            | 4.0             | 4.0
  //   Milk Fat                 | 1.5 max | >1.5 and <10.0 | >=10.0 and <20.0| 20.0 min
  //   Milk protein in SNF, min | 34.0    | 34.0           | 34.0            | 34.0
  //   Insolubility Index, max (ml) | 1.5 | 1.5            | 1.5             | 1.5
  //   Total ash (moisture/added sugar/fat free basis), max | 9.3 | 9.3   | 9.3             | 9.3
  //   Acid Insoluble ash, max  | 0.1     | 0.1            | 0.1             | 0.1
  //   Added sugar (as sucrose), max | 18.0 | 18.0         | 18.0            | 18.0
  //   Titratable acidity, max (as lactic acid) | 1.5 | 1.5 | 1.5           | 1.2
  //
  // Low Fat's open interval ">1.5 and <10.0" and Medium Fat's half-open
  // "minimum 10.0 and less than 20.0" are both coded as inclusive
  // `between` rules (1.5–10.0 and 10.0–20.0), same boundary-choice
  // pattern already used for Evaporated Milk/Sweetened Condensed Milk's
  // partly-skimmed tiers and Paneer's Medium Fat band — the adjacent
  // Skimmed (max 1.5) and High Fat (min 20.0) tiers already cover both
  // outer boundary values, so nothing passes that isn't covered by some
  // tier. Insolubility Index's own ceiling here (1.5 ml) is tighter than
  // Milk Powder's identically-named field (2.0 ml, FSS 2.1.10) — a
  // different standard for a different product, not a typo; each keeps
  // its own sourced number. Titratable Acidity uses its own key/unit (%
  // as lactic acid) rather than Milk Powder's differently-measured
  // "titrable_acidity" (ml 0.1N NaOH/10g SNF) — same key/unit already
  // established for Khoa and Yogurt/Dahi's acidity fields, since this is
  // a genuinely different measurement basis, not the same field renamed.
  // Added Sugar's own footnote — "Added sugar up to a level of 24% shall
  // be permissible up to two years from the date of final notification"
  // — is a time-limited transitional allowance tied to a notification
  // date this document doesn't give a fixed anchor for; not encoded as a
  // second, higher limit (the standing 18.0% ceiling is what's coded),
  // documented here as a gap rather than guessed at.
  //
  // Item 6(a)'s four label names — "(i) Skimmed Milk Dairy Whitener, (ii)
  // Low Fat Dairy Whitener, (iii) Medium Fat Dairy Whitener, (iv) High
  // Fat Dairy Whitener, as appropriate" — are exactly this category's 4
  // sub-type names below, tracked as a "type declared" label element,
  // same pattern as Ghee/Yogurt/Ice Cream/Evaporated Milk/Sweetened
  // Condensed Milk above (see LABEL_ELEMENTS_BY_CATEGORY.dairy_whitener).
  //
  // "Scorched particles, maximum: Disc B" (Sr.9 of the composition
  // table) is the exact same ordinal, undefined-scale test already
  // documented as a gap on Milk Powder — not encoded here either, same
  // reasoning: the source doesn't define the disc scale's own ordering,
  // and guessing at a pass/fail rule for it would risk coding a wrong
  // one.
  //
  // Microbiology: Appendix B1 Sr.7 explicitly names "Dairy Whitener" as
  // one of the products sharing this row alongside Milk Powder — this
  // category reuses MICRO_LIMITS.milk_powder wholesale via `microKey:
  // "milk_powder"` on every sub-type, rather than a duplicate bucket
  // (same reuse pattern as Dried Ice Cream Mix's own `microKey:
  // "milk_powder"` above, confirming the same Sr.7 row already covers
  // both).
  dairy_whitener: {
    skimmed_milk_dairy_whitener: {
      name: "Skimmed Milk Dairy Whitener", microKey: "milk_powder",
      ref: "FSS 2.1.11, Item 2 — Composition (Skimmed Milk Dairy Whitener column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.11, Item 2, footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 1.5, unit: " ml", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture/added sugar/fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "MEDIUM" },
        { key: "acid_insoluble_ash", reportLabel: "Acid Insoluble Ash ({name})", shortLabel: "Acid Insoluble Ash", rule: "max", max: 0.1, unit: "%", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "MEDIUM" },
        { key: "added_sugar", reportLabel: "Added Sugar, as sucrose ({name})", shortLabel: "Added Sugar", rule: "max", max: 18.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "MEDIUM" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, as lactic acid ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.11, Item 2 (Skimmed Milk Dairy Whitener column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    low_fat_dairy_whitener: {
      name: "Low Fat Dairy Whitener", microKey: "milk_powder",
      ref: "FSS 2.1.11, Item 2 — Composition (Low Fat Dairy Whitener column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 1.5, max: 10.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column) — source wording \"More than 1.5 and less than 10.0\", see this category's own comment above for the inclusive-boundary choice", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.11, Item 2, footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 1.5, unit: " ml", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture/added sugar/fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "acid_insoluble_ash", reportLabel: "Acid Insoluble Ash ({name})", shortLabel: "Acid Insoluble Ash", rule: "max", max: 0.1, unit: "%", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "added_sugar", reportLabel: "Added Sugar, as sucrose ({name})", shortLabel: "Added Sugar", rule: "max", max: 18.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, as lactic acid ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.11, Item 2 (Low Fat Dairy Whitener column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    medium_fat_dairy_whitener: {
      name: "Medium Fat Dairy Whitener", microKey: "milk_powder",
      ref: "FSS 2.1.11, Item 2 — Composition (Medium Fat Dairy Whitener column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 10.0, max: 20.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column) — source wording \"Minimum 10.0 and less than 20.0\", see this category's own comment above for the inclusive-boundary choice", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.11, Item 2, footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 1.5, unit: " ml", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture/added sugar/fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "acid_insoluble_ash", reportLabel: "Acid Insoluble Ash ({name})", shortLabel: "Acid Insoluble Ash", rule: "max", max: 0.1, unit: "%", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "added_sugar", reportLabel: "Added Sugar, as sucrose ({name})", shortLabel: "Added Sugar", rule: "max", max: 18.0, unit: "%", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, as lactic acid ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.11, Item 2 (Medium Fat Dairy Whitener column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    high_fat_dairy_whitener: {
      name: "High Fat Dairy Whitener", microKey: "milk_powder",
      ref: "FSS 2.1.11, Item 2 — Composition (High Fat Dairy Whitener column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 20.0, unit: "%", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein in Milk Solids-Not-Fat ({name})", shortLabel: "Milk Protein in SNF", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.11, Item 2, footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 1.5, unit: " ml", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture/added sugar/fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "acid_insoluble_ash", reportLabel: "Acid Insoluble Ash ({name})", shortLabel: "Acid Insoluble Ash", rule: "max", max: 0.1, unit: "%", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "added_sugar", reportLabel: "Added Sugar, as sucrose ({name})", shortLabel: "Added Sugar", rule: "max", max: 18.0, unit: "%", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column)", severity: "MEDIUM" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, as lactic acid ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.2, unit: "%", ref: "FSS 2.1.11, Item 2 (High Fat Dairy Whitener column) — the one field that differs from the other 3 tiers (1.5% there, 1.2% here)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Whey Powder (FSS 2.1.12 — "Standard for Whey Powder"), sixth of the
  // 11 Chapter 2.1 standards found completely uncovered — see the
  // flavoured_milk comment above for the full list and go-ahead. Item
  // 2(c)'s Composition table, quoted directly:
  //
  //   Parameter                                | Whey Powder      | Acid Whey Powder
  //   Moisture, max %                          | 5.0              | 4.5
  //   Milk fat, max %                          | 2.0              | 2.0
  //   Milk protein, min %                      | 10.0             | 7.0
  //   Lactose content (as anhydrous), min %    | 61.0             | 61.0
  //   pH (in 10% solution)                     | more than 5.1    | 5.1 (maximum)
  //   Total ash, max % (on dry basis)          | 9.5              | 15.0
  //
  // pH's own footnotes (iv)/(v) give an ALTERNATE test method for the
  // exact same requirement — "Or titratable acidity (calculated as
  // lactic acid) <0.35%" for Whey Powder, "...>=0.35%" for Acid Whey
  // Powder — not a second, additional requirement. This schema has no
  // "either field A or field B" alternate-test mechanism, and adding a
  // titratable_acidity field alongside pH would risk a false FAIL for a
  // product that's compliant via the acidity route but wasn't tested for
  // pH (or vice versa) — so only pH (the table's primary listed measure)
  // is encoded; the titratable-acidity alternative is documented here as
  // a gap, not modeled. Whey Powder's own "more than 5.1" is coded as an
  // inclusive min 5.1 — same boundary-choice reasoning as every other
  // open-interval tier this session (Evaporated Milk, Sweetened
  // Condensed Milk, Dairy Whitener): Acid Whey Powder's own ceiling
  // (max 5.1) already covers the exact boundary value, and a submission
  // only ever checks the ONE sub-type actually declared.
  //
  // Microbiology: Appendix B1 Sr.7 explicitly names "Whey based Powder"
  // alongside Milk Powder/Dairy Whitener/Cream Powder/etc. as one shared
  // row — both sub-types reuse MICRO_LIMITS.milk_powder wholesale via
  // `microKey: "milk_powder"`, same reuse pattern as Dairy Whitener
  // above, rather than a duplicate bucket.
  whey_powder: {
    whey_powder: {
      name: "Whey Powder", microKey: "milk_powder",
      ref: "FSS 2.1.12, Item 2(c) — Composition (Whey Powder column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Whey Powder column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Whey Powder column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein ({name})", shortLabel: "Milk Protein", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.12, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "lactose_content", reportLabel: "Lactose Content, as anhydrous lactose ({name})", shortLabel: "Lactose Content", rule: "min", min: 61.0, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Whey Powder column)", severity: "HIGH" },
        { key: "ph", reportLabel: "pH, in 10% solution ({name})", shortLabel: "pH", rule: "min", min: 5.1, unit: "", ref: "FSS 2.1.12, Item 2(c) (Whey Powder column) — source wording \"more than 5.1\", see this category's own comment above for the inclusive-boundary choice and the not-encoded titratable-acidity alternative", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, on dry basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.5, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Whey Powder column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    acid_whey_powder: {
      name: "Acid Whey Powder", microKey: "milk_powder",
      ref: "FSS 2.1.12, Item 2(c) — Composition (Acid Whey Powder column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 4.5, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Acid Whey Powder column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Acid Whey Powder column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein ({name})", shortLabel: "Milk Protein", rule: "min", min: 7.0, unit: "%", ref: "FSS 2.1.12, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "lactose_content", reportLabel: "Lactose Content, as anhydrous lactose ({name})", shortLabel: "Lactose Content", rule: "min", min: 61.0, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Acid Whey Powder column)", severity: "HIGH" },
        { key: "ph", reportLabel: "pH, in 10% solution ({name})", shortLabel: "pH", rule: "max", max: 5.1, unit: "", ref: "FSS 2.1.12, Item 2(c) (Acid Whey Powder column) — see this category's own comment above for the not-encoded titratable-acidity alternative", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, on dry basis ({name})", shortLabel: "Total Ash", rule: "max", max: 15.0, unit: "%", ref: "FSS 2.1.12, Item 2(c) (Acid Whey Powder column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Edible Casein Products (FSS 2.1.18 — "Standard for Edible Casein
  // Products"), seventh of the 11 Chapter 2.1 standards found completely
  // uncovered — see the flavoured_milk comment above for the full list
  // and go-ahead. Item 2(c)'s Composition table, quoted directly (via
  // pdfplumber's extract_tables(), which is what caught the Edible
  // Rennet Casein Total Ash row's MINIMUM designation below — it's split
  // across a page break in the flattened text and easy to misread as a
  // maximum like the other two columns):
  //
  //   Parameter                                | Edible Acid Casein | Edible Rennet Casein | Edible Caseinate
  //   Moisture, max %                          | 12.0               | 12.0                  | 8.0
  //   Milk fat, max %                          | 2.0                | 2.0                   | 2.0
  //   Milk protein, min % (dry matter basis)   | 90.0               | 84.0                  | 88.0
  //   Casein in protein, min %                 | 95.0               | 95.0                  | 95.0
  //   Lactose, max %                           | 1.0                | 1.0                   | 1.0
  //   Total ash incl. P2O5, %                  | 2.5 (MAXIMUM)      | 7.5 (MINIMUM)         | -- (no limit stated)
  //   Free acid, max ml 0.1N NaOH/g            | 0.27               | -- (no limit stated)  | -- (no limit stated)
  //   pH (in 10% solution), max                | -- (no limit stated) | -- (no limit stated) | 8.0
  //
  // Edible Rennet Casein's Total Ash row is the one genuine trap here:
  // the source table's own continuation row (top of the next page) reads
  // "(minimum)" directly under its 7.5 value — a real, deliberate
  // asymmetry from Edible Acid Casein's "(maximum)" 2.5% on the same
  // parameter, not a transcription slip — so it's coded as `rule: "min"`,
  // not `"max"`, unlike every other field here. Edible Caseinate's Total
  // Ash cell is blank ("--") — no fabricated limit, same "--"
  // blank-cell precedent as Cream Powder/Ghee's Peroxide Value. Free
  // Acid and pH are each stated for exactly one sub-type (Edible Acid
  // Casein and Edible Caseinate respectively) — no field for the other
  // two sub-types' blank cells on those rows either.
  //
  // Microbiology: while researching this category's own Appendix B1
  // row, found that Sr.7 — the same shared row Dairy Whitener/Whey
  // Powder above reuse via `microKey: "milk_powder"` — carries a
  // footnote restricting its Yeast and Mould Count criterion to Casein
  // Powder specifically (see the long comment on MICRO_LIMITS.milk_powder
  // above). So this category does NOT reuse `microKey: "milk_powder"`
  // like Dairy Whitener/Whey Powder did — it gets its own dedicated
  // MICRO_LIMITS.casein_products bucket below (same APC/Coliform/Staph
  // aureus/Table 2B numbers as Milk Powder's row, correctly PLUS the
  // Yeast and Mould criterion this footnote reserves for Casein).
  casein_products: {
    edible_acid_casein: {
      name: "Edible Acid Casein", microKey: "casein_products",
      ref: "FSS 2.1.18, Item 2(c) — Composition (Edible Acid Casein column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 12.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Acid Casein column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Acid Casein column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, dry matter basis ({name})", shortLabel: "Milk Protein", rule: "min", min: 90.0, unit: "%", ref: "FSS 2.1.18, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "casein_in_protein", reportLabel: "Casein in Protein ({name})", shortLabel: "Casein in Protein", rule: "min", min: 95.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Acid Casein column)", severity: "HIGH" },
        { key: "lactose_content", reportLabel: "Lactose ({name})", shortLabel: "Lactose", rule: "max", max: 1.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Acid Casein column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, including P2O5 ({name})", shortLabel: "Total Ash", rule: "max", max: 2.5, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Acid Casein column)", severity: "MEDIUM" },
        { key: "free_acid", reportLabel: "Free Acid, as ml 0.1N NaOH per g ({name})", shortLabel: "Free Acid", rule: "max", max: 0.27, unit: " ml/g", ref: "FSS 2.1.18, Item 2(c) (Edible Acid Casein column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 365, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    edible_rennet_casein: {
      name: "Edible Rennet Casein", microKey: "casein_products",
      ref: "FSS 2.1.18, Item 2(c) — Composition (Edible Rennet Casein column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 12.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Rennet Casein column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Rennet Casein column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, dry matter basis ({name})", shortLabel: "Milk Protein", rule: "min", min: 84.0, unit: "%", ref: "FSS 2.1.18, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "casein_in_protein", reportLabel: "Casein in Protein ({name})", shortLabel: "Casein in Protein", rule: "min", min: 95.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Rennet Casein column)", severity: "HIGH" },
        { key: "lactose_content", reportLabel: "Lactose ({name})", shortLabel: "Lactose", rule: "max", max: 1.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Rennet Casein column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, including P2O5 ({name})", shortLabel: "Total Ash", rule: "min", min: 7.5, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Rennet Casein column) — this column's own row is a MINIMUM, unlike Edible Acid Casein's maximum on the same parameter; confirmed via pdfplumber's extract_tables() against the table's own page-break continuation row", severity: "MEDIUM" },
      ],
      shelfLife: { days: 365, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    edible_caseinate: {
      name: "Edible Caseinate", microKey: "casein_products",
      ref: "FSS 2.1.18, Item 2(c) — Composition (Edible Caseinate column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 8.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Caseinate column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Caseinate column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, dry matter basis ({name})", shortLabel: "Milk Protein", rule: "min", min: 88.0, unit: "%", ref: "FSS 2.1.18, Item 2(c), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "casein_in_protein", reportLabel: "Casein in Protein ({name})", shortLabel: "Casein in Protein", rule: "min", min: 95.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Caseinate column)", severity: "HIGH" },
        { key: "lactose_content", reportLabel: "Lactose ({name})", shortLabel: "Lactose", rule: "max", max: 1.0, unit: "%", ref: "FSS 2.1.18, Item 2(c) (Edible Caseinate column)", severity: "MEDIUM" },
        // Total Ash: the source table shows "--" for Edible Caseinate's cell.
        { key: "ph", reportLabel: "pH, in 10% solution ({name})", shortLabel: "pH", rule: "max", max: 8.0, unit: "", ref: "FSS 2.1.18, Item 2(c) (Edible Caseinate column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 365, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Edible Lactose (FSS 2.1.20 — "Standards for Edible Lactose"), eighth
  // of the 11 further Chapter 2.1 standards — see the casein_products
  // comment above for the full list and go-ahead. Item 2(b)'s
  // Composition table, quoted directly (single-column "Limits", no
  // sub-type split — this is the one category so far with only one
  // product form):
  //
  //   Parameter                                   | Limit
  //   Total moisture, max %                       | 6.0
  //   Lactose, min % (m/m), on dry basis           | 99.0
  //   Sulphated ash, max %                         | 0.3
  //   pH (10% solution)                            | 4.5 - 7.0
  //   Scorched particle, maximum                   | Disc B
  //
  // "Sulphated ash" is a different, named test from the "Total Ash
  // (including P2O5)" field used elsewhere in this chapter — kept as
  // its own `sulphated_ash` key rather than reusing `total_ash`, so a
  // report never implies the two tests are interchangeable. "Scorched
  // particle, maximum: Disc B" is NOT encoded — same documented gap,
  // same reasoning, as Milk Powder's and Ghee's own Disc-B ordinal scale
  // (see DAIRY_PRODUCTS.milk_powder's comment above): a categorical
  // result graded against a physical disc standard, not a number a
  // min/max/between rule can check.
  //
  // Labelling: Item 6 only requires the product name ("edible lactose")
  // plus the generic Packaging & Labelling Regs 2011 — both already
  // covered by the universal LABEL_ELEMENTS_ALL list, so no
  // LABEL_ELEMENTS_BY_CATEGORY.edible_lactose entry is added below
  // (same precedent as milk_powder having none).
  //
  // Microbiology: confirmed via this category's own Appendix B1 check
  // (see the CATEGORIES.edible_lactose comment above) that "Lactose" is
  // named directly on Sr.7's shared row, ahead of the footnote-3 marker
  // that restricts Yeast and Mould Count to Casein Powder specifically —
  // so this reuses `microKey: "milk_powder"` exactly like Dairy
  // Whitener/Whey Powder, not a dedicated bucket like Casein Products.
  //
  // Shelf life: FSS 2.1.20 states no shelf-life figure (it never does
  // for this chapter's dry products) — 730 days is this build's own
  // estimate, on the high end of this session's dry-powder range,
  // because crystalline lactose carries no milk fat to oxidize and its
  // own moisture ceiling (6.0%) is tighter than Milk Powder's;
  // reconsider if you have real accelerated-shelf-life data.
  edible_lactose: {
    edible_lactose: {
      name: "Edible Lactose", microKey: "milk_powder",
      ref: "FSS 2.1.20, Item 2(b) — Composition",
      fields: [
        { key: "moisture", reportLabel: "Total Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 6.0, unit: "%", ref: "FSS 2.1.20, Item 2(b)", severity: "HIGH" },
        { key: "lactose_content", reportLabel: "Lactose, on dry basis ({name})", shortLabel: "Lactose", rule: "min", min: 99.0, unit: "%", ref: "FSS 2.1.20, Item 2(b)", severity: "CRITICAL" },
        { key: "sulphated_ash", reportLabel: "Sulphated Ash ({name})", shortLabel: "Sulphated Ash", rule: "max", max: 0.3, unit: "%", ref: "FSS 2.1.20, Item 2(b)", severity: "MEDIUM" },
        { key: "ph", reportLabel: "pH, in 10% solution ({name})", shortLabel: "pH", rule: "between", min: 4.5, max: 7.0, unit: "", ref: "FSS 2.1.20, Item 2(b)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 730, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Milk Protein Concentrate (FSS 2.1.21), ninth of the 11 further
  // Chapter 2.1 standards — see the casein_products comment above for
  // the full list and go-ahead. Item 2(b)'s Composition table, quoted
  // directly (single-column "Limits", one product form like Edible
  // Lactose above):
  //
  //   Parameter                                    | Limit
  //   Moisture, max %                              | 6.0
  //   Milk Protein, min % (footnote: 6.38 x N)      | 40.0
  //   Insolubility index, max (ml)                  | 2.0
  //   Total ash, max % (on dry basis)                | 10.0
  //   Scorched particles, maximum                   | Disc B (15 mg)
  //
  // "Scorched particles, maximum: Disc B" is NOT encoded — same
  // documented ordinal-scale gap as Milk Powder/Ghee/Edible Lactose
  // above. Item 4's own Hygiene clause explicitly says "shall conform to
  // the microbiological requirements specified for milk powder in
  // Appendix 'B'" — a direct textual cross-reference, not an inferred
  // Appendix B1 shared-row match like Dairy Whitener/Whey Powder/Edible
  // Lactose needed — so `microKey: "milk_powder"` is used here too.
  // Item 5(b) requires "The milk protein content shall be declared on
  // the label as a percentage by mass" — a real, distinct labelling
  // requirement, not just the generic product name — tracked as
  // `milk_protein_content_declared` in LABEL_ELEMENTS_BY_CATEGORY below
  // (shared with Whey Protein Concentrate, which carries the identical
  // clause verbatim).
  milk_protein_concentrate: {
    milk_protein_concentrate: {
      name: "Milk Protein Concentrate", microKey: "milk_powder",
      ref: "FSS 2.1.21, Item 2(b) — Composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 6.0, unit: "%", ref: "FSS 2.1.21, Item 2(b)", severity: "HIGH" },
        { key: "protein", reportLabel: "Milk Protein ({name})", shortLabel: "Milk Protein", rule: "min", min: 40.0, unit: "%", ref: "FSS 2.1.21, Item 2(b), footnote — protein content is 6.38 × total nitrogen", severity: "CRITICAL" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 2.0, unit: " ml", ref: "FSS 2.1.21, Item 2(b)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, on dry basis ({name})", shortLabel: "Total Ash", rule: "max", max: 10.0, unit: "%", ref: "FSS 2.1.21, Item 2(b)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 365, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Whey Protein Concentrate (FSS 2.1.22), tenth of the 11 further
  // standards, built right after Milk Protein Concentrate. Item 2(b)'s
  // Composition table, quoted directly (single-column "Limits", one
  // product form):
  //
  //   Parameter                                    | Limit
  //   Moisture, max %                              | 6.0
  //   Milk Protein, min % (footnote: 6.38 x N)      | 35.0
  //   Milk Fat, max %                               | 10
  //   Scorched particles, maximum                   | Disc B (15 mg)
  //
  // Same not-encoded Disc B gap as above. Item 4's own Hygiene clause:
  // "shall conform to the microbiological requirements specified for
  // whey based powder in Appendix 'B'" — "whey based powder" is the
  // exact product name Appendix B1 Sr.7 already shares with Milk
  // Powder/Dairy Whitener (see DAIRY_PRODUCTS.whey_powder's own comment
  // above), so `microKey: "milk_powder"` applies here for the same
  // underlying reason, this time stated directly in FSS 2.1.22's own
  // text rather than inferred from Appendix B1 alone. Item 5(b) carries
  // the identical "milk protein content ... as a percentage by mass"
  // labelling clause as Milk Protein Concentrate above — same
  // `milk_protein_content_declared` label element.
  whey_protein_concentrate: {
    whey_protein_concentrate: {
      name: "Whey Protein Concentrate", microKey: "milk_powder",
      ref: "FSS 2.1.22, Item 2(b) — Composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 6.0, unit: "%", ref: "FSS 2.1.22, Item 2(b)", severity: "HIGH" },
        { key: "protein", reportLabel: "Milk Protein ({name})", shortLabel: "Milk Protein", rule: "min", min: 35.0, unit: "%", ref: "FSS 2.1.22, Item 2(b), footnote — protein content is 6.38 × total nitrogen", severity: "CRITICAL" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 10, unit: "%", ref: "FSS 2.1.22, Item 2(b)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Colostrum Products (FSS 2.1.23), eleventh and last of the 11 further
  // standards found missing during the full table-of-contents audit —
  // see the flavoured_milk comment above for the full list and
  // go-ahead. Item 2's two Composition tables, quoted directly:
  //
  //   Parameter                          | Colostrum (I) | Colostrum Powder (II)
  //   Appearance                         | Creamy yellow colour | Creamy yellow colour
  //   Odour                              | Characteristic and pleasant | (same)
  //   Taste                              | Characteristic and pleasant | (same)
  //   Moisture, max %                    | 80.0          | 4.0
  //   Protein, min % (footnote: 6.38xN)  | 7.0           | 40.0
  //   Fat, min %                         | 4.0           | 17.5
  //   Total ash, max % (dry basis)       | -- (not stated) | 9.0
  //   Immunoglobulins, min %             | 1.8           | 12.5
  //   Lactoferrin, min %                 | 0.2           | 1.2
  //   Scorched particles, maximum        | -- (not stated) | Disc B (15 mg)
  //
  // Appearance/Odour/Taste are organoleptic descriptors, not numeric or
  // clean binary results (unlike Ghee's Baudouin Test negative/positive)
  // — NOT encoded, documented gap, same reasoning as the not-encoded
  // Disc B ordinal scale elsewhere in this chapter.
  //
  // The Immunoglobulins row on BOTH tables carries an "Amendment of
  // highlighted provision" box, quoted directly: "Immunoglobulins-G
  // (IgG), minimum, %, (m/m)" replaces the plain "Immunoglobulins" row,
  // "in force on 1st May, 2025." For Colostrum, the amended figure is
  // the SAME number (1.8%) — just a renamed, more specific parameter.
  // For Colostrum Powder, the amended figure is DIFFERENT — 8.5%, not
  // the original 12.5% — a real, lower requirement, not a rename. Per
  // this session's "primary text always wins, permanently" rule, and
  // since the amendment's own in-force date has already passed, both
  // sub-types below are coded with the CURRENT (amended) IgG figures —
  // 1.8% and 8.5% respectively, as `igg`, labelled "Immunoglobulins-G
  // (IgG)" — reading only the original "Immunoglobulins, minimum, 12.5%"
  // row for Colostrum Powder would code a since-superseded, too-strict
  // number.
  //
  // Item 5's Labelling clause cites "sub-item (a)" -> "colostrum" and
  // "sub-item (b)" -> "colostrum powder", but Item 1 actually defines
  // THREE sub-items — (a) Colostrum, (b) Colostrum-based products, (c)
  // Colostrum powder — so "sub-item (b)" as written doesn't match
  // "Colostrum powder" (that's sub-item (c)). Quoted exactly as the
  // primary text has it — an apparent drafting inconsistency in the
  // source itself, not a transcription error here. The two sub-types
  // below follow the Composition section's own unambiguous (I)/(II)
  // headers instead of guessing which lettering the Labelling clause
  // "really" meant; a `colostrum_type_declared` label element (mirroring
  // Edible Casein Products' `casein_type_declared`) tracks the
  // resulting "colostrum" vs "colostrum powder" naming requirement.
  //
  // Item 4's Hygiene clause covers both sub-types in one sentence:
  // "shall conform to the microbiological requirements specified for
  // milk powder in Appendix 'B'" — same direct textual cross-reference
  // pattern as Milk Protein Concentrate above, so both sub-types carry
  // `microKey: "milk_powder"` even though Colostrum itself is a liquid,
  // not a powder — that's what the primary text actually says, not an
  // assumption made here.
  colostrum_products: {
    colostrum: {
      name: "Colostrum", microKey: "milk_powder",
      ref: "FSS 2.1.23, Item 2(I)(a) — Composition (Colostrum)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 80.0, unit: "%", ref: "FSS 2.1.23, Item 2(I)(a)", severity: "HIGH" },
        { key: "protein", reportLabel: "Protein ({name})", shortLabel: "Protein", rule: "min", min: 7.0, unit: "%", ref: "FSS 2.1.23, Item 2(I)(a), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "fat", reportLabel: "Fat ({name})", shortLabel: "Fat", rule: "min", min: 4.0, unit: "%", ref: "FSS 2.1.23, Item 2(I)(a)", severity: "HIGH" },
        { key: "igg", reportLabel: "Immunoglobulins-G (IgG) ({name})", shortLabel: "IgG", rule: "min", min: 1.8, unit: "%", ref: "FSS 2.1.23, Item 2(I)(a), amendment in force 1 May 2025 (supersedes the original 'Immunoglobulins' row — same 1.8% figure, renamed to IgG specifically)", severity: "CRITICAL" },
        { key: "lactoferrin", reportLabel: "Lactoferrin ({name})", shortLabel: "Lactoferrin", rule: "min", min: 0.2, unit: "%", ref: "FSS 2.1.23, Item 2(I)(a)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 2, storageTemp: "Refrigerated (0–4°C)" },
    },
    colostrum_powder: {
      name: "Colostrum Powder", microKey: "milk_powder",
      ref: "FSS 2.1.23, Item 2(II)(b) — Composition (Colostrum Powder)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.23, Item 2(II)(b)", severity: "HIGH" },
        { key: "protein", reportLabel: "Protein ({name})", shortLabel: "Protein", rule: "min", min: 40.0, unit: "%", ref: "FSS 2.1.23, Item 2(II)(b), footnote — protein content is 6.38 × total nitrogen", severity: "HIGH" },
        { key: "fat", reportLabel: "Fat ({name})", shortLabel: "Fat", rule: "min", min: 17.5, unit: "%", ref: "FSS 2.1.23, Item 2(II)(b)", severity: "HIGH" },
        { key: "total_ash", reportLabel: "Total Ash, on dry basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.0, unit: "%", ref: "FSS 2.1.23, Item 2(II)(b)", severity: "MEDIUM" },
        { key: "igg", reportLabel: "Immunoglobulins-G (IgG) ({name})", shortLabel: "IgG", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.23, Item 2(II)(b), amendment in force 1 May 2025 (supersedes the original 'Immunoglobulins, minimum, 12.5%' row — a genuinely LOWER figure, not a rename; see this category's own comment above)", severity: "CRITICAL" },
        { key: "lactoferrin", reportLabel: "Lactoferrin ({name})", shortLabel: "Lactoferrin", rule: "min", min: 1.2, unit: "%", ref: "FSS 2.1.23, Item 2(II)(b)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 365, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Dairy Permeate Powders (FSS 2.1.24) — see the CATEGORIES entry above
  // for how this standard was found and the sourcing note. Three named
  // sub-types (Item 1(a)/(b)/(c)) share one Composition table (Item 2(c))
  // with different numbers per column, confirmed via pdfplumber's
  // `extract_tables()`: Lactose (anhydrous) >=76.0% for all three;
  // Nitrogen <=1.1%/1.1%/0.8%; Milk Fat <=1.5% for all three; Ash
  // <=14.0%/12.0%/12.0%; Moisture <=5.0% for all three. "Ash" is kept as
  // its own field name (not "Total Ash") since that's the table's own
  // label, distinct from this chapter's "Total Ash" fields elsewhere.
  // "Scorched particles, maximum: Disc B" is the same not-encoded ordinal
  // gap as every other dry powder this session. No shelf-life figure is
  // stated in FSS 2.1.24 (this chapter's dry products never state one) —
  // 180 days is this build's own estimate, matching Milk Powder/Whey
  // Powder's own estimate rather than Edible Lactose's longer 730-day one,
  // since permeate powders retain ash/mineral content like ordinary dried
  // dairy solids rather than being pure crystalline sugar; flag it if you
  // have real accelerated-shelf-life data.
  //
  // Item 5's Labelling clause, quoted directly: "the name of the food
  // shall be 'lactose-rich deproteinized ………………permeate powder' where the
  // blank may be filled with the term dairy, milk or whey, as appropriate
  // to the nature of the product." — the sub-type IS the mandated name, so
  // a `permeate_powder_type_declared` label element tracks that the
  // correct one of the three names is actually on the label, same "type
  // declared" pattern as Casein/Colostrum above.
  //
  // Item 4's Hygiene clause, quoted directly: "The products shall conform
  // to the microbiological requirements specified for milk powders in
  // Appendix 'B' of these regulations." — a direct textual redirect
  // covering all three sub-types, so all three carry `microKey:
  // "milk_powder"`.
  dairy_permeate_powders: {
    dairy_permeate_powder: {
      name: "Dairy Permeate Powder", microKey: "milk_powder",
      ref: "FSS 2.1.24, Item 2(c) — Composition (Dairy permeate powder)",
      fields: [
        { key: "lactose", reportLabel: "Lactose, Anhydrous ({name})", shortLabel: "Lactose", rule: "min", min: 76.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "CRITICAL" },
        { key: "nitrogen", reportLabel: "Nitrogen ({name})", shortLabel: "Nitrogen", rule: "max", max: 1.1, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "HIGH" },
        { key: "milk_fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "MEDIUM" },
        { key: "ash", reportLabel: "Ash ({name})", shortLabel: "Ash", rule: "max", max: 14.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "MEDIUM" },
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    whey_permeate_powder: {
      name: "Whey Permeate Powder", microKey: "milk_powder",
      ref: "FSS 2.1.24, Item 2(c) — Composition (Whey permeate powder)",
      fields: [
        { key: "lactose", reportLabel: "Lactose, Anhydrous ({name})", shortLabel: "Lactose", rule: "min", min: 76.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "CRITICAL" },
        { key: "nitrogen", reportLabel: "Nitrogen ({name})", shortLabel: "Nitrogen", rule: "max", max: 1.1, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "HIGH" },
        { key: "milk_fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "MEDIUM" },
        { key: "ash", reportLabel: "Ash ({name})", shortLabel: "Ash", rule: "max", max: 12.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "MEDIUM" },
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    milk_permeate_powder: {
      name: "Milk Permeate Powder", microKey: "milk_powder",
      ref: "FSS 2.1.24, Item 2(c) — Composition (Milk permeate powder)",
      fields: [
        { key: "lactose", reportLabel: "Lactose, Anhydrous ({name})", shortLabel: "Lactose", rule: "min", min: 76.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "CRITICAL" },
        { key: "nitrogen", reportLabel: "Nitrogen ({name})", shortLabel: "Nitrogen", rule: "max", max: 0.8, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "HIGH" },
        { key: "milk_fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "MEDIUM" },
        { key: "ash", reportLabel: "Ash ({name})", shortLabel: "Ash", rule: "max", max: 12.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "MEDIUM" },
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.24, Item 2(c)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // Fix per review item C17 follow-up: the earlier A8/A9/A10 fixes below
  // (kept struck through in history, not in this comment) were based on
  // the Dairy Bible documents' own Ch 5 text and its "Between 15% and
  // 50% is NOT valid" reference algorithm — reasoning this comment used
  // to rely on to delete a "Medium Fat" tier entirely. Reading the actual
  // primary FSSAI regulation text directly (Chapter 2.1, "Version 3
  // (07.05.2025)", Reg. 2.1.16 Item 2(c), page 56) shows that reasoning
  // was wrong: a real "Medium fat Chhana or Paneer" tier exists, and the
  // Bible's own rejection algorithm doesn't match the gazetted standard.
  // The primary text also distinguishes Chhana from Paneer by name, with
  // a tighter moisture ceiling for Paneer specifically:
  //
  //   Parameter          | Chhana or Paneer | Medium fat          | Low fat
  //   Moisture, max % m/m | 65.0 (Chhana)    | 65.0 (Chhana)       | 70.0 (both)
  //                       | 60.0 (Paneer)    | 60.0 (Paneer)       |
  //   Milk fat, % dry basis | 50.0 (minimum)  | >20.0 and <50.0    | 20.0 (maximum)
  //
  // Six entries below (paneer_* / chhana_* × standard/medium_fat/low_fat)
  // replace the old two (standard/low_fat), reversing the earlier
  // deletion of Medium Fat and splitting Chhana from Paneer, per your
  // sign-off. The Medium Fat band is coded as an inclusive 20.0–50.0
  // "between" rule — the source's own wording is the open interval ">20
  // and <50"; a product entered at exactly 20.0% or 50.0% will also
  // correctly PASS the adjacent Low Fat / Standard tier, so this
  // boundary choice doesn't let anything through that isn't covered by
  // some tier, but note it if you want strict-exclusive boundaries here.
  paneer: {
    paneer_standard: {
      name: "Standard Paneer", ref: "FSS 2.1.16, Item 2(c) — Chhana or Paneer (Paneer column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 60.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Chhana or Paneer (Paneer column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 50.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Chhana or Paneer (Paneer column)", severity: "CRITICAL" },
      ],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    paneer_medium_fat: {
      name: "Medium Fat Paneer", ref: "FSS 2.1.16, Item 2(c) — Medium Fat Chhana or Paneer (Paneer column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 60.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Medium Fat Chhana or Paneer (Paneer column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "between", min: 20.0, max: 50.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Medium Fat Chhana or Paneer (Paneer column)", severity: "CRITICAL" },
      ],
      // FSS 2.1.16, Item 6(b): "'Low Fat Chhana'/'Medium Fat Chhana' and
      // 'Low Fat Paneer'/'Medium Fat Paneer' shall be sold in sealed
      // package only and shall bear the following label declarations
      // depending upon the respective product composition: ...
      // 'MEDIUM FAT PANEER or MEDIUM FAT CHHANA'". Item 6(c): "Every
      // package of Medium Fat Channa and Medium Fat Paneer shall bear
      // the following label, namely: - 'Contains ... % Milk Fat'".
      // Found during the primary-text audit — this sub-type had the
      // composition numbers right but was missing both declarations
      // that Low Fat already carries.
      extraBriefNotes: ["Sold in SEALED package only", '"MEDIUM FAT PANEER" declared', 'Package states "Contains ___% Milk Fat" (FSS 2.1.16, Item 6(c))'],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    paneer_low_fat: {
      name: "Low Fat Paneer", ref: "FSS 2.1.16, Item 2(c) — Low Fat Chhana or Paneer",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 70.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Low Fat Chhana or Paneer", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "max", max: 20.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Low Fat Chhana or Paneer", severity: "HIGH" },
      ],
      extraBriefNotes: ["Sold in SEALED package only", '"LOW FAT PANEER" declared'],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    chhana_standard: {
      name: "Standard Chhana", ref: "FSS 2.1.16, Item 2(c) — Chhana or Paneer (Chhana column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 65.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Chhana or Paneer (Chhana column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 50.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Chhana or Paneer (Chhana column)", severity: "CRITICAL" },
      ],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    chhana_medium_fat: {
      name: "Medium Fat Chhana", ref: "FSS 2.1.16, Item 2(c) — Medium Fat Chhana or Paneer (Chhana column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 65.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Medium Fat Chhana or Paneer (Chhana column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "between", min: 20.0, max: 50.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Medium Fat Chhana or Paneer (Chhana column)", severity: "CRITICAL" },
      ],
      // Same FSS 2.1.16, Item 6(b)/6(c) gap as paneer_medium_fat above —
      // see that entry's comment for the exact quoted source text.
      extraBriefNotes: ["Sold in SEALED package only", '"MEDIUM FAT CHHANA" declared', 'Package states "Contains ___% Milk Fat" (FSS 2.1.16, Item 6(c))'],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    chhana_low_fat: {
      name: "Low Fat Chhana", ref: "FSS 2.1.16, Item 2(c) — Low Fat Chhana or Paneer",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 70.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Low Fat Chhana or Paneer", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "max", max: 20.0, unit: "%", ref: "FSS 2.1.16, Item 2(c) — Low Fat Chhana or Paneer", severity: "HIGH" },
      ],
      extraBriefNotes: ["Sold in SEALED package only", '"LOW FAT CHHANA" declared'],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
  },

  // Fix per review item C17 (see the CATEGORIES comment above for the
  // full source discrepancy): cheese is 2.1.17, confirmed against the
  // founder-provided FSSAI cross-reference table — was briefly "2.1.6"
  // after an earlier fix in this same review that trusted the Dairy
  // Bible document's own (now-superseded) Ch 1.1 table instead.
  // Citations below still point at the Dairy Bible document's own
  // named-variety/generic-category chapter (Ch 11) for the detail — only
  // the FSS clause number changed.
  cheese: {
    cheddar: {
      name: "Cheddar Cheese", ref: "FSS 2.1.17, Ch 11.2 — Variety 1 (Cheddar Cheese)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 39.0, unit: "%", ref: "FSS 2.1.17, Ch 11.2 — Variety 1 (Cheddar Cheese)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 48.0, unit: "%", ref: "FSS 2.1.17, Ch 11.2 — Variety 1 (Cheddar Cheese)", severity: "CRITICAL" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient (waxed/vacuum)" },
    },
    // Cottage Cheese's own Variety 7 table gives fat as 4% "as-is basis"
    // (not dry basis, unlike every other cheese entry here) — checked
    // against Ch 11.1's Generic 4 (Soft Cheese) number of >=20% dry
    // basis at cottage's own <=80% moisture ceiling: 4 / (100-80) * 100
    // = 20%, so the two Bible tables agree once the basis is accounted
    // for. No change from the prior value; confirming the as-is-basis
    // label was already correct, not assumed.
    cottage: {
      name: "Cottage Cheese", ref: "FSS 2.1.17, Ch 11.2 — Variety 7 (Cottage Cheese)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 80.0, unit: "%", ref: "FSS 2.1.17, Ch 11.2 — Variety 7 (Cottage Cheese)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (as-is basis)", shortLabel: "Milk Fat (as-is basis)", rule: "min", min: 4.0, unit: "%", ref: "FSS 2.1.17, Ch 11.2 — Variety 7 (Cottage Cheese)", severity: "CRITICAL" },
      ],
      shelfLife: { days: 14, storageTemp: "2-6°C" },
    },
    // Fix per review item C17 follow-up: the flat "moisture <=60% / fat
    // >=35% dry basis" pair above used to stand in for Mozzarella's real
    // standard. Reading the primary FSSAI text directly (Chapter 2.1,
    // "Version 3 (07.05.2025)", Reg. 2.1.17, "Compositional Standards of
    // Mozzarella Cheese — Table-2", an amendment in force from 1 May
    // 2025) shows there is no single moisture/fat pair at all — it's a
    // 7-row table keyed by Fat-in-Dry-Matter (FDM) band, with separate
    // minimum-dry-matter figures (equivalently, maximum-moisture limits)
    // for "Low moisture" and "High moisture" designations, plus an
    // overall FDM floor (>=18% for Low moisture, >=20% for High
    // moisture) per the table's Note 1. See MOZZARELLA_FDM_BANDS /
    // MOZZARELLA_FDM_FLOOR below and validation.js's
    // runMozzarellaComposition(), which computes FDM from the FBO's
    // entered fat/moisture and looks up the matching band — this
    // sub-type has no plain `fields` array (`computed` marks it instead;
    // check-citations.mjs and golden-tests.mjs both know to treat
    // `computed` specs differently from the generic min/max/between
    // schema everything else here uses).
    mozzarella: {
      name: "Mozzarella", ref: "FSS 2.1.17, Compositional Standards of Mozzarella Cheese — Table-2 (in force 1 May 2025)",
      computed: "mozzarella_fdm",
      fields: [],
      shelfLife: { days: 30, storageTemp: "2-6°C (vacuum packed)" },
    },
    gouda: {
      name: "Gouda", ref: "FSS 2.1.17, Ch 11.2 — Variety 4 (Gouda Cheese)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 43.0, unit: "%", ref: "FSS 2.1.17, Ch 11.2 — Variety 4 (Gouda Cheese)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 48.0, unit: "%", ref: "FSS 2.1.17, Ch 11.2 — Variety 4 (Gouda Cheese)", severity: "CRITICAL" },
      ],
      shelfLife: { days: 90, storageTemp: "2-6°C" },
    },
    // `microKey` points this sub-type at MICRO_LIMITS.cheese_processed
    // instead of the general MICRO_LIMITS.cheese — Part II Ch 6.2
    // documents Processed Cheese/Cheese Spread as having its own,
    // stricter microbiology exception table, separate from the general
    // cheese panel. See MICRO_LIMITS below and validation.js's
    // specFor()-driven microKey resolution.
    //
    // Fix per review item C17 follow-up: the `lactose` field removed
    // below (A6/A8-style, "an unsourced number gets removed") is back.
    // Reading the primary FSSAI text directly (Chapter 2.1, Reg. 2.1.17,
    // Item 2(c)(iv) — "Cheese products" composition table) shows a real
    // Lactose max 5.0% limit for Processed Cheese, which isn't in either
    // Bible document but is in the actual gazetted standard — the same
    // primary-source pass that also fixed Paneer/Chhana and Mozzarella
    // above. Marked `optional`, matching how milk's sodium/urea are
    // treated: a real field with a real citation, but not every lab
    // report tests for it, so an unanswered field produces no row rather
    // than a MISSING one. Severity MEDIUM is my own judgment call (no
    // Bible precedent to match) — a lactose-ceiling breach is a
    // compositional/labelling accuracy issue, not the safety-critical
    // kind — flag if you'd weight this differently.
    processed_cheese: {
      name: "Processed Cheese", ref: "FSS 2.1.17, Ch 11.1 — Generic 8 (Processed Cheese)",
      microKey: "cheese_processed",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 47.0, unit: "%", ref: "FSS 2.1.17, Ch 11.1 — Generic 8 (Processed Cheese)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat (dry basis)", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 40.0, unit: "%", ref: "FSS 2.1.17, Ch 11.1 — Generic 8 (Processed Cheese)", severity: "CRITICAL" },
        { key: "lactose", reportLabel: "Lactose", shortLabel: "Lactose", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.17, Item 2(c)(iv) — Cheese Products (Processed Cheese)", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient (sealed)" },
    },
  },

  // Fix per review item C17 (bring not-live categories live, composition-
  // only — per your confirmed answers): Ghee/Butter, extracted verbatim
  // from the primary FSSAI text (Chapter 2.1, "Version 3 (07.05.2025)",
  // Reg. 2.1.8 "Standard for Milk Fat Products" and Reg. 2.1.9 "Standard
  // for Butter") via /tmp/chapter21.txt (pdftotext -layout). Unlike
  // Milk/Paneer/Cheese's simple Moisture+Fat pair, Reg. 2.1.8's table
  // carries a full quality-factor panel — Butyro-refractometer Reading,
  // Reichert Meissl Value, Polenske Value, FFA as Oleic Acid, Peroxide
  // Value, Baudouin Test, and (Ghee only) Iodine Value and Saponification
  // Value — plus a categorical adulteration check (presence of
  // β-sitosterol). Per your sign-off ("Everything, including categorical
  // tests"), all of it is encoded here, not just Moisture+Milk Fat.
  // Every field beyond Moisture/Milk Fat (and Butter's MSNF/salt) is
  // `optional: true` — same treatment as milk's sodium/urea and cheese's
  // lactose: a real field with a real citation, but not every FBO will
  // have run every one of these lab tests, so an unanswered one produces
  // no row rather than a MISSING one. `rule: "equals"` is a new rule kind
  // (see validation.js's checkEquals()/runFieldCheck()) for the two
  // categorical tests — Baudouin Test and β-sitosterol are adulteration
  // markers (vegetable-oil detection), not physical/compositional
  // quality figures, so a confirmed-positive result is CRITICAL, same
  // severity class as a Milk Fat shortfall, even though the field itself
  // is optional (not every FBO will have run it).
  //
  // NOT encoded (documented gap, not silently dropped): Reg. 2.1.8's
  // Table 1 — a separate 12-row fatty-acid-composition breakdown (by GLC,
  // percentage of total fatty acids) that applies to Ghee specifically.
  // It's a compositional profile, not a single min/max/equals check the
  // existing schema shape can express without a bigger structural change
  // (a 12-row sub-table per entry) — flagged in `extraBriefNotes` below
  // rather than approximated or skipped silently. No microbiology panel
  // yet either, per your "skip microbiology for now" answer — see
  // MICRO_LIMITS below (no `ghee` entry) and validation.js's
  // runMicrobiology()/labSection()'s graceful no-panel handling (a
  // missing panel now reads as "not available yet," not a false PASS or
  // a crash).
  ghee: {
    milk_fat_butter_oil: {
      name: "Milk Fat / Butter Oil",
      ref: "FSS 2.1.8, Item 2(b) — Standards of Milk Fat, Butter Oil, Anhydrous Milk Fat, Anhydrous Butter Oil and Ghee (Milk Fat, Butter Oil column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 0.4, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 99.6, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "CRITICAL" },
        { key: "br_reading", reportLabel: "Butyro-refractometer Reading at 40°C ({name})", shortLabel: "BR Reading", rule: "between", min: 40.0, max: 44.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "rm_value", reportLabel: "Reichert Meissl Value ({name})", shortLabel: "RM Value", rule: "min", min: 24.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "polenske_value", reportLabel: "Polenske Value ({name})", shortLabel: "Polenske Value", rule: "between", min: 0.5, max: 2.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "ffa", reportLabel: "FFA as Oleic Acid ({name})", shortLabel: "FFA (as Oleic Acid)", rule: "max", max: 0.4, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "peroxide_value", reportLabel: "Peroxide Value ({name})", shortLabel: "Peroxide Value", rule: "max", max: 0.6, unit: " meq O2/kg fat", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "baudouin_test", reportLabel: "Baudouin Test ({name})", shortLabel: "Baudouin Test", rule: "equals", equals: "negative", unit: "", ref: "FSS 2.1.8, Item 2(b) (Milk Fat, Butter Oil column) — vegetable-oil adulteration test", severity: "CRITICAL", optional: true },
        { key: "beta_sitosterol", reportLabel: "Presence of β-sitosterol ({name})", shortLabel: "β-sitosterol", rule: "equals", equals: "absent", unit: "", ref: "FSS 2.1.8, Item 2(b), footnote — RP-HPLC vegetable-oil adulteration test (FSSAI Office Order 1-90/FSSAI/SP(MS&A)/2009, 25 Mar 2019)", severity: "CRITICAL", optional: true },
      ],
      shelfLife: { days: 90, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    anhydrous_milk_fat_butter_oil: {
      name: "Anhydrous Milk Fat / Anhydrous Butter Oil",
      ref: "FSS 2.1.8, Item 2(b) — Standards of Milk Fat, Butter Oil, Anhydrous Milk Fat, Anhydrous Butter Oil and Ghee (Anhydrous Milk Fat, Anhydrous Butter Oil column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 0.1, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 99.8, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "CRITICAL" },
        { key: "br_reading", reportLabel: "Butyro-refractometer Reading at 40°C ({name})", shortLabel: "BR Reading", rule: "between", min: 40.0, max: 44.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "rm_value", reportLabel: "Reichert Meissl Value ({name})", shortLabel: "RM Value", rule: "min", min: 24.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "polenske_value", reportLabel: "Polenske Value ({name})", shortLabel: "Polenske Value", rule: "between", min: 0.5, max: 2.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "ffa", reportLabel: "FFA as Oleic Acid ({name})", shortLabel: "FFA (as Oleic Acid)", rule: "max", max: 0.3, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "peroxide_value", reportLabel: "Peroxide Value ({name})", shortLabel: "Peroxide Value", rule: "max", max: 0.3, unit: " meq O2/kg fat", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column)", severity: "MEDIUM", optional: true },
        { key: "baudouin_test", reportLabel: "Baudouin Test ({name})", shortLabel: "Baudouin Test", rule: "equals", equals: "negative", unit: "", ref: "FSS 2.1.8, Item 2(b) (Anhydrous Milk Fat, Anhydrous Butter Oil column) — vegetable-oil adulteration test", severity: "CRITICAL", optional: true },
        { key: "beta_sitosterol", reportLabel: "Presence of β-sitosterol ({name})", shortLabel: "β-sitosterol", rule: "equals", equals: "absent", unit: "", ref: "FSS 2.1.8, Item 2(b), footnote — RP-HPLC vegetable-oil adulteration test (FSSAI Office Order 1-90/FSSAI/SP(MS&A)/2009, 25 Mar 2019)", severity: "CRITICAL", optional: true },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    ghee: {
      name: "Ghee",
      ref: "FSS 2.1.8, Item 2(b) — Standards of Milk Fat, Butter Oil, Anhydrous Milk Fat, Anhydrous Butter Oil and Ghee (Ghee column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 0.5, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 99.5, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "CRITICAL" },
        { key: "br_reading", reportLabel: "Butyro-refractometer Reading at 40°C ({name})", shortLabel: "BR Reading", rule: "between", min: 40.0, max: 44.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "MEDIUM", optional: true },
        { key: "rm_value", reportLabel: "Reichert Meissl Value ({name})", shortLabel: "RM Value", rule: "min", min: 24.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "MEDIUM", optional: true },
        { key: "polenske_value", reportLabel: "Polenske Value ({name})", shortLabel: "Polenske Value", rule: "between", min: 0.5, max: 2.0, unit: "", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "MEDIUM", optional: true },
        { key: "ffa", reportLabel: "FFA as Oleic Acid ({name})", shortLabel: "FFA (as Oleic Acid)", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "MEDIUM", optional: true },
        // Peroxide Value: the source table shows "-" for Ghee specifically
        // (Milk Fat/Butter Oil and Anhydrous Milk Fat/Butter Oil both have
        // real ceilings; Ghee's cell is blank) — no field here, not a
        // fabricated limit.
        { key: "iodine_value", reportLabel: "Iodine Value ({name})", shortLabel: "Iodine Value", rule: "between", min: 25, max: 38, unit: "", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "MEDIUM", optional: true },
        { key: "saponification_value", reportLabel: "Saponification Value ({name})", shortLabel: "Saponification Value", rule: "between", min: 205, max: 235, unit: "", ref: "FSS 2.1.8, Item 2(b) (Ghee column)", severity: "MEDIUM", optional: true },
        { key: "baudouin_test", reportLabel: "Baudouin Test ({name})", shortLabel: "Baudouin Test", rule: "equals", equals: "negative", unit: "", ref: "FSS 2.1.8, Item 2(b) (Ghee column) — vegetable-oil adulteration test", severity: "CRITICAL", optional: true },
        { key: "beta_sitosterol", reportLabel: "Presence of β-sitosterol ({name})", shortLabel: "β-sitosterol", rule: "equals", equals: "absent", unit: "", ref: "FSS 2.1.8, Item 2(b), footnote — RP-HPLC vegetable-oil adulteration test (FSSAI Office Order 1-90/FSSAI/SP(MS&A)/2009, 25 Mar 2019)", severity: "CRITICAL", optional: true },
      ],
      // Note: `extraBriefNotes` isn't used here for the Table 1 fatty-acid
      // gap — that field is rendered as "Label must declare: ..." by
      // fieldBriefBullets() (validation.js), which is right for paneer's
      // low-fat declarations above but wrong for a scope note that isn't
      // a labelling requirement. The gap is documented in the long
      // comment above this schema instead.
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    // Fix per review item C17: Reg. 2.1.9's own Note says "the extracted
    // fat from butter shall meet the standards for Reichert Meissl value
    // and Butyro-refractometer reading as prescribed for ghee" — so both
    // butter sub-types below carry those two fields too (optional, same
    // Ghee-column numbers), not just Moisture/Fat/MSNF/Salt.
    // microKey: "butter" — per Appendix B1 Sr.6 "Pasteurized Butter",
    // added once the dashboard form's lab section became sub-type-aware
    // (see unionMicroLimits() below). Real Ghee/Anhydrous Milk Fat/
    // Butter Oil still have no matching row in the source and stay
    // composition-only.
    table_butter: {
      name: "Table Butter", microKey: "butter",
      ref: "FSS 2.1.9, Item 2(c) — Composition (Table butter column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 16.0, unit: "%", ref: "FSS 2.1.9, Item 2(c) (Table butter column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 80.0, unit: "%", ref: "FSS 2.1.9, Item 2(c) (Table butter column)", severity: "CRITICAL" },
        { key: "msnf", reportLabel: "Milk Solids-Not-Fat ({name})", shortLabel: "MSNF", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.9, Item 2(c) (Table butter column)", severity: "HIGH" },
        { key: "common_salt", reportLabel: "Common Salt ({name})", shortLabel: "Common Salt", rule: "max", max: 3.0, unit: "%", ref: "FSS 2.1.9, Item 2(c) (Table butter column)", severity: "MEDIUM" },
        { key: "rm_value", reportLabel: "Reichert Meissl Value ({name}, extracted fat)", shortLabel: "RM Value", rule: "min", min: 24.0, unit: "", ref: "FSS 2.1.9, Item 2(c), Note — extracted fat must meet Ghee's Reichert Meissl Value standard (FSS 2.1.8, Item 2(b))", severity: "MEDIUM", optional: true },
        { key: "br_reading", reportLabel: "Butyro-refractometer Reading at 40°C ({name}, extracted fat)", shortLabel: "BR Reading", rule: "between", min: 40.0, max: 44.0, unit: "", ref: "FSS 2.1.9, Item 2(c), Note — extracted fat must meet Ghee's Butyro-refractometer Reading standard (FSS 2.1.8, Item 2(b))", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 30, storageTemp: "2-6°C" },
    },
    // White butter/cooking butter's table cells for Moisture/MSNF/Common
    // salt are all "--" (no numeric limit stated) — only Milk Fat has a
    // real ceiling, so that's the only required field here; no fabricated
    // limits for the blank cells.
    white_butter: {
      name: "White Butter / Cooking Butter", microKey: "butter",
      ref: "FSS 2.1.9, Item 2(c) — Composition (White butter/Cooking butter column)",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 76.0, unit: "%", ref: "FSS 2.1.9, Item 2(c) (White butter/Cooking butter column)", severity: "CRITICAL" },
        { key: "rm_value", reportLabel: "Reichert Meissl Value ({name}, extracted fat)", shortLabel: "RM Value", rule: "min", min: 24.0, unit: "", ref: "FSS 2.1.9, Item 2(c), Note — extracted fat must meet Ghee's Reichert Meissl Value standard (FSS 2.1.8, Item 2(b))", severity: "MEDIUM", optional: true },
        { key: "br_reading", reportLabel: "Butyro-refractometer Reading at 40°C ({name}, extracted fat)", shortLabel: "BR Reading", rule: "between", min: 40.0, max: 44.0, unit: "", ref: "FSS 2.1.9, Item 2(c), Note — extracted fat must meet Ghee's Butyro-refractometer Reading standard (FSS 2.1.8, Item 2(b))", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 30, storageTemp: "2-6°C" },
    },
  },

  // Fix per review item C17 (bring not-live categories live, composition-
  // only): Milk Powder, extracted verbatim from the primary FSSAI text
  // (Chapter 2.1, "Version 3 (07.05.2025)", Reg. 2.1.10 "Standard for
  // Milk Powders and Cream Powder") via /tmp/chapter21.txt (pdftotext
  // -layout). The composition table has 4 columns (Whole Milk Powder,
  // Partly Skimmed Milk Powder, Skimmed Milk Powder, Cream Powder) and 6
  // real numeric rows, all encoded — Moisture, Milk Fat (the ranges that
  // actually distinguish the 4 types), Milk Protein in SNF, Titrable
  // Acidity, Insolubility Index, and Total Ash (the last three don't
  // apply to Cream Powder — the source table shows "--" for its cells,
  // not a fabricated limit). Milk Fat's source wording is an open
  // interval for Whole ("minimum 26.0 and less than 42.0") and Partly
  // Skimmed ("more than 1.5 and less than 26.0") — coded as inclusive
  // `between`, same boundary-inclusivity call already made for paneer's
  // Medium Fat tier: the adjacent tiers (Skimmed <=1.5, Cream >=42.0)
  // already cover the exact boundary values, and a submission only ever
  // checks the ONE sub-type the FBO actually declared, so this doesn't
  // let anything pass a standard it isn't subject to.
  //
  // NOT encoded (documented gap, not silently dropped): "Scorched
  // particles, maximum: Disc B" — a categorical result graded against an
  // ADMI-style physical disc standard. Unlike Baudouin Test/β-sitosterol
  // above (a clean Negative/Positive or Absent/Present pass criterion),
  // this is an ORDINAL scale (Disc A/B/C/...) where "maximum Disc B"
  // means "no worse than B," not "equals B" — the source text here
  // doesn't define the disc scale's own ordering, and guessing at it
  // would risk coding a wrong pass/fail rule for a real parameter, worse
  // than leaving it undocumented. Same treatment, same reasoning, as
  // Ghee's Table-1 fatty-acid gap. No microbiology panel yet either, per
  // your "skip microbiology for now" answer — see MICRO_LIMITS below (no
  // `milk_powder` entry).
  milk_powder: {
    whole_milk_powder: {
      name: "Whole Milk Powder",
      ref: "FSS 2.1.10, Item 2(b) — Composition (Whole Milk Powder column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Whole Milk Powder column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 26.0, max: 42.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Whole Milk Powder column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein, in SNF ({name})", shortLabel: "Milk Protein (in SNF)", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Whole Milk Powder column)", severity: "HIGH" },
        { key: "titrable_acidity", reportLabel: "Titrable Acidity ({name})", shortLabel: "Titrable Acidity", rule: "max", max: 18.0, unit: " ml 0.1N NaOH/10g SNF", ref: "FSS 2.1.10, Item 2(b) (Whole Milk Powder column)", severity: "MEDIUM" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 2.0, unit: " ml", ref: "FSS 2.1.10, Item 2(b) (Whole Milk Powder column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture & fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Whole Milk Powder column)", severity: "MEDIUM" },
        { key: "sodium", reportLabel: "Sodium ({name})", shortLabel: "Sodium", rule: "max", max: 650, unit: " mg/100g SNF", ref: "FSS 2.1.10, Item 2(b), Note — does not apply to sodium from sodium-containing additives", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    partly_skimmed_milk_powder: {
      name: "Partly Skimmed Milk Powder",
      ref: "FSS 2.1.10, Item 2(b) — Composition (Partly Skimmed Milk Powder column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Partly Skimmed Milk Powder column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 1.5, max: 26.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Partly Skimmed Milk Powder column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein, in SNF ({name})", shortLabel: "Milk Protein (in SNF)", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Partly Skimmed Milk Powder column)", severity: "HIGH" },
        { key: "titrable_acidity", reportLabel: "Titrable Acidity ({name})", shortLabel: "Titrable Acidity", rule: "max", max: 18.0, unit: " ml 0.1N NaOH/10g SNF", ref: "FSS 2.1.10, Item 2(b) (Partly Skimmed Milk Powder column)", severity: "MEDIUM" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 2.0, unit: " ml", ref: "FSS 2.1.10, Item 2(b) (Partly Skimmed Milk Powder column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture & fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Partly Skimmed Milk Powder column)", severity: "MEDIUM" },
        { key: "sodium", reportLabel: "Sodium ({name})", shortLabel: "Sodium", rule: "max", max: 650, unit: " mg/100g SNF", ref: "FSS 2.1.10, Item 2(b), Note — does not apply to sodium from sodium-containing additives", severity: "MEDIUM", optional: true },
      ],
      // Item 6(a) proviso: may be labelled "semi-skimmed milk powder"
      // instead when fat is 14.0-16.0% — a labelling option, not a
      // separate compositional standard, so it's a brief note rather
      // than its own sub-type.
      extraBriefNotes: ['May be labelled "semi-skimmed milk powder" instead, if Milk Fat is 14.0-16.0%'],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    skimmed_milk_powder: {
      name: "Skimmed Milk Powder",
      ref: "FSS 2.1.10, Item 2(b) — Composition (Skimmed Milk Powder column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Skimmed Milk Powder column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 1.5, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Skimmed Milk Powder column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein, in SNF ({name})", shortLabel: "Milk Protein (in SNF)", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Skimmed Milk Powder column)", severity: "HIGH" },
        { key: "titrable_acidity", reportLabel: "Titrable Acidity ({name})", shortLabel: "Titrable Acidity", rule: "max", max: 18.0, unit: " ml 0.1N NaOH/10g SNF", ref: "FSS 2.1.10, Item 2(b) (Skimmed Milk Powder column)", severity: "MEDIUM" },
        { key: "insolubility_index", reportLabel: "Insolubility Index ({name})", shortLabel: "Insolubility Index", rule: "max", max: 2.0, unit: " ml", ref: "FSS 2.1.10, Item 2(b) (Skimmed Milk Powder column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, moisture & fat free basis ({name})", shortLabel: "Total Ash", rule: "max", max: 9.3, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Skimmed Milk Powder column)", severity: "MEDIUM" },
        { key: "sodium", reportLabel: "Sodium ({name})", shortLabel: "Sodium", rule: "max", max: 650, unit: " mg/100g SNF", ref: "FSS 2.1.10, Item 2(b), Note — does not apply to sodium from sodium-containing additives", severity: "MEDIUM", optional: true },
      ],
      // Item 6(b): wherever "milk" appears on a skimmed milk powder
      // label, it must be immediately preceded/followed by "skimmed" (or
      // "partly skimmed").
      extraBriefNotes: ['Every use of the word "milk" on the label must be immediately preceded or followed by "skimmed"'],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    cream_powder: {
      name: "Cream Powder",
      ref: "FSS 2.1.10, Item 2(b) — Composition (Cream Powder column)",
      fields: [
        { key: "moisture", reportLabel: "Moisture ({name})", shortLabel: "Moisture", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Cream Powder column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "min", min: 42.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Cream Powder column)", severity: "CRITICAL" },
        { key: "protein_snf", reportLabel: "Milk Protein, in SNF ({name})", shortLabel: "Milk Protein (in SNF)", rule: "min", min: 34.0, unit: "%", ref: "FSS 2.1.10, Item 2(b) (Cream Powder column)", severity: "HIGH" },
        // Titrable Acidity / Insolubility Index / Total Ash: the source
        // table shows "--" for Cream Powder's cells — no limit stated,
        // not a fabricated one.
        { key: "sodium", reportLabel: "Sodium ({name})", shortLabel: "Sodium", rule: "max", max: 650, unit: " mg/100g SNF", ref: "FSS 2.1.10, Item 2(b), Note — does not apply to sodium from sodium-containing additives", severity: "MEDIUM", optional: true },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },

  // ---------------------------------------------------------------
  // Khoa / Mawa (FSS 2.1.6 — "Standard for Khoa")
  // ---------------------------------------------------------------
  // New category (see the long comment on CATEGORIES' `khoa` entry
  // above for how this was found: "khoa"/"mawa" used to be Milk Powder
  // keywords, routing anyone searching for Khoa into the wrong
  // regulation's checker). Quoted directly from the primary FSSAI text,
  // Chapter 2.1, "Version 3, 07.05.2025", Item 2(b) "Composition":
  //   Total solids, minimum, %, (m/m)                          55.0
  //   [Milk fat, minimum, %, (m/m), dry matter basis            27.0]
  //   Total ash, maximum, %, (m/m)                              6.0
  //   Titratable acidity (as % lactic acid), maximum, %         0.9
  // The Milk Fat row is shown in the source itself inside square
  // brackets with a footnote marker ("83[Milk fat, ... 27.0]") — an
  // amendment-inserted row, not an original one; the bracketed 27.0%
  // figure is the one currently in force, so that's what's encoded.
  // Only one product is defined under this standard — no fat tiers, no
  // separate Khoa/Mawa split (they're the same product, different
  // regional names per Item 1's own description) — so unlike every
  // other category in this file, DAIRY_PRODUCTS.khoa has exactly one
  // sub-type. The generic sub-type-selector architecture used
  // everywhere else in this app (SUB_TYPE_INPUT_KEY, specFor(),
  // CATEGORY_SUBTYPE_PROMPTS) handles a 1-option category with no
  // special-casing needed, so it's kept consistent rather than
  // hand-rolling a no-selector path for this one category.
  //
  // Two more source lines, documented rather than built:
  //   - "It shall be free from added starch and added sugar." — a
  //     qualitative adulteration check, not a min/max/equals figure;
  //     same "documented gap, not silently dropped" precedent as
  //     Ghee's fatty-acid Table 1 and Milk Powder's Scorched Particles
  //     test above.
  //   - "The extracted fat from Khoa shall meet the standards for
  //     Reichert Meissl value, Polenske value and Butyro-refractometer
  //     reading as prescribed for ghee." — this ONE *is* built: three
  //     optional fields below, reusing Ghee's own column numbers
  //     (FSS 2.1.8, Item 2(b), Ghee column) exactly like Table/White
  //     Butter's extracted-fat note already does for RM value/BR
  //     reading (see DAIRY_PRODUCTS.ghee.table_butter above) — Khoa's
  //     own note additionally names Polenske value, so all three are
  //     included here where Butter's note only named two.
  khoa: {
    khoa: {
      name: "Khoa / Mawa",
      ref: "FSS 2.1.6, Item 2(b) — Composition",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids ({name})", shortLabel: "Total Solids", rule: "min", min: 55.0, unit: "%", ref: "FSS 2.1.6, Item 2(b)", severity: "CRITICAL" },
        { key: "fat", reportLabel: "Milk Fat ({name}, dry matter basis)", shortLabel: "Milk Fat", rule: "min", min: 27.0, unit: "%", ref: "FSS 2.1.6, Item 2(b) — amendment-inserted row, bracketed in the source: \"[Milk fat, minimum, %, (m/m), dry matter basis 27.0]\"", severity: "CRITICAL" },
        { key: "total_ash", reportLabel: "Total Ash ({name})", shortLabel: "Total Ash", rule: "max", max: 6.0, unit: "%", ref: "FSS 2.1.6, Item 2(b)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, as % lactic acid ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 0.9, unit: "%", ref: "FSS 2.1.6, Item 2(b)", severity: "HIGH" },
        { key: "rm_value", reportLabel: "Reichert Meissl Value ({name}, extracted fat)", shortLabel: "RM Value", rule: "min", min: 24.0, unit: "", ref: "FSS 2.1.6, Item 2(b), Note — extracted fat must meet Ghee's Reichert Meissl Value standard (FSS 2.1.8, Item 2(b), Ghee column)", severity: "MEDIUM", optional: true },
        { key: "polenske_value", reportLabel: "Polenske Value ({name}, extracted fat)", shortLabel: "Polenske Value", rule: "between", min: 0.5, max: 2.0, unit: "", ref: "FSS 2.1.6, Item 2(b), Note — extracted fat must meet Ghee's Polenske Value standard (FSS 2.1.8, Item 2(b), Ghee column)", severity: "MEDIUM", optional: true },
        { key: "br_reading", reportLabel: "Butyro-refractometer Reading at 40°C ({name}, extracted fat)", shortLabel: "BR Reading", rule: "between", min: 40.0, max: 44.0, unit: "", ref: "FSS 2.1.6, Item 2(b), Note — extracted fat must meet Ghee's Butyro-refractometer Reading standard (FSS 2.1.8, Item 2(b), Ghee column)", severity: "MEDIUM", optional: true },
      ],
      // Khoa is a moist, unpreserved, fresh-sold dense milk solid (total
      // solids min 55% implies up to ~45% moisture) — not a dried powder
      // like Milk Powder's 180-day/ambient sub-types. Matched to Paneer/
      // Chhana's shelf-life treatment instead (days: 7, storageTemp:
      // "2-6°C") as the closest comparable fresh, refrigerated dairy
      // solid already in this file; this figure isn't itself an FSSAI
      // compositional requirement (none of this file's shelfLife values
      // are — they're operational estimates the report surfaces, not
      // regulation-mandated numbers).
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
  },

  // ---------------------------------------------------------------
  // Yogurt / Dahi (FSS 2.1.13 — "Standard for Fermented Milk Products")
  // ---------------------------------------------------------------
  // Fix per review item C17 (bring not-live categories live): flipped
  // live, per your "Everything in 2.1.13" sign-off. This standard is
  // broader than the category's "Yogurt / Dahi" label suggests — it
  // covers Dahi, Yoghurt (+ Flavoured Dahi), Chakka (concentrated dahi/
  // yoghurt), Shrikhand (a chakka-based dessert), and Drinks based on
  // Fermented Milk (lassi/chhaas/buttermilk). All 5 product families are
  // built here per your "Everything in 2.1.13" answer.
  //
  // Plain Dahi is architecturally different from every other sub-type in
  // this file: Item 2(c)(iii) doesn't give it its own Fat/SNF numbers —
  // it says Plain Dahi must meet the SAME minimum Fat/SNF as whichever
  // milk it's made from (falling back to the Mixed Milk standard if sold
  // without a declared milk class). Rather than duplicate ~13 already-
  // sourced milk-type numbers here (with a real drift risk if either
  // table is ever corrected independently), `plain_dahi` carries a
  // `computed: "milk_cross_reference"` marker and NO fat/snf fields
  // of its own — validation.js's runMilkCrossReferenceComposition() and
  // validation_engine.py's _run_milk_cross_reference_composition() look
  // those two numbers up live from DAIRY_PRODUCTS.milk[input.milk_type]
  // (Python: MILK_TYPES) instead, per your "cross-reference Milk live"
  // sign-off. The same marker and functions are reused, unchanged, by
  // DAIRY_PRODUCTS.flavoured_milk below (FSS 2.1.3 needs the identical
  // mechanism — see that entry's own comment).
  // Its own `fields` array below only carries the general Fermented Milk
  // baseline (protein/acidity, Item 2(c)(ii)) that Item 2(c)(iii)
  // doesn't override.
  //
  // Two gaps, documented rather than built (same "documented gap, not
  // silently dropped" precedent as Ghee's fatty-acid Table 1 and Milk
  // Powder's Scorched Particles test):
  //   - Item 2(c)(i)'s starter-microorganism viability requirement
  //     (>=10^7 cfu/g, or >=10^6 cfu/g for a labelled content claim) is a
  //     live-culture count, not a composition figure or a Table 2A/2B
  //     organism — it doesn't fit either existing panel shape, and there
  //     is no microbiology panel for this category yet anyway
  //     (composition-only, per your original 4-category instruction —
  //     see MICRO_LIMITS below: no `yogurt` entry).
  //   - Drinks based on Fermented Milk's minimum-40%-fermented-milk rule
  //     (Item 1(c)) is the only NUMERIC rule the source gives directly
  //     for that product type. The general protein/acidity baseline
  //     (Item 2(c)(ii)) says it applies "to the Fermented Milk Part" of
  //     a drink, but a finished, diluted drink can't be decomposed back
  //     into its fermented-milk-part vs. added-water/non-dairy-part from
  //     a single lab reading of the whole product — so only the one rule
  //     the source gives for the whole product is encoded; nothing about
  //     the "part" is estimated or guessed at.
  yogurt: {
    plain_dahi: {
      name: "Plain Dahi",
      ref: "FSS 2.1.13, Item 2(c)(iii) — Plain Dahi",
      // Renamed from "dahi_milk_cross_reference" to the category-neutral
      // "milk_cross_reference" when Flavoured Milk (FSS 2.1.3) turned out
      // to need the exact same mechanism — see validation.js's
      // runMilkCrossReferenceComposition() and DAIRY_PRODUCTS.
      // flavoured_milk below.
      computed: "milk_cross_reference",
      fields: [
        { key: "protein", reportLabel: "Milk Protein", shortLabel: "Milk Protein", rule: "min", min: 2.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(ii) — general Fermented Milk minimum (not overridden for Plain Dahi)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity", shortLabel: "Titratable Acidity", rule: "min", min: 0.45, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(ii) — general Fermented Milk minimum (not overridden for Plain Dahi)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 14, storageTemp: "2-6°C" },
    },
    yoghurt_flavoured_dahi: {
      name: "Yoghurt / Flavoured Dahi",
      ref: "FSS 2.1.13, Item 2(c)(iv) — Yoghurt and Flavoured Dahi",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 3.0, max: 15.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Yoghurt and Flavoured Dahi column)", severity: "CRITICAL" },
        { key: "msnf", reportLabel: "Milk Solids-Not-Fat, minimum ({name})", shortLabel: "MSNF", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Yoghurt and Flavoured Dahi column)", severity: "HIGH" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 2.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Yoghurt and Flavoured Dahi column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, minimum ({name})", shortLabel: "Titratable Acidity", rule: "min", min: 0.6, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(iv) (Yoghurt and Flavoured Dahi column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 14, storageTemp: "2-6°C" },
    },
    // Source: "More than 0.5 and Less than 3.0" (strictly exclusive both
    // ends) — encoded as an inclusive between per the boundary-
    // inclusivity convention established for paneer's Medium Fat tier:
    // the adjacent tiers already cover exactly 0.5 (Skimmed's own
    // ceiling) and exactly 3.0 (this tier's own sibling's floor), so
    // nothing "leaks" through a standard it isn't subject to.
    partly_skimmed_yoghurt_flavoured_dahi: {
      name: "Partly Skimmed Yoghurt / Flavoured Partly Skimmed Dahi",
      ref: "FSS 2.1.13, Item 2(c)(iv) — Partly Skimmed Yoghurt and Flavoured Partly Skimmed Dahi",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "between", min: 0.5, max: 3.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Partly Skimmed Yoghurt / Flavoured Partly Skimmed Dahi column)", severity: "CRITICAL" },
        { key: "msnf", reportLabel: "Milk Solids-Not-Fat, minimum ({name})", shortLabel: "MSNF", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Partly Skimmed Yoghurt / Flavoured Partly Skimmed Dahi column)", severity: "HIGH" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 2.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Partly Skimmed Yoghurt / Flavoured Partly Skimmed Dahi column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, minimum ({name})", shortLabel: "Titratable Acidity", rule: "min", min: 0.6, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(iv) (Partly Skimmed Yoghurt / Flavoured Partly Skimmed Dahi column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 14, storageTemp: "2-6°C" },
    },
    skimmed_yoghurt_flavoured_dahi: {
      name: "Skimmed Yoghurt / Flavoured Skimmed Dahi",
      ref: "FSS 2.1.13, Item 2(c)(iv) — Skimmed Yoghurt and Flavoured Skimmed Dahi",
      fields: [
        { key: "fat", reportLabel: "Milk Fat ({name})", shortLabel: "Milk Fat", rule: "max", max: 0.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Skimmed Yoghurt / Flavoured Skimmed Dahi column)", severity: "CRITICAL" },
        { key: "msnf", reportLabel: "Milk Solids-Not-Fat, minimum ({name})", shortLabel: "MSNF", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Skimmed Yoghurt / Flavoured Skimmed Dahi column)", severity: "HIGH" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 2.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(iv) (Skimmed Yoghurt / Flavoured Skimmed Dahi column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, minimum ({name})", shortLabel: "Titratable Acidity", rule: "min", min: 0.6, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(iv) (Skimmed Yoghurt / Flavoured Skimmed Dahi column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 14, storageTemp: "2-6°C" },
    },
    chakka: {
      name: "Chakka",
      ref: "FSS 2.1.13, Item 2(c)(v) — Chakka",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Chakka column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, minimum, dry basis ({name})", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 33.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Chakka column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum, dry basis ({name})", shortLabel: "Milk Protein (dry basis)", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Chakka column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, maximum ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 2.5, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(v) (Chakka column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, maximum, dry basis ({name})", shortLabel: "Total Ash (dry basis)", rule: "max", max: 3.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Chakka column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    skimmed_milk_chakka: {
      name: "Skimmed Milk Chakka",
      ref: "FSS 2.1.13, Item 2(c)(v) — Skimmed Milk Chakka",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 20.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Skimmed Milk Chakka column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, maximum, dry basis ({name})", shortLabel: "Milk Fat (dry basis)", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Skimmed Milk Chakka column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum, dry basis ({name})", shortLabel: "Milk Protein (dry basis)", rule: "min", min: 60.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Skimmed Milk Chakka column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, maximum ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 2.5, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(v) (Skimmed Milk Chakka column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, maximum, dry basis ({name})", shortLabel: "Total Ash (dry basis)", rule: "max", max: 5.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Skimmed Milk Chakka column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    full_cream_chakka: {
      name: "Full Cream Chakka",
      ref: "FSS 2.1.13, Item 2(c)(v) — Full Cream Chakka",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 28.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Full Cream Chakka column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, minimum, dry basis ({name})", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 38.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Full Cream Chakka column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum, dry basis ({name})", shortLabel: "Milk Protein (dry basis)", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Full Cream Chakka column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, maximum ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 2.5, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(v) (Full Cream Chakka column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, maximum, dry basis ({name})", shortLabel: "Total Ash (dry basis)", rule: "max", max: 3.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(v) (Full Cream Chakka column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 7, storageTemp: "2-6°C" },
    },
    shrikhand: {
      name: "Shrikhand",
      ref: "FSS 2.1.13, Item 2(c)(vi) — Shrikhand",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 58.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Shrikhand column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, minimum, dry basis ({name})", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 8.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Shrikhand column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum, dry basis ({name})", shortLabel: "Milk Protein (dry basis)", rule: "min", min: 9.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Shrikhand column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, maximum ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.4, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(vi) (Shrikhand column)", severity: "MEDIUM" },
        { key: "sugar", reportLabel: "Sugar (Sucrose), maximum, dry basis ({name})", shortLabel: "Sugar (Sucrose, dry basis)", rule: "max", max: 72.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Shrikhand column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, maximum, dry basis ({name})", shortLabel: "Total Ash (dry basis)", rule: "max", max: 0.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Shrikhand column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 15, storageTemp: "2-6°C" },
    },
    full_cream_shrikhand: {
      name: "Full Cream Shrikhand",
      ref: "FSS 2.1.13, Item 2(c)(vi) — Full Cream Shrikhand",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 58.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Full Cream Shrikhand column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, minimum, dry basis ({name})", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Full Cream Shrikhand column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum, dry basis ({name})", shortLabel: "Milk Protein (dry basis)", rule: "min", min: 7.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Full Cream Shrikhand column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, maximum ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.4, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(vi) (Full Cream Shrikhand column)", severity: "MEDIUM" },
        { key: "sugar", reportLabel: "Sugar (Sucrose), maximum, dry basis ({name})", shortLabel: "Sugar (Sucrose, dry basis)", rule: "max", max: 72.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Full Cream Shrikhand column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, maximum, dry basis ({name})", shortLabel: "Total Ash (dry basis)", rule: "max", max: 0.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Full Cream Shrikhand column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 15, storageTemp: "2-6°C" },
    },
    fruit_shrikhand: {
      name: "Fruit Shrikhand",
      ref: "FSS 2.1.13, Item 2(c)(vi) — Fruit Shrikhand",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 58.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Fruit Shrikhand column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, minimum, dry basis ({name})", shortLabel: "Milk Fat (dry basis)", rule: "min", min: 7.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Fruit Shrikhand column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum, dry basis ({name})", shortLabel: "Milk Protein (dry basis)", rule: "min", min: 6.0, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Fruit Shrikhand column)", severity: "HIGH" },
        { key: "titratable_acidity", reportLabel: "Titratable Acidity, maximum ({name})", shortLabel: "Titratable Acidity", rule: "max", max: 1.4, unit: "% (as lactic acid)", ref: "FSS 2.1.13, Item 2(c)(vi) (Fruit Shrikhand column)", severity: "MEDIUM" },
        { key: "sugar", reportLabel: "Sugar (Sucrose), maximum, dry basis ({name})", shortLabel: "Sugar (Sucrose, dry basis)", rule: "max", max: 72.5, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Fruit Shrikhand column)", severity: "MEDIUM" },
        { key: "total_ash", reportLabel: "Total Ash, maximum, dry basis ({name})", shortLabel: "Total Ash (dry basis)", rule: "max", max: 0.9, unit: "%", ref: "FSS 2.1.13, Item 2(c)(vi) (Fruit Shrikhand column)", severity: "MEDIUM" },
      ],
      shelfLife: { days: 15, storageTemp: "2-6°C" },
    },
    drinks_based_on_fermented_milk: {
      name: "Drinks based on Fermented Milk (Lassi, Chhaas, Buttermilk, etc.)",
      ref: "FSS 2.1.13, Item 1(c) — Drinks based on Fermented Milk",
      fields: [
        { key: "fermented_milk_content", reportLabel: "Fermented Milk Content, minimum ({name})", shortLabel: "Fermented Milk Content", rule: "min", min: 40.0, unit: "%", ref: "FSS 2.1.13, Item 1(c)", severity: "CRITICAL" },
      ],
      shelfLife: { days: 2, storageTemp: "2-6°C" },
    },
  },

  // Brought live per your "START ICE CREAM, FROZEN DESSERT" go-ahead.
  // Built directly from the primary FSSAI text (Chapter 2.1, "Version 3
  // (07.05.2025)") via /tmp/chapter21.txt (pdftotext -layout), Reg.
  // 2.1.14 "Standard for Ice Cream, Kulfi, Chocolate Ice Cream, Softy
  // Ice-Cream, Milk Ice, Milk Lolly and Dried Ice Cream Mix" and Reg.
  // 2.1.15 "Standard for Frozen Desserts or Confections with Added
  // Vegetable Oil/Fat or Vegetable Protein, or both" — one category id
  // for both regs, same pattern as Ghee/Butter (2.1.8/2.1.9).
  //
  // Item 2(c)(i)'s composition table (quoted exactly, all three columns):
  //   Parameter          | Ice cream/Kulfi/...  | Medium Fat ...  | Low Fat ...
  //   Total Solids, min % |        36.0          |      30.0       |    26.0
  //   Weight, min, g/l    |       525.0          |     475.0       |   475.0
  //   Milk Fat, %, (m/m)  | 10.0 (minimum)       | >2.5 and <10.0  | 2.5 (max)
  //   Milk Protein*, min %|        3.5           |      3.5        |    3.0
  //   * Protein content is 6.38 multiplied by the total nitrogen determined
  // Item 2(c)(ii) (Milk Ice/Milk Lolly) has no Weight column at all — not
  // an omission here, the source table itself only has 3 rows for this
  // entry (Total Solids 20.0 min, Milk Fat 2.0 max, Milk Protein 3.5 min).
  // Item 2(c)(iii) (Dried Ice Cream Mix): "on addition of water shall
  // give a product conforming to the composition, except the 'weight',
  // as specified in entry (i) ... for the respective product" plus
  // "moisture content of the dried product shall not be more than 4.0%
  // (m/m)" — read as literally as the Paneer/Chhana fat-tier structure:
  // the dry powder must reconstitute to ONE of the three fat tiers, so
  // it's coded as three tiers here too (Full/Medium/Low Fat), each
  // carrying that tier's Total Solids/Fat/Protein numbers (checked
  // post-reconstitution) plus the powder's own Moisture ceiling — not
  // collapsed into one generic "Dried Mix" entry, which would hide which
  // tier's numbers actually apply.
  //
  // Reg. 2.1.15's Item 2(c)(i) table is structurally identical (Total
  // Solids/Weight/Total Fat/Protein at the same 36.0/525.0/10.0/3.5,
  // 30.0/475.0/2.5-10.0/3.5, 26.0/475.0/2.5/3.0 numbers) except it's
  // "Total Fat" (may be vegetable oil/fat, not necessarily milk fat) and
  // its own footnote uses a 6.25 nitrogen-to-protein factor, not 6.38 —
  // a real formulation-chemistry difference (vegetable proteins
  // conventionally use 6.25) that doesn't change the coded numeric
  // limits, since this app takes an already-computed lab % value, not a
  // raw nitrogen reading. Item 2(c)(ii) (Dried Frozen Dessert Mix) has
  // the identical "except weight, moisture <=4.0%" structure, same
  // 3-tier treatment as Dried Ice Cream Mix above.
  //
  // Frozen Dessert's Item 6(c) label declaration ("Contains ...%  Milk
  // Fat* Edible Vegetable Oil* and Vegetable Fat* and Vegetable Protein
  // Product") is explicitly NOT enforced yet per the source's own text:
  // "[Clause 6(c) of 2.1.15 shall came in to force after final decision
  // of FSSAI on nomenclature of Frozen dessert vide direction REG/SP-
  // M&MP/FSSAI-2018 dated 01/01/2020]" — unlike Mozzarella's Table-2
  // amendment (confirmed "in force from 1 May 2025"), this clause has no
  // in-force date at all, so it's a documented gap here, not a checkbox
  // that would misleadingly imply an active legal requirement. Ice
  // Cream's own Item 6(c) (starch declaration, conditional on the
  // product actually containing starch) is likewise not encoded as a
  // universal checklist item, same treatment as Yogurt's conditional
  // probiotic declaration.
  ice_cream: {
    ice_cream: {
      name: "Ice Cream / Kulfi / Chocolate Ice Cream / Softy Ice Cream",
      ref: "FSS 2.1.14, Item 2(c)(i) — Ice cream, Kulfi, Chocolate Ice cream, Softy Ice Cream",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 36.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Ice cream/Kulfi/Chocolate Ice cream/Softy Ice cream column)", severity: "HIGH" },
        { key: "weight", reportLabel: "Weight, minimum ({name})", shortLabel: "Weight", rule: "min", min: 525.0, unit: " g/l", ref: "FSS 2.1.14, Item 2(c)(i) (Ice cream/Kulfi/Chocolate Ice cream/Softy Ice cream column)", severity: "MEDIUM" },
        { key: "fat", reportLabel: "Milk Fat, minimum ({name})", shortLabel: "Milk Fat", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Ice cream/Kulfi/Chocolate Ice cream/Softy Ice cream column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Ice cream/Kulfi/Chocolate Ice cream/Softy Ice cream column) — protein = 6.38 x total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 90, storageTemp: "-18°C or below" },
    },
    medium_fat_ice_cream: {
      name: "Medium Fat Ice Cream / Kulfi / Chocolate Ice Cream / Softy Ice Cream",
      ref: "FSS 2.1.14, Item 2(c)(i) — Medium Fat Ice cream, Kulfi, Chocolate Ice cream, Softy Ice cream",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Medium Fat Ice cream/Kulfi/... column)", severity: "HIGH" },
        { key: "weight", reportLabel: "Weight, minimum ({name})", shortLabel: "Weight", rule: "min", min: 475.0, unit: " g/l", ref: "FSS 2.1.14, Item 2(c)(i) (Medium Fat Ice cream/Kulfi/... column)", severity: "MEDIUM" },
        // Source: "More than 2.5 and less than 10.0" (strictly exclusive
        // both ends) — coded as an inclusive between per the same
        // boundary-inclusivity convention used for Paneer's Medium Fat
        // tier: the adjacent Low Fat/Full Fat tiers already cover exactly
        // 2.5 and 10.0, so nothing "leaks" through a standard it isn't
        // subject to.
        { key: "fat", reportLabel: "Milk Fat, between ({name})", shortLabel: "Milk Fat", rule: "between", min: 2.5, max: 10.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Medium Fat Ice cream/Kulfi/... column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Medium Fat Ice cream/Kulfi/... column) — protein = 6.38 x total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 90, storageTemp: "-18°C or below" },
    },
    low_fat_ice_cream: {
      name: "Low Fat Ice Cream / Kulfi / Chocolate Ice Cream / Softy Ice Cream",
      ref: "FSS 2.1.14, Item 2(c)(i) — Low Fat Ice cream, Kulfi, Chocolate Ice cream, Softy Ice cream",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 26.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Low Fat Ice cream/Kulfi/... column)", severity: "HIGH" },
        { key: "weight", reportLabel: "Weight, minimum ({name})", shortLabel: "Weight", rule: "min", min: 475.0, unit: " g/l", ref: "FSS 2.1.14, Item 2(c)(i) (Low Fat Ice cream/Kulfi/... column)", severity: "MEDIUM" },
        { key: "fat", reportLabel: "Milk Fat, maximum ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Low Fat Ice cream/Kulfi/... column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(i) (Low Fat Ice cream/Kulfi/... column) — protein = 6.38 x total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 90, storageTemp: "-18°C or below" },
    },
    milk_ice_milk_lolly: {
      name: "Milk Ice / Milk Lolly",
      ref: "FSS 2.1.14, Item 2(c)(ii) — Milk Ice, Milk Lolly",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 20.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(ii)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, maximum ({name})", shortLabel: "Milk Fat", rule: "max", max: 2.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(ii)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name})", shortLabel: "Milk Protein", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(ii) — protein = 6.38 x total nitrogen", severity: "HIGH" },
      ],
      // No Weight field — the source table for this entry has no Weight
      // row at all, unlike entry (i) above.
      shelfLife: { days: 60, storageTemp: "-18°C or below" },
    },
    // See the long comment above DAIRY_PRODUCTS.ice_cream for why this is
    // split into 3 fat-tier sub-types instead of one generic entry.
    // microKey: "milk_powder" — Appendix B1's Sr.7 Table 2A/2B row
    // explicitly names "Ice Cream Mix Powder" alongside Milk Powder/SMP/
    // Dairy Whitener/Cream Powder/etc. — the DRY powder form is on that
    // row, not Sr.9 (which is the WET/reconstituted Ice Cream, Frozen
    // Dessert, Milk Lolly, Ice Candy row this category defaults to).
    dried_ice_cream_mix: {
      name: "Dried Ice Cream Mix (Full Fat)", microKey: "milk_powder",
      ref: "FSS 2.1.14, Item 2(c)(iii) — Dried Ice Cream Mix, reconstituted to Item 2(c)(i)'s Ice cream/Kulfi/... composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture, maximum ({name}, dry powder)", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii)", severity: "HIGH" },
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name}, reconstituted)", shortLabel: "Total Solids (reconstituted)", rule: "min", min: 36.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Ice cream/Kulfi/... column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, minimum ({name}, reconstituted)", shortLabel: "Milk Fat (reconstituted)", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Ice cream/Kulfi/... column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name}, reconstituted)", shortLabel: "Milk Protein (reconstituted)", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Ice cream/Kulfi/... column)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    dried_ice_cream_mix_medium_fat: {
      name: "Dried Ice Cream Mix (Medium Fat)", microKey: "milk_powder",
      ref: "FSS 2.1.14, Item 2(c)(iii) — Dried Ice Cream Mix, reconstituted to Item 2(c)(i)'s Medium Fat Ice cream/Kulfi/... composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture, maximum ({name}, dry powder)", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii)", severity: "HIGH" },
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name}, reconstituted)", shortLabel: "Total Solids (reconstituted)", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Medium Fat column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, between ({name}, reconstituted)", shortLabel: "Milk Fat (reconstituted)", rule: "between", min: 2.5, max: 10.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Medium Fat column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name}, reconstituted)", shortLabel: "Milk Protein (reconstituted)", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Medium Fat column)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    dried_ice_cream_mix_low_fat: {
      name: "Dried Ice Cream Mix (Low Fat)", microKey: "milk_powder",
      ref: "FSS 2.1.14, Item 2(c)(iii) — Dried Ice Cream Mix, reconstituted to Item 2(c)(i)'s Low Fat Ice cream/Kulfi/... composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture, maximum ({name}, dry powder)", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii)", severity: "HIGH" },
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name}, reconstituted)", shortLabel: "Total Solids (reconstituted)", rule: "min", min: 26.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Low Fat column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Milk Fat, maximum ({name}, reconstituted)", shortLabel: "Milk Fat (reconstituted)", rule: "max", max: 2.5, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Low Fat column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Milk Protein, minimum ({name}, reconstituted)", shortLabel: "Milk Protein (reconstituted)", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.14, Item 2(c)(iii) + Item 2(c)(i) (Low Fat column)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    frozen_dessert: {
      name: "Frozen Dessert / Frozen Confection",
      ref: "FSS 2.1.15, Item 2(c)(i) — Frozen Dessert or Frozen Confection",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 36.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Frozen Dessert/Frozen Confection column)", severity: "HIGH" },
        { key: "weight", reportLabel: "Weight, minimum ({name})", shortLabel: "Weight", rule: "min", min: 525.0, unit: " g/l", ref: "FSS 2.1.15, Item 2(c)(i) (Frozen Dessert/Frozen Confection column)", severity: "MEDIUM" },
        { key: "fat", reportLabel: "Total Fat, minimum ({name})", shortLabel: "Total Fat", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Frozen Dessert/Frozen Confection column) — may be milk fat, edible vegetable oil/fat, or both", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Protein, minimum ({name})", shortLabel: "Protein", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Frozen Dessert/Frozen Confection column) — protein = 6.25 x total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 90, storageTemp: "-18°C or below" },
    },
    medium_fat_frozen_dessert: {
      name: "Medium Fat Frozen Dessert / Frozen Confection",
      ref: "FSS 2.1.15, Item 2(c)(i) — Medium Fat Frozen Dessert or Frozen Confection",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Medium fat Frozen Dessert/... column)", severity: "HIGH" },
        { key: "weight", reportLabel: "Weight, minimum ({name})", shortLabel: "Weight", rule: "min", min: 475.0, unit: " g/l", ref: "FSS 2.1.15, Item 2(c)(i) (Medium fat Frozen Dessert/... column)", severity: "MEDIUM" },
        { key: "fat", reportLabel: "Total Fat, between ({name})", shortLabel: "Total Fat", rule: "between", min: 2.5, max: 10.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Medium fat Frozen Dessert/... column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Protein, minimum ({name})", shortLabel: "Protein", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Medium fat Frozen Dessert/... column) — protein = 6.25 x total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 90, storageTemp: "-18°C or below" },
    },
    low_fat_frozen_dessert: {
      name: "Low Fat Frozen Dessert / Frozen Confection",
      ref: "FSS 2.1.15, Item 2(c)(i) — Low Fat Frozen Dessert or Frozen Confection",
      fields: [
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name})", shortLabel: "Total Solids", rule: "min", min: 26.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Low fat Frozen Dessert/... column)", severity: "HIGH" },
        { key: "weight", reportLabel: "Weight, minimum ({name})", shortLabel: "Weight", rule: "min", min: 475.0, unit: " g/l", ref: "FSS 2.1.15, Item 2(c)(i) (Low fat Frozen Dessert/... column)", severity: "MEDIUM" },
        { key: "fat", reportLabel: "Total Fat, maximum ({name})", shortLabel: "Total Fat", rule: "max", max: 2.5, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Low fat Frozen Dessert/... column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Protein, minimum ({name})", shortLabel: "Protein", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(i) (Low fat Frozen Dessert/... column) — protein = 6.25 x total nitrogen", severity: "HIGH" },
      ],
      shelfLife: { days: 90, storageTemp: "-18°C or below" },
    },
    // Unlike Dried Ice Cream Mix above, NO microKey override here —
    // Appendix B1 has no row naming a dried/powder form of Frozen Dessert
    // at all (Sr.7's product list names "Ice Cream Mix Powder" only, not
    // "Frozen Dessert Mix Powder"). Extending Sr.7's named row to cover
    // an unnamed product by analogy would be exactly the kind of
    // unsourced assumption this whole review has been trying to
    // eliminate — so these 3 sub-types stay composition-only, same
    // treatment as real Ghee/Anhydrous Milk Fat's missing microbiology
    // match. Falling back to the default "ice_cream" bucket (Sr.9, the
    // WET-product row) would be wrong in the other direction, since Sr.9
    // doesn't cover a dry powder either — so this is a genuine, flagged
    // gap, not silently defaulted either way. See runMicrobiology() in
    // validation.js: NOT_AVAILABLE only happens for a categoryId with no
    // MICRO_LIMITS entry, so these 3 sub-types need an explicit
    // microKey pointing at a bucket that doesn't exist, which correctly
    // produces NOT_AVAILABLE rather than silently inheriting Sr.9.
    dried_frozen_dessert_mix: {
      name: "Dried Frozen Dessert / Confection Mix (Full Fat)", microKey: "frozen_dessert_dried_mix_gap",
      ref: "FSS 2.1.15, Item 2(c)(ii) — Dried Frozen Dessert/Confection Mix, reconstituted to Item 2(c)(i)'s Frozen Dessert composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture, maximum ({name}, dry powder)", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii)", severity: "HIGH" },
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name}, reconstituted)", shortLabel: "Total Solids (reconstituted)", rule: "min", min: 36.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Frozen Dessert column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Total Fat, minimum ({name}, reconstituted)", shortLabel: "Total Fat (reconstituted)", rule: "min", min: 10.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Frozen Dessert column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Protein, minimum ({name}, reconstituted)", shortLabel: "Protein (reconstituted)", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Frozen Dessert column)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    dried_frozen_dessert_mix_medium_fat: {
      name: "Dried Frozen Dessert / Confection Mix (Medium Fat)", microKey: "frozen_dessert_dried_mix_gap",
      ref: "FSS 2.1.15, Item 2(c)(ii) — Dried Frozen Dessert/Confection Mix, reconstituted to Item 2(c)(i)'s Medium Fat Frozen Dessert composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture, maximum ({name}, dry powder)", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii)", severity: "HIGH" },
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name}, reconstituted)", shortLabel: "Total Solids (reconstituted)", rule: "min", min: 30.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Medium fat column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Total Fat, between ({name}, reconstituted)", shortLabel: "Total Fat (reconstituted)", rule: "between", min: 2.5, max: 10.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Medium fat column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Protein, minimum ({name}, reconstituted)", shortLabel: "Protein (reconstituted)", rule: "min", min: 3.5, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Medium fat column)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
    dried_frozen_dessert_mix_low_fat: {
      name: "Dried Frozen Dessert / Confection Mix (Low Fat)", microKey: "frozen_dessert_dried_mix_gap",
      ref: "FSS 2.1.15, Item 2(c)(ii) — Dried Frozen Dessert/Confection Mix, reconstituted to Item 2(c)(i)'s Low Fat Frozen Dessert composition",
      fields: [
        { key: "moisture", reportLabel: "Moisture, maximum ({name}, dry powder)", shortLabel: "Moisture", rule: "max", max: 4.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii)", severity: "HIGH" },
        { key: "total_solids", reportLabel: "Total Solids, minimum ({name}, reconstituted)", shortLabel: "Total Solids (reconstituted)", rule: "min", min: 26.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Low fat column)", severity: "HIGH" },
        { key: "fat", reportLabel: "Total Fat, maximum ({name}, reconstituted)", shortLabel: "Total Fat (reconstituted)", rule: "max", max: 2.5, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Low fat column)", severity: "CRITICAL" },
        { key: "protein", reportLabel: "Protein, minimum ({name}, reconstituted)", shortLabel: "Protein (reconstituted)", rule: "min", min: 3.0, unit: "%", ref: "FSS 2.1.15, Item 2(c)(ii) + Item 2(c)(i) (Low fat column)", severity: "HIGH" },
      ],
      shelfLife: { days: 180, storageTemp: "Ambient, sealed (cool & dry)" },
    },
  },
};

// Mozzarella's Compositional Standards Table-2 (see the `computed:
// "mozzarella_fdm"` comment on DAIRY_PRODUCTS.cheese.mozzarella above).
// minFdm/maxFdm bound each Fat-in-Dry-Matter band — maxFdm is exclusive,
// per the primary source's own "equal to or above X but less than Y"
// wording. lowDM/highDM are the minimum dry matter % required in that
// band for "Low moisture"/"High moisture" Mozzarella respectively —
// equivalently, maximum moisture % = 100 - that value. `qualifier` is
// the FSSAI-defined labelling term for that band (null where the source
// table leaves a row unlabeled, between "Medium fat" and "Full fat").
export const MOZZARELLA_FDM_BANDS = [
  { minFdm: 18, maxFdm: 30, lowDM: 34.0, highDM: 24.0, qualifier: "Partially skimmed" },
  { minFdm: 30, maxFdm: 40, lowDM: 39.0, highDM: 26.0, qualifier: "Medium fat" },
  { minFdm: 40, maxFdm: 45, lowDM: 42.0, highDM: 29.0, qualifier: null },
  { minFdm: 45, maxFdm: 50, lowDM: 45.0, highDM: 31.0, qualifier: "Full fat" },
  { minFdm: 50, maxFdm: 60, lowDM: 47.0, highDM: 34.0, qualifier: "Full fat" },
  { minFdm: 60, maxFdm: 85, lowDM: 53.0, highDM: 38.0, qualifier: "High fat" },
];
// Table-2 Note 1: overall FDM floor by moisture designation.
export const MOZZARELLA_FDM_FLOOR = { low_moisture: 18.0, high_moisture: 20.0 };

// Fix per review item C17 (see the CATEGORIES comment above): cheese is
// 2.1.17, confirmed against the founder-provided FSSAI cross-reference
// table.
export const CHEESE_COMMON_RULE = "Must be made from milk heat-treated to at least pasteurisation level (FSS 2.1.17).";

// Back-compat flat lookups — a few older call sites (Formulation Lab
// comparison views, the Python backend port) still read `TYPES[key].name`
// directly. Derived from DAIRY_PRODUCTS, not hand-maintained, so they
// can't drift from the schema above.
export const MILK_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.milk).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const PANEER_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.paneer).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const CHEESE_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.cheese).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const GHEE_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.ghee).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const MILK_POWDER_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.milk_powder).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const KHOA_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.khoa).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const FLAVOURED_MILK_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.flavoured_milk).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const EVAPORATED_MILK_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.evaporated_milk).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const SWEETENED_CONDENSED_MILK_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.sweetened_condensed_milk).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const CREAM_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.cream).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const DAIRY_WHITENER_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.dairy_whitener).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const WHEY_POWDER_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.whey_powder).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const CASEIN_PRODUCTS_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.casein_products).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const EDIBLE_LACTOSE_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.edible_lactose).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const MILK_PROTEIN_CONCENTRATE_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.milk_protein_concentrate).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const WHEY_PROTEIN_CONCENTRATE_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.whey_protein_concentrate).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const COLOSTRUM_PRODUCTS_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.colostrum_products).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const DAIRY_PERMEATE_POWDERS_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.dairy_permeate_powders).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const YOGURT_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.yogurt).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);
export const ICE_CREAM_TYPES = Object.fromEntries(
  Object.entries(DAIRY_PRODUCTS.ice_cream).map(([k, v]) => [k, { name: v.name, ref: v.ref }])
);

// ---------------------------------------------------------------
// 5. MICROBIOLOGICAL LIMITS — Table 2A (process hygiene) & 2B
//    (food safety). Dairy Bible §6.2 / §6.3.
//    limit: { n, c, m, M, unit }. M = null means a 2-class plan
//    (any result above m fails; no intermediate "acceptable" band).
// ---------------------------------------------------------------
// REBUILT from the primary source (Appendix B1.pdf, "Table 2: Microbiological
// Standards for Milk and Milk Products", Table-2A Process Hygiene / Table-2B
// Food Safety) you uploaded — replaces the Dairy Bible-derived panel below,
// which turned out to mismatch this document on nearly every number (not
// just the extra-organisms question flagged as A17). Row mapping used:
// Milk = Sr.1 "Pasteurized/boiled Milk/Flavoured Milk"; Paneer = Sr.13
// "Paneer/Chhana/chhana based sweets"; Cheese (general) = Sr.11 "All other
// cheeses categories including fresh cheeses/Cheddar/Cottage/Soft/Semi
// Soft"; Processed Cheese = Sr.10 "Processed Cheese/Cheese Spread". Where a
// row's column says "NA" (not applicable), that organism is genuinely not
// tested for that product per this document — omitted below rather than
// carried over with an invented number. A17 is resolved: Table 2B for
// these three categories really is just Salmonella + Listeria — Bacillus
// cereus/Sulphite Reducing Clostridia/Enterobacter sakazakii are all "NA"
// for every one of these rows, so nothing was actually missing there.
export const MICRO_LIMITS = {
  milk: {
    table_2a: {
      apc: { n: 5, c: 3, m: 30000, M: 50000, unit: "CFU/ml", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 0, m: 10, M: null, unit: "CFU/ml", name: "Coliform Count" },
      // Staph aureus, Yeast & Mould, and E. coli are all "NA" for this row
      // in the source — not tested for pasteurised/boiled/flavoured milk.
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25ml", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/25ml", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Sr.5 "Sweetened Condensed Milk" — confirmed via pdfplumber's
  // extract_tables() (scientific-notation cells, same extraction method
  // used for Khoa's Sr.14 row). APC and the three 2-class organisms
  // (Coliform, Staph aureus, Yeast & Mould) all have real m limits here,
  // unlike plain Milk's Sr.1 row above — E. coli is "NA" (not tested).
  sweetened_condensed_milk: {
    table_2a: {
      apc: { n: 5, c: 3, m: 500, M: 1000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "Yeast and Mould Count" },
      // E. coli: "NA" for this row.
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Sr.2 "Pasteurized Cream" — confirmed via pdfplumber's extract_tables()
  // (same extraction method used for Sr.5 above). APC and Coliform have
  // real limits; Staph aureus, Yeast & Mould, and E. coli are all "NA"
  // for this row (not tested) — omitted entirely, same "don't fabricate a
  // limit for an NA cell" treatment as every other category's blank
  // fields. Sr.4 "Sterilized/ UHT Cream" is a separate, all-"NA" row with
  // its own qualitative commercial-sterility note (IS: 4884) — documented
  // as a gap on DAIRY_PRODUCTS.cream, not a second bucket here, per that
  // comment's reasoning (this app doesn't split any category's
  // microbiology by heat treatment). `malai` in DAIRY_PRODUCTS.cream
  // deliberately does NOT resolve to this bucket — see its own
  // `microKey: "malai_gap"` and the long comment above
  // DAIRY_PRODUCTS.cream for why.
  cream: {
    table_2a: {
      apc: { n: 5, c: 3, m: 50000, M: 75000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "Coliform Count" },
      // Staph aureus, Yeast & Mould, E. coli: all "NA" for this row.
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Listeria monocytogenes", presence: true },
    },
  },
  paneer: {
    table_2a: {
      apc: { n: 5, c: 3, m: 150000, M: 350000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 3, m: 10, M: 100, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 3, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 3, m: 50, M: 150, unit: "CFU/g", name: "Yeast and Mould Count" },
      e_coli: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "E. coli" },
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Sr.11 "All other cheeses" — the general/default bucket for every
  // cheese sub-type except Processed Cheese (see cheese_processed below).
  cheese: {
    table_2a: {
      // APC is "NA" for this row — not tested.
      coliform: { n: 5, c: 3, m: 100, M: 500, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 3, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 3, m: 100, M: 500, unit: "CFU/g", name: "Yeast and Mould Count" },
      e_coli: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "E. coli" },
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Sr.10 — a real, genuinely different (stricter on APC/Coliform, but
  // with no Yeast & Mould test at all) panel from the general cheese row
  // above, per the source — see `microKey` on
  // DAIRY_PRODUCTS.cheese.processed_cheese and validation.js's
  // specFor()-driven resolution.
  cheese_processed: {
    table_2a: {
      apc: { n: 5, c: 2, m: 25000, M: 50000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "Staphylococcus aureus" },
      // Yeast & Mould and E. coli are "NA" for this row.
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Added per your "add them" go-ahead — Sr.7 covers "Milk Powder; SMP,
  // PSMP; Dairy Whitener; Cream Powder; ..." generically, which matches
  // all 4 of DAIRY_PRODUCTS.milk_powder's sub-types with no split
  // needed (unlike Ghee/Butter below). Table 2B here genuinely has more
  // than Salmonella/Listeria — Bacillus cereus and Sulphite Reducing
  // Clostridia (SRC) both carry real numeric limits for this row.
  //
  // Fix found while building Edible Casein Products (FSS 2.1.18, per
  // your "you can start building on it" go-ahead): Table 2A's Sr.7 row
  // carries a superscript "3" footnote marker directly on "Casein
  // Powder" in its product list (confirmed via pdfplumber's
  // extract_tables(), not just the flattened text). Appendix B1's own
  // footnote 3 reads, quoted directly: "The yeast and mold count of
  // 50/g as specified in dried product categories shall be applicable
  // only to casein powder." That restricts the Yeast and Mould Count
  // criterion (n=5, c=0, m=50/g) to Casein Powder ALONE among this
  // row's ~9 named products — Milk Powder itself included. No footnote
  // restricts APC/Coliform/Staph aureus, or any Table 2B entry, so
  // those stay shared across the whole row. `yeast_mould` removed here
  // (was previously coded as if it applied row-wide, before this
  // footnote was noticed) — see MICRO_LIMITS.casein_products below for
  // where it now correctly lives instead. This does NOT change any
  // already-live Milk Powder/Dairy Whitener/Whey Powder PASS/FAIL
  // outcome for real submissions (removing an inapplicable check only
  // ever makes a prior FAIL/WARNING on that field disappear, never
  // creates a new one) — flagged in README's "Regulatory corrections"
  // table for your record.
  milk_powder: {
    table_2a: {
      apc: { n: 5, c: 2, m: 30000, M: 50000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 2, m: 10, M: 50, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 2, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      // Yeast and Mould Count: footnote 3 restricts this to Casein
      // Powder only — see MICRO_LIMITS.casein_products below, not here.
      // E. coli: "NA" for this row.
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
      bacillus_cereus: { n: 5, c: 3, m: 500, M: 1000, unit: "CFU/g", name: "Bacillus cereus" },
      src: { n: 5, c: 3, m: 50, M: 100, unit: "CFU/g", name: "Sulphite Reducing Clostridia" },
      // Enterobacter sakazakii: "NA" for this row (only the infant-food
      // rows carry a real limit for it).
    },
  },
  // Appendix B1 Sr.7's OWN shared row — same row as MICRO_LIMITS.
  // milk_powder above — but Casein Powder is the one product in that row
  // footnote 3 grants a real Yeast and Mould Count criterion to (see the
  // long comment on MICRO_LIMITS.milk_powder above for the full quote
  // and sourcing note). APC/Coliform/Staph aureus and every Table 2B
  // entry are identical to Milk Powder's own numbers — no footnote
  // scopes those away from Casein — confirmed via pdfplumber's
  // extract_tables() against both Table 2A and Table 2B's own Sr.7 rows.
  // This is a real, separate MICRO_LIMITS bucket, not a `microKey`
  // redirect to milk_powder, precisely because of that one added field.
  casein_products: {
    table_2a: {
      apc: { n: 5, c: 2, m: 30000, M: 50000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 2, m: 10, M: 50, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 2, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 0, m: 50, M: null, unit: "CFU/g", name: "Yeast and Mould Count" },
      // E. coli: "NA" for this row.
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
      bacillus_cereus: { n: 5, c: 3, m: 500, M: 1000, unit: "CFU/g", name: "Bacillus cereus" },
      src: { n: 5, c: 3, m: 50, M: 100, unit: "CFU/g", name: "Sulphite Reducing Clostridia" },
      // Enterobacter sakazakii: "NA" for this row (only the infant-food
      // rows carry a real limit for it).
    },
  },
  // Appendix B1, Sr.14 "Khoa/ Khoa based sweets" — extracted via
  // pdfplumber's extract_tables() (word-coordinate extraction was
  // ambiguous on this row's scientific-notation cells — 2.5x10^4/g,
  // 7.5x10^4/g, 1x10^2/g appear split across superscript/main/subscript
  // lines — table-structure extraction resolved it cleanly, cross-
  // checked against the already-known-correct Sr.9 Ice Cream row's
  // values using the same method). E. coli's source cell reads "<10/g"
  // (not "Absent/g" like Milk/Yogurt/Ghee/Ice Cream) — same wording
  // already used for Paneer (Sr.13) and Cheese (Sr.11) above, both
  // coded as a real CFU-count ceiling (m: 10, no `presence` flag), not
  // a presence test — kept consistent with that existing reading of the
  // identical source phrase rather than introducing a second
  // interpretation of the same wording.
  khoa: {
    table_2a: {
      apc: { n: 5, c: 3, m: 25000, M: 75000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 2, m: 50, M: 100, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 3, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 3, m: 10, M: 50, unit: "CFU/g", name: "Yeast and Mould Count" },
      e_coli: { n: 5, c: 0, m: 10, M: null, unit: "CFU/g", name: "E. coli" },
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
      // Bacillus cereus / Sulphite Reducing Clostridia / Enterobacter
      // sakazakii: all "NA" for this row.
    },
  },
  // Sr.12 "Fermented Milk Products" applies to all 11 Yogurt/Dahi
  // sub-types, including Chakka and Shrikhand — resolved (not just a
  // best-available guess): Chakka and Shrikhand are both made by
  // straining/concentrating Dahi (FSS 2.1.13, Item 1's own definitions
  // route them through the fermented-milk process), so they're still
  // fermented milk products, just a denser one — unlike Khoa (Sr.14),
  // which involves no fermentation step at all and is the wrong analogy
  // on process grounds, not just texture. E. coli here is "Absent/g" —
  // a presence test, not a CFU count — hence `presence: true` even
  // inside Table 2A.
  yogurt: {
    table_2a: {
      // APC: "NA" for this row.
      coliform: { n: 5, c: 2, m: 10, M: 100, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 2, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 3, m: 50, M: 100, unit: "CFU/g", name: "Yeast and Mould Count" },
      e_coli: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "E. coli", presence: true },
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Table Butter / White Butter only (via microKey — see those two
  // entries in DAIRY_PRODUCTS.ghee) — Sr.6 "Pasteurized Butter". Real
  // Ghee/Anhydrous Milk Fat/Butter Oil have no matching row in the
  // source at all and stay composition-only (categoryId "ghee" still
  // has no direct MICRO_LIMITS entry of its own).
  butter: {
    table_2a: {
      apc: { n: 5, c: 3, m: 25000, M: 50000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 2, m: 10, M: 20, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 2, m: 10, M: 50, unit: "CFU/g", name: "Staphylococcus aureus" },
      yeast_mould: { n: 5, c: 3, m: 20, M: 50, unit: "CFU/g", name: "Yeast and Mould Count" },
      // E. coli is "Absent/g" here too — a presence test, like Yogurt's.
      e_coli: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "E. coli", presence: true },
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Listeria monocytogenes", presence: true },
    },
  },
  // Sr.9 "Ice Cream, Frozen Dessert, Milk Lolly, Ice Candy" — the default
  // bucket for every WET ice_cream category sub-type (ice_cream,
  // medium/low fat tiers, milk_ice_milk_lolly, frozen_dessert and its
  // medium/low fat tiers). Extracted via pdfplumber word-position
  // parsing (pdftotext -layout badly garbles this table's scientific-
  // notation exponents) — cross-checked against Sr.10/Sr.11's already-
  // coded numbers (Processed Cheese/general Cheese) using the same
  // column-position method before trusting it for a new row; both
  // reproduced the existing coded values exactly. The dried-mix
  // sub-types deliberately do NOT use this bucket — see their own
  // microKey comments in DAIRY_PRODUCTS.ice_cream above.
  ice_cream: {
    table_2a: {
      apc: { n: 5, c: 3, m: 100000, M: 200000, unit: "CFU/g", name: "Aerobic Plate Count" },
      coliform: { n: 5, c: 3, m: 10, M: 100, unit: "CFU/g", name: "Coliform Count" },
      staph_aureus: { n: 5, c: 2, m: 10, M: 100, unit: "CFU/g", name: "Staphylococcus aureus" },
      // Yeast & Mould: "NA" for this row.
      e_coli: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "E. coli", presence: true },
    },
    table_2b: {
      salmonella: { n: 5, c: 0, m: 0, M: null, unit: "/25g", name: "Salmonella sp.", presence: true },
      listeria: { n: 5, c: 0, m: 0, M: null, unit: "/g", name: "Listeria monocytogenes", presence: true },
      // Bacillus cereus / SRC / Enterobacter sakazakii: "NA" for this row.
    },
  },
};

// Fix (dashboard app's static-form lab section wasn't sub-type-aware):
// dashboard.js/demo-controller.js render composition + lab + labelling
// fields all at once, before the sub-type dropdown is picked, so they
// can't show only the resolved microKey's exact fields the way the chat
// flow (site-controller.js) does. Rather than a live re-render on
// dropdown change (a bigger change), this returns the UNION of every
// organism used by the category's default bucket AND every microKey
// any of its sub-types declare — e.g. cheese_processed's APC alongside
// general cheese's Yeast & Mould, or ghee's butter-only panel shown for
// the whole category. validateSubmission() still resolves the ONE
// correct microKey when scoring, so an irrelevant field being present
// and left blank never affects the verdict — it just means a real-Ghee
// submission may show optional lab boxes that only apply if you picked
// Table/White Butter. Returns null only if the category and every one
// of its sub-types' microKeys have no MICRO_LIMITS entry at all.
export function unionMicroLimits(categoryId) {
  const subTypes = DAIRY_PRODUCTS[categoryId] || {};
  const bucketIds = new Set([categoryId, ...Object.values(subTypes).map((s) => s.microKey).filter(Boolean)]);
  const table_2a = {};
  const table_2b = {};
  let found = false;
  for (const id of bucketIds) {
    const limits = MICRO_LIMITS[id];
    if (!limits) continue;
    found = true;
    Object.assign(table_2a, limits.table_2a);
    Object.assign(table_2b, limits.table_2b);
  }
  return found ? { table_2a, table_2b } : null;
}

// ---------------------------------------------------------------
// 6. LABELLING — Mandatory elements, Dairy Bible §7.1 / §7.4
// ---------------------------------------------------------------
// Fix per review item B8: five mandatory elements were missing from this
// checklist entirely, so a report could show a green "Labelling: PASS"
// with these never having been asked about. Ingredient List and
// Veg/Non-Veg Logo are confirmed directly against the Bible (MASTER Ch
// 13.1's "Mandatory Label Elements (All Dairy Products)" table). MRP,
// Consumer Care Details, and Instructions for Use/Storage aren't in
// either Bible document — Ch 13.1 doesn't cover them — so before adding
// them I fetched the actual source the review cited for B8 (FSSAI
// Labelling and Display Regulations 2020, via the GFI India summary PDF
// linked at the bottom of the handoff doc) rather than taking the
// review's word for it; that document confirms all three as mandatory
// ("RETAIL SALE PRICE", "CONSUMER CARE DETAILS", "INSTRUCTIONS FOR USE"
// / storage conditions, in its Figure 1).
export const LABEL_ELEMENTS_ALL = [
  { key: "product_name", label: "Product Name", severity: "CRITICAL" },
  { key: "manufacturer_name", label: "Manufacturer / Brand Name + Address", severity: "CRITICAL" },
  { key: "fssai_license_number", label: "FSSAI License Number + Logo", severity: "CRITICAL" },
  { key: "ingredients", label: "List of Ingredients (descending order by weight; milk may skip)", severity: "CRITICAL" },
  { key: "net_quantity", label: "Net Quantity", severity: "HIGH" },
  { key: "mrp", label: "Maximum Retail Price (MRP)", severity: "HIGH" },
  { key: "batch_number", label: "Batch / Lot Number", severity: "HIGH" },
  { key: "mfg_date", label: "Date of Manufacture", severity: "CRITICAL" },
  { key: "expiry_date", label: "Expiry / Use-By Date", severity: "CRITICAL" },
  { key: "allergen_milk", label: 'Allergen Box: "Contains: MILK"', severity: "CRITICAL" },
  { key: "nutrition_panel", label: "Nutritional Information Panel", severity: "HIGH" },
  { key: "instructions_for_use", label: "Instructions for Use / Storage Conditions", severity: "HIGH" },
  { key: "consumer_care", label: "Consumer Care / Complaint Contact Details", severity: "HIGH" },
];

export const LABEL_ELEMENTS_BY_CATEGORY = {
  milk: [
    { key: "milk_class", label: "Milk Class Declared (e.g. Toned Milk)", severity: "CRITICAL" },
    { key: "heat_treatment_declared", label: "Heat Treatment Declared (Pasteurised/UHT/etc.)", severity: "CRITICAL" },
    // Veg/Non-Veg Logo is explicitly EXEMPT for milk and milk powders
    // per Bible Ch 13.1 — deliberately not listed here.
  ],
  // Bible Ch 13.1 names paneer as explicitly requiring the Veg/Non-Veg
  // logo (milk and milk powders are the only named exemptions), and
  // cheese isn't on that exemption list either — some cheese-making
  // uses animal rennet, which is exactly the kind of thing this
  // declaration exists to surface, so it's treated as required here too.
  paneer: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
  ],
  cheese: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
  ],
  // Ghee/Butter isn't on Bible Ch 13.1's exemption list either (only milk
  // and milk powders are named) — same reasoning as paneer/cheese above.
  // "ghee_type_declared" added: FSS 2.1.8, Item 6(a) requires the label
  // name to be exactly "Milk fat or Butter Oil" / "Anhydrous Milk fat or
  // Anhydrous Butter Oil" / "Ghee" depending on which composition band
  // applies, and FSS 2.1.9, Item 6(a) separately requires Butter's label
  // to say "Pasteurized Table butter" or "White butter/Cooking Butter" —
  // a real, sourced requirement distinct from Product Name, same
  // pattern as Yogurt's "yogurt_type_declared".
  ghee: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "ghee_type_declared", label: "Product Name Matches Type (Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, Ghee, Pasteurized Table Butter, or White Butter/Cooking Butter)", severity: "CRITICAL" },
  ],
  // milk_powder has no entry here on purpose — it's the other named
  // exemption on Bible Ch 13.1's list (alongside milk, see the comment
  // above), so it gets no extra Veg/Non-Veg Logo requirement now that
  // it's live.
  // Yogurt/Dahi isn't on Bible Ch 13.1's exemption list either (only milk
  // and milk powders are named) — same reasoning as paneer/cheese/ghee
  // above. Item 6(b) of FSS 2.1.13 also separately requires the specific
  // type (Dahi, Yoghurt, Chakka, Shrikhand, etc.) to always be declared
  // on the label — added here as its own element since it's a distinct,
  // sourced requirement, not a duplicate of Product Name. Item 6(c)'s
  // probiotic-culture declaration is conditional (only when those
  // cultures are actually added) rather than universally applicable, so
  // it isn't added as a checklist item here.
  yogurt: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "yogurt_type_declared", label: "Type Declared (Dahi, Yoghurt, Chakka, Shrikhand, etc.)", severity: "CRITICAL" },
  ],
  // Ice Cream/Frozen Dessert isn't on Bible Ch 13.1's exemption list
  // either (only milk and milk powders are named) — same reasoning as
  // paneer/cheese/ghee/yogurt above. FSS 2.1.14 Item 6(b) and FSS 2.1.15
  // Item 6(b) both separately require the fat tier (Full/Medium/Low Fat,
  // or Milk Ice/Milk Lolly) to always be indicated on the label — added
  // as its own element, same pattern as Ghee's "ghee_type_declared" and
  // Yogurt's "yogurt_type_declared". Ice Cream's starch declaration
  // (Item 6(c), conditional on the product actually containing starch)
  // and Frozen Dessert's not-yet-in-force Item 6(c) fat-source
  // declaration are both documented gaps, not checklist items here — see
  // the long comment above DAIRY_PRODUCTS.ice_cream.
  ice_cream: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "ice_cream_type_declared", label: "Type/Fat-Tier Declared (Ice Cream/Kulfi/etc., Medium Fat, Low Fat, Milk Ice/Milk Lolly, Frozen Dessert, etc.)", severity: "CRITICAL" },
  ],
  // Khoa isn't on Bible Ch 13.1's exemption list either (only milk and
  // milk powders are named) — same reasoning as every other category
  // above. No "type declared" element here unlike Ghee/Yogurt/Ice
  // Cream: those each cover several composition-based variants that
  // must be named correctly on the label; Khoa's own labelling clause
  // (FSS 2.1.6, Item 6(a): "The name of the food shall be 'Khoa' or
  // 'Mawa' or any other region specific popular name") is fully
  // satisfied by the general Product Name element already in
  // LABEL_ELEMENTS_ALL — there's no second, distinct name to cross-check
  // against composition since this category has only one product.
  khoa: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
  ],
  // Flavoured Milk isn't on Bible Ch 13.1's exemption list either — that
  // list names only "milk and milk powders" (see the milk_powder comment
  // above), and Flavoured Milk is a distinct standard (FSS 2.1.3) from
  // plain Milk, so the exemption does not carry over even though the two
  // are closely related. FSS 2.1.3, Item 6(b) separately requires two
  // declarations, word-for-word: "(i) the class of milk ... from which
  // it is prepared; (ii) the heat treatment ... to which product has
  // been subjected to" — the exact same two facts plain Milk's own
  // milk_class/heat_treatment_declared elements already check, so they
  // are reused here unchanged rather than invented anew.
  flavoured_milk: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "milk_class", label: "Milk Class Declared (e.g. Toned Milk)", severity: "CRITICAL" },
    { key: "heat_treatment_declared", label: "Heat Treatment Declared (Pasteurised/UHT/etc.)", severity: "CRITICAL" },
  ],
  // Evaporated/Concentrated Milk isn't on Bible Ch 13.1's exemption list
  // either — that list names only "milk and milk powders", not this
  // separate standard (FSS 2.1.4). Item 6(a) requires the label name to
  // match the composition tier exactly ("evaporated milk", "evaporated
  // partly skimmed milk" — or "evaporated semi-skimmed milk" in its own
  // narrower fat/solids band, not separately encoded, see the long
  // comment on DAIRY_PRODUCTS.evaporated_milk — "evaporated skimmed
  // milk", or "evaporated high fat milk") — same "type declared" pattern
  // as Ghee's ghee_type_declared/Yogurt's yogurt_type_declared/Ice
  // Cream's ice_cream_type_declared.
  evaporated_milk: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "evaporated_milk_type_declared", label: "Type Declared (Evaporated Milk, Evaporated Partly Skimmed Milk, Evaporated Skimmed Milk, or Evaporated High Fat Milk)", severity: "CRITICAL" },
  ],
  // Sweetened Condensed Milk isn't on Bible Ch 13.1's exemption list
  // either. FSS 2.1.5, Item 6(a) requires the label name to match the
  // composition tier exactly — same "type declared" pattern as
  // Evaporated Milk. Item 6(b)'s infant-feeding-instruction prohibition
  // is a documented gap (a "must NOT contain" clause, not a "declared"
  // checkbox this pattern expresses) — see the long comment on
  // DAIRY_PRODUCTS.sweetened_condensed_milk, not added here.
  sweetened_condensed_milk: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "sweetened_condensed_milk_type_declared", label: "Type Declared (Sweetened Condensed Milk, Sweetened Condensed Partly Skimmed Milk, Sweetened Condensed Skimmed Milk, or Sweetened Condensed High Fat Milk)", severity: "CRITICAL" },
  ],
  // Cream and Malai isn't on Bible Ch 13.1's exemption list either — that
  // list names only "milk and milk powders". FSS 2.1.7, Item 6(a)
  // requires "the type of cream and the fat content in cream" to always
  // be indicated on the label (or, per Item 6(b), described using the
  // Low/Medium/High Fat Cream bands once the fat content is known — see
  // the long comment on DAIRY_PRODUCTS.cream for why those bands aren't
  // separate composition sub-types) — same "type declared" pattern as
  // Ghee/Yogurt/Ice Cream/Evaporated Milk/Sweetened Condensed Milk above.
  // Item 6(a) also requires the product to be named "Malai" specifically
  // when it matches that description — satisfied by the general Product
  // Name element already in LABEL_ELEMENTS_ALL, same treatment as Khoa's
  // single-name clause. Item 6(d)'s heat-treatment declaration reuses
  // Milk's own heat_treatment_declared element unchanged, same reuse
  // pattern as Flavoured Milk above.
  cream: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "cream_fat_content_declared", label: "Type of Cream / Fat Content Declared (or 'Malai', if applicable)", severity: "CRITICAL" },
    { key: "heat_treatment_declared", label: "Heat Treatment Declared (Pasteurised/UHT/etc.)", severity: "CRITICAL" },
  ],
  // Dairy Whitener isn't on Bible Ch 13.1's exemption list either — that
  // list names only "milk and milk powders" (FSS 2.1.10), and Dairy
  // Whitener is a distinct standard (FSS 2.1.11), similar in form but not
  // literally "milk powder". Item 6(a) requires the label name to match
  // the composition tier exactly (Skimmed Milk/Low Fat/Medium Fat/High
  // Fat Dairy Whitener) — same "type declared" pattern as every other
  // multi-tier category above.
  dairy_whitener: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "dairy_whitener_type_declared", label: "Type Declared (Skimmed Milk, Low Fat, Medium Fat, or High Fat Dairy Whitener)", severity: "CRITICAL" },
  ],
  // Whey Powder isn't on Bible Ch 13.1's exemption list either — that
  // list names only "milk and milk powders", not this distinct standard
  // (FSS 2.1.12). Item 6(a) requires the label name to match the
  // composition tier exactly (Whey Powder or Acid Whey Powder) — same
  // "type declared" pattern as every other multi-tier category above.
  whey_powder: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "whey_powder_type_declared", label: "Type Declared (Whey Powder or Acid Whey Powder)", severity: "CRITICAL" },
  ],
  // Edible Casein Products isn't on Bible Ch 13.1's exemption list
  // either — that list names only "milk and milk powders". Item 6(a),
  // quoted directly: "the name of the product shall be Edible Acid
  // Casein or Edible Rennet Casein or Edible Caseinate. Edible Caseinate
  // shall also be qualified by the name of the cation in the
  // neutralizing agent used." — same "type declared" pattern as every
  // other multi-tier category above, plus a second element for
  // Caseinate's own extra cation-naming requirement (a "declared"
  // checkbox, not a numeric/compositional check, so it applies
  // regardless of which of the 3 sub-types was actually selected — same
  // reasoning as Cream's heat_treatment_declared reuse).
  casein_products: [
    { key: "veg_non_veg_logo", label: "Veg/Non-Veg Logo", severity: "CRITICAL" },
    { key: "casein_type_declared", label: "Type Declared (Edible Acid Casein, Edible Rennet Casein, or Edible Caseinate)", severity: "CRITICAL" },
    { key: "caseinate_cation_declared", label: "Cation of Neutralizing Agent Declared (Edible Caseinate only)", severity: "MEDIUM" },
  ],
  // Milk Protein Concentrate's Item 5(b), quoted directly: "The milk
  // protein content shall be declared on the label as a percentage by
  // mass." — a real, distinct declaration, not just the generic product
  // name. Item 5(a) also allows an optional "MPC __" supplemental
  // designation, but that's a naming option, not a separate mandatory
  // declaration, so no second element for it.
  milk_protein_concentrate: [
    { key: "milk_protein_content_declared", label: "Milk Protein Content Declared, as % by Mass", severity: "HIGH" },
  ],
  // Whey Protein Concentrate's Item 5(b) carries the identical
  // "percentage by mass" clause verbatim — same element, same key, as
  // Milk Protein Concentrate above.
  whey_protein_concentrate: [
    { key: "milk_protein_content_declared", label: "Milk Protein Content Declared, as % by Mass", severity: "HIGH" },
  ],
  // Colostrum Products' Item 5, quoted directly: "(a) The name of the
  // products covered by sub-item (a) of item 1 shall be 'colostrum'. (b)
  // The name of the products covered by sub-item (b) of item 1 shall be
  // 'colostrum powder'." — same "type declared" pattern as Edible Casein
  // Products above (see DAIRY_PRODUCTS.colostrum_products' own long
  // comment for the sub-item lettering inconsistency this quotes
  // faithfully rather than silently resolving).
  colostrum_products: [
    { key: "colostrum_type_declared", label: "Type Declared (Colostrum or Colostrum Powder)", severity: "CRITICAL" },
  ],
  // Dairy Permeate Powders' Item 5(a), quoted directly: "the name of the
  // food shall be 'lactose-rich deproteinized ………………permeate powder' where
  // the blank may be filled with the term dairy, milk or whey, as
  // appropriate to the nature of the product." — same "type declared"
  // pattern as Casein/Colostrum above, since the sub-type IS the mandated
  // name here.
  dairy_permeate_powders: [
    { key: "permeate_powder_type_declared", label: "Name Declared as 'Lactose-Rich Deproteinized Dairy/Milk/Whey Permeate Powder' (as appropriate)", severity: "CRITICAL" },
  ],
};

// ================================================================
// Additives, processing aids, contaminants and claim-review data
// ----------------------------------------------------------------
// Added for the New Submission v2.0 spec ("show applicable requirements
// with their regulatory basis; never dump the full regulation onto the
// user"). Sources:
//   - Food Safety and Standards (Food Products Standards and Food
//     Additives) Regulations, 2011, Appendix A (Table 1 — "Dairy
//     products and analogues", categories 1.1-1.8; Table 2 §2.1.1 for
//     Ghee/Butter Oil/Anhydrous Milk Fat, which Table 1 explicitly
//     excludes) — Version 3 (01.08.2025).
//   - Same Regulations, Appendix C (Processing Aids) — Version 2
//     (01.08.2025).
//   - Food Safety and Standards (Contaminants, Toxins and Residues)
//     Regulations, 2011, as amended.
// This is NOT a transcription of every row in these tables — Appendix A's
// dairy table alone runs ~40 pages, most of it near-identical GMP-level
// stabilisers/gums/starches repeated across sub-categories. Every entry
// with an explicit numeric limit, an explicit "no additives" exception, or
// a named future amendment is preserved verbatim with its source; the
// GMP-only technical class (thickeners, emulsifiers, acidity regulators)
// is summarised with a pointer back to the exact source table instead of
// copied line by line — same "don't dump the regulation" principle the
// contaminants section below follows explicitly. A category with no entry
// here means this hasn't been compiled into Inspeckt yet — never read
// that as "no additives/processing aids/contaminants apply to it."

export const ADDITIVES_SOURCE = {
  sourceDocument: "FSSAI Food Products Standards and Food Additives Regulations, 2011 — Appendix A",
  version: "Version 3 (01.08.2025)",
  status: "current",
};

export const ADDITIVES_BY_CATEGORY = {
  milk: {
    subCategory: "1.1.1.1 Milk (plain) / 1.1.1.2 Buttermilk (plain)",
    notable: [
      { name: "PHOSPHATES", maxLevel: "1,500 mg/kg", condition: "Milk (plain) and Buttermilk (plain)", note: "33, 227" },
    ],
    exception: "Milk and buttermilk (plain) otherwise carry NO permitted additives (Table 1, category 1.1.1).",
  },
  flavoured_milk: {
    subCategory: "1.1.2 Dairy-based drinks, flavoured and/or fermented",
    notable: [
      { name: "Tartrazine", insNo: "102", maxLevel: "100 mg/kg" },
      { name: "Sunset Yellow FCF", insNo: "110", maxLevel: "100 mg/kg", note: "52" },
      { name: "Allura Red AC", insNo: "129", maxLevel: "100 mg/kg" },
      { name: "Aspartame", insNo: "951", maxLevel: "600 mg/kg", note: "191" },
      { name: "Acesulfame potassium", insNo: "950", maxLevel: "350 mg/kg", note: "188" },
      { name: "Sucralose", insNo: "955", maxLevel: "300 mg/kg" },
      { name: "Steviol glycosides", insNo: "960", maxLevel: "200 mg/kg", note: "26, 201" },
      { name: "SORBATES", maxLevel: "1,000 mg/kg", note: "220, 42" },
      { name: "SACCHARINS", maxLevel: "80 mg/kg" },
      { name: "Caramel colours III/IV", insNo: "150c / 150d", maxLevel: "up to 2,000 mg/kg" },
      { name: "Hydroxypropyl methyl cellulose", insNo: "464", maxLevel: "7.5 g/kg", condition: "flavoured milk only" },
    ],
    gmpNote: "Plus GMP-permitted colours, sequestrants and stabilisers (phosphates, polysorbates, sodium aluminosilicate) — see source Table 1 for the complete list.",
  },
  yogurt: {
    subCategory: "1.2 Fermented and renneted milk products",
    notable: [
      { name: "Plain Dahi", maxLevel: "No additives permitted", note: "footnote to Table 1, category 1.2.1" },
      { name: "Fermented milks not heat-treated after fermentation", maxLevel: "No additives permitted", note: "category 1.2.1.1" },
      { name: "Caramel IV (sulfite ammonia caramel)", insNo: "150d", maxLevel: "150 mg/kg", condition: "fermented milks (plain), heat-treated" },
      { name: "CAROTENOIDS", maxLevel: "100 mg/kg", condition: "flavoured and fruit yoghurt only (INS 160f only)" },
      { name: "Nisin", insNo: "234", maxLevel: "12.5 mg/kg" },
    ],
    gmpNote: "Fermented milks heat-treated after fermentation (yoghurt, flavoured yoghurt, flavoured dahi, mishti dahi) also permit a long list of GMP-level stabilisers/thickeners (gums, celluloses, modified starches, alginates, citrates) — see source Table 1, categories 1.2.1.2 / 1.2.2 for the complete list.",
  },
  cream: {
    subCategory: "1.4 Cream and the like, cream and malai",
    notable: [
      { name: "Pasteurized cream (plain), cream and malai", maxLevel: "No additives permitted", note: "Table 1, category 1.4.1" },
      { name: "PHOSPHATES", maxLevel: "2,200 mg/kg", condition: "sterilized/UHT/whipping/reduced-fat creams (1.4.2)", note: "33" },
      { name: "Nisin", insNo: "234", maxLevel: "10 mg/kg", condition: "clotted cream (1.4.3)" },
      { name: "Aspartame", insNo: "951", maxLevel: "1,000 mg/kg", condition: "cream analogues (1.4.4)", note: "191" },
    ],
    gmpNote: "Sterilized/UHT/whipping/reduced-fat creams also permit a long list of GMP-level stabilisers (starches, gums, alginates, celluloses) — see source Table 1, category 1.4.2 for the complete list.",
  },
  evaporated_milk: {
    subCategory: "1.3.1 Condensed milk(s), evaporated milk(s), sweetened condensed milk(s)",
    notable: [
      { name: "Sodium/Potassium/Calcium citrates, PHOSPHATES, sodium/potassium carbonate, potassium/calcium chloride", maxLevel: "combined total salt content shall not exceed 3,000 mg/kg, singly or in combination, calculated as phosphorus/carbonates/citrate/chloride" },
      { name: "Glucono delta-lactone", insNo: "575", maxLevel: "GMP", condition: "permitted in khoya only" },
      { name: "Propionic acid / sodium propionate / calcium propionate", insNo: "280, 281, 282", maxLevel: "2,000 mg/kg", condition: "permitted in khoya only" },
      { name: "SORBATES", maxLevel: "2,000 mg/kg", condition: "permitted in khoya only" },
      { name: "Nisin", insNo: "234", maxLevel: "12.5 mg/kg", condition: "permitted in khoya only" },
      { name: "Carrageenan", insNo: "407", maxLevel: "150 mg/kg" },
    ],
  },
  sweetened_condensed_milk: { sameAs: "evaporated_milk" },
  khoa: { sameAs: "evaporated_milk" },
  milk_powder: {
    subCategory: "1.5 Milk powder and cream powder and powder analogues (plain), incl. dairy-based dairy whitener",
    notable: [
      { name: "ASCORBYL ESTERS", maxLevel: "500 mg/kg", note: "10" },
      { name: "Butylated hydroxyanisole (BHA)", insNo: "320", maxLevel: "100 mg/kg", note: "15, 196" },
      { name: "Butylated hydroxytoluene (BHT)", insNo: "321", maxLevel: "200 mg/kg", note: "15, 196" },
      { name: "Calcium aluminium silicate", insNo: "556", maxLevel: "265 mg/kg", note: "6, 259" },
      { name: "PHOSPHATES", maxLevel: "3,000 mg/kg", note: "33" },
      { name: "Sodium aluminosilicate", insNo: "554", maxLevel: "265 mg/kg" },
    ],
    gmpNote: "Powder analogues (1.5.2) additionally permit sweeteners (acesulfame-K, aspartame), colours (caramel, beta-carotenes) and higher phosphate/polysorbate levels — see source Table 1, category 1.5.2 for the complete list.",
  },
  dairy_whitener: { sameAs: "milk_powder" },
  cheese: {
    subCategory: "1.6 Cheese and analogues (exact list varies by sub-type — unripened/paneer-chhana, ripened, processed, analogue, whey cheese)",
    notable: [
      { name: "Natamycin (Pimaricin)", insNo: "235", maxLevel: "40 mg/kg", note: "surface treatment; 3, 80" },
      { name: "Nisin", insNo: "234", maxLevel: "12–12.5 mg/kg" },
      { name: "SORBATES", maxLevel: "2,000–3,000 mg/kg", condition: "level depends on sub-type", note: "42" },
      { name: "Propionic acid / propionates", insNo: "280–283", maxLevel: "3,000 mg/kg", condition: "singly or in combination, expressed as propionic acid" },
      { name: "Calcium chloride", insNo: "509", maxLevel: "200 mg/kg", condition: "except cream cheese" },
      { name: "Carrageenan", insNo: "407", maxLevel: "5,000 mg/kg", condition: "cream cheese only" },
      { name: "Glucono delta-lactone", insNo: "575", maxLevel: "GMP", condition: "for chhana and paneer only" },
      { name: "Sodium/potassium salts of mono/di/poly phosphoric acid", insNo: "339, 340, 450–452", maxLevel: "9,000 mg/kg", condition: "ripened cheese; total salt content should not exceed 9,000 mg/kg" },
      { name: "Lauric arginate ethyl ester", insNo: "243", maxLevel: "200 mg/kg" },
      { name: "Colours (Curcumin, Annatto, beta-carotenes, caramel, Ponceau 4R, etc.)", maxLevel: "50–50,000 mg/kg, depending on sub-type and colour" },
    ],
    gmpNote: "Exact permitted additive/colour list depends on the specific cheese sub-type (unripened, ripened, rind, processed, analogue, whey cheese, whey protein cheese) — see source Table 1, categories 1.6.1–1.6.6 for the complete breakdown.",
  },
  paneer: { sameAs: "cheese" },
  ice_cream: {
    subCategory: "1.7 Dairy-based desserts",
    notable: [
      { name: "ASCORBYL ESTERS", maxLevel: "500 mg/kg", note: "10, 2" },
      { name: "Acesulfame potassium", insNo: "950", maxLevel: "350 mg/kg", note: "188" },
      { name: "Aspartame", insNo: "951", maxLevel: "1,000 mg/kg", note: "191" },
      { name: "BENZOATES", maxLevel: "300 mg/kg", note: "13" },
      { name: "Butylated hydroxyanisole (BHA)", insNo: "320", maxLevel: "200 mg/kg", condition: "only for rasgulla dry mixes" },
      { name: "SACCHARINS", maxLevel: "100 mg/kg" },
      { name: "SORBATES", maxLevel: "1,000 mg/kg", note: "42" },
      { name: "Sucralose", insNo: "955", maxLevel: "400 mg/kg" },
      { name: "Steviol glycosides", insNo: "960", maxLevel: "330 mg/kg", note: "26" },
      { name: "Propyl gallate", insNo: "310", maxLevel: "90 mg/kg", note: "15, 2" },
    ],
    gmpNote: "Plus GMP-permitted emulsifiers/stabilisers (polyoxyethylene sorbitan esters, polyglycerol esters, modified starches, microcrystalline cellulose) — see source Table 1, category 1.7 for the complete list.",
  },
  whey_powder: {
    subCategory: "1.8 Whey and whey products, excluding whey cheeses",
    notable: [
      { name: "Benzoyl peroxide", insNo: "928", maxLevel: "100 mg/kg", condition: "liquid whey: note 74; dried whey: note 147" },
      { name: "PHOSPHATES", maxLevel: "880 mg/kg", condition: "liquid whey", note: "33, 228" },
      { name: "PHOSPHATES", maxLevel: "4,400 mg/kg", condition: "dried whey", note: "33" },
      { name: "Sodium aluminosilicate", insNo: "554", maxLevel: "1,140 mg/kg", note: "6" },
    ],
    gmpNote: "Dried whey also permits a range of GMP-level anticaking/carrier agents (calcium carbonate, magnesium carbonate/oxide, silicon dioxide, talc) up to 10,000 mg/kg each — see source Table 1, category 1.8.2 for the complete list.",
  },
  ghee: {
    subCategory: "2.1.1 Fats and oils essentially free from water — Butter oil, anhydrous milk fat and ghee (Table 2, not Table 1 — Table 1 explicitly excludes this category)",
    notable: [
      { name: "Ghee", maxLevel: "No additives permitted", note: "explicit exception within category 2.1.1" },
      { name: "ASCORBYL ESTERS", maxLevel: "500 mg/kg", condition: "Butter oil / Anhydrous Milk Fat only", note: "10, 171" },
      { name: "Butylated hydroxyanisole (BHA)", insNo: "320", maxLevel: "175 mg/kg", condition: "Butter oil / Anhydrous Milk Fat only", note: "15, 171, 133" },
      { name: "Butylated hydroxytoluene (BHT)", insNo: "321", maxLevel: "75 mg/kg", condition: "Butter oil / Anhydrous Milk Fat only", note: "15, 171, 133" },
      { name: "Propyl gallate", insNo: "310", maxLevel: "100 mg/kg", note: "15, 133, 171" },
      { name: "Gallate (octyl/ethyl/dodecyl)", insNo: "311, 312, 313", maxLevel: "100 mg/kg" },
      { name: "Citric acid", insNo: "330", maxLevel: "GMP", note: "171" },
    ],
  },
};

export const PROCESSING_AIDS_SOURCE = {
  sourceDocument: "FSSAI Food Products Standards and Food Additives Regulations, 2011 — Appendix C (Processing Aids)",
  version: "Version 2 (01.08.2025)",
  status: "current",
};

export const PROCESSING_AIDS_BY_CATEGORY = {
  milk: [
    { name: "Peroxidase (EC 1.11.1.7)", source: "Aspergillus niger, expressing Marasmius scorodonius", use: "Preservation of raw milk, yoghurt and cheese", productCategory: "Dairy processing (whey processing)", level: "GMP", table: "Appendix C, Table 11, enzyme 4" },
    { name: "Phospholipase A1 (EC 3.1.1.32)", source: "Aspergillus oryzae, expressing Fusarium venenatum", use: "Modifies the functionality of dairy products and their ingredients", productCategory: "Milk and dairy based products", level: "GMP", table: "Appendix C, Table 11, enzyme 12" },
    { name: "Lactase / Beta-galactosidase (EC 3.2.1.23)", source: "Multiple expression hosts (Kluyveromyces lactis, Aspergillus oryzae/niger, Bacillus spp.)", use: "Hydrolysis of lactose in whey or milk; GOS production; low-lactose products", productCategory: "Dairy products and processing", level: "GMP", table: "Appendix C, Table 11, enzyme 25" },
    { name: "Glutaminase (EC 3.5.1.2)", source: "Bacillus licheniformis", use: "Controls taste and flavour of fermented foods containing casein or whey protein", productCategory: "Dairy processing", level: "GMP", table: "Appendix C, Table 11, enzyme 42" },
  ],
  yogurt: { sameAs: "milk" },
  cheese: [
    { name: "Citric acid / Glucono delta-lactone / Lactic acid / Malic acid / Sour whey / Vinegar", use: "Coagulating agent", productCategory: "Unripened cheese — Paneer and Chhana", level: "GMP", table: "Appendix C, Table 8" },
    { name: "Chymosin (EC 3.4.23.4)", source: "Trichoderma reesei (expressing Bos taurus prochymosin) or Kluyveromyces lactis (bovine pro-chymosin)", use: "Milk coagulant — cheese, whey and lactose production", productCategory: "Milk or dairy processing", level: "GMP", table: "Appendix C, Table 11, enzyme 37" },
    { name: "Mucorpepsin / Mucor rennin (EC 3.4.23.23)", source: "Aspergillus oryzae, expressing Rhizomucor miehei", use: "Milk coagulation in cheese making", productCategory: "Dairy processing", level: "GMP", table: "Appendix C, Table 11, enzyme 39" },
    { name: "Carboxypeptidase (EC 3.4.16.5)", source: "Aspergillus niger", use: "Accelerates flavour development and de-bittering during cheese ripening", productCategory: "Cheese, enzyme-modified cheese, cheese powders", level: "GMP", table: "Appendix C, Table 11, enzyme 32" },
    { name: "Chymosin (EC 3.4.23.4)", source: "Aspergillus niger var. Awamori, expressing Bos taurus", use: "Milk-coagulating enzyme — manufacture of paneer and cheese", productCategory: "Paneer and cheese manufacture", level: "GMP", table: "Appendix C, Table 11, enzyme 51", status: "future", effectiveFrom: "1 February 2026" },
    { name: "Paraffin", use: "Coating agent", productCategory: "Cheese and cheese products", level: "GMP", table: "Appendix C, Table 12, entry 42" },
    { name: "Polyvinyl acetate", use: "Preparation of waxes", productCategory: "Cheese and cheese products", level: "GMP", table: "Appendix C, Table 12, entry 48" },
  ],
  paneer: { sameAs: "cheese" },
  ice_cream: [
    { name: "Liquid Nitrogen (INS 941)", use: "Contact freezing/cooling agent", productCategory: "Dairy-based desserts — Ice cream", level: "GMP", table: "Appendix C, Table 9" },
  ],
  whey_powder: [
    { name: "Lactase / Beta-galactosidase (EC 3.2.1.23)", source: "Multiple expression hosts", use: "Hydrolysis of lactose in whey or milk", productCategory: "Dairy products and processing", level: "GMP", table: "Appendix C, Table 11, enzyme 25" },
  ],
};

export const CONTAMINANTS_SOURCE = {
  sourceDocument: "Food Safety and Standards (Contaminants, Toxins and Residues) Regulations, 2011",
  version: "as amended",
  status: "current",
};

// Every dairy-relevant limit that names Milk / Milk Products / Milk (whole)
// / Milk (fat basis) explicitly in the source tables. Of the roughly 150
// substances across the metal-contaminant, crop-contaminant and pesticide-
// residue tables in this regulation, only the ones with a real Milk or
// Milk Products entry are kept here — everything else genuinely isn't
// identified as applicable to a dairy product, which is exactly what the
// brief should say instead of listing all ~150.
export const CONTAMINANTS_BY_CATEGORY = {
  milk: [
    { contaminant: "Arsenic", limit: "0.1", unit: "ppm", condition: "Milk", table: "Reg. 2.1.1(2), Metal Contaminants Table", type: "metal" },
    { contaminant: "Aflatoxin M1", limit: "0.5", unit: "µg/kg", condition: "Milk", table: "Reg. 2.2.1(1), Crop Contaminants Table", type: "crop" },
    { contaminant: "Aldrin and Dieldrin (combined, as dieldrin)", limit: "0.15", unit: "mg/kg", condition: "Milk and Milk products, on a fat basis", table: "Reg. 2.3.1(2), Insecticide Residues Table, entry 1", type: "pesticide_residue" },
    { contaminant: "Chlordane (as cis + trans)", limit: "0.05", unit: "mg/kg", condition: "Milk and milk products, on a fat basis", table: "Reg. 2.3.1(2), entry 3", type: "pesticide_residue" },
    { contaminant: "D.D.T. (D.D.T. + D.D.D. + D.D.E., combined)", limit: "1.25", unit: "mg/kg", condition: "Milk and milk products, on a fat basis", table: "Reg. 2.3.1(2), entry 4", type: "pesticide_residue" },
    { contaminant: "Fenitrothion", limit: "0.05", unit: "mg/kg", condition: "Milk and Milk Products, on a fat basis", table: "Reg. 2.3.1(2), entry 16", type: "pesticide_residue" },
    { contaminant: "Heptachlor (as heptachlor + epoxide)", limit: "0.15", unit: "mg/kg", condition: "Milk and Milk Products, on a fat basis", table: "Reg. 2.3.1(2), entry 17", type: "pesticide_residue" },
    { contaminant: "Hexachlorocyclohexane, alpha isomer", limit: "0.02", unit: "mg/kg", condition: "Milk (whole)", table: "Reg. 2.3.1(2), entry 21(a)", type: "pesticide_residue" },
    { contaminant: "Hexachlorocyclohexane, beta isomer", limit: "0.02", unit: "mg/kg", condition: "Milk (whole)", table: "Reg. 2.3.1(2), entry 21(b)", type: "pesticide_residue" },
    { contaminant: "Hexachlorocyclohexane, gamma isomer (Lindane)", limit: "0.01 (whole basis); Milk products 0.20 (whole basis)", unit: "mg/kg", condition: "Milk; Milk products; Milk products (<2% fat)", table: "Reg. 2.3.1(2), entry 21(c)", type: "pesticide_residue" },
    { contaminant: "Hexachlorocyclohexane, delta isomer", limit: "0.02", unit: "mg/kg", condition: "Milk (whole)", table: "Reg. 2.3.1(2), entry 21(d)", type: "pesticide_residue" },
    { contaminant: "Chlorfenvinphos", limit: "0.2", unit: "mg/kg", condition: "Milk and Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 27", type: "pesticide_residue" },
    { contaminant: "Chlorpyrifos", limit: "0.01", unit: "mg/kg", condition: "Milk and Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 29", type: "pesticide_residue" },
    { contaminant: "2,4-D", limit: "0.05", unit: "mg/kg", condition: "Milk and Milk Products", table: "Reg. 2.3.1(2), entry 30", type: "pesticide_residue" },
    { contaminant: "Ethion", limit: "0.5", unit: "mg/kg", condition: "Milk and Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 31", type: "pesticide_residue" },
    { contaminant: "Monocrotophos", limit: "0.02", unit: "mg/kg", condition: "Milk and Milk Products", table: "Reg. 2.3.1(2), entry 33", type: "pesticide_residue" },
    { contaminant: "Paraquat Dichloride (as paraquat cation)", limit: "0.01", unit: "mg/kg", condition: "Milk (whole)", table: "Reg. 2.3.1(2), entry 34", type: "pesticide_residue" },
    { contaminant: "Trichlorfon", limit: "0.05", unit: "mg/kg", condition: "Milk (whole)", table: "Reg. 2.3.1(2), entry 36", type: "pesticide_residue" },
    { contaminant: "Carbendazim", limit: "0.10", unit: "mg/kg", condition: "Milk & Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 42", type: "pesticide_residue" },
    { contaminant: "Benomyl", limit: "0.10", unit: "mg/kg", condition: "Milk & Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 43", type: "pesticide_residue" },
    { contaminant: "Carbofuran (as carbofuran + 3-hydroxy carbofuran)", limit: "0.05", unit: "mg/kg", condition: "Milk & Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 45", type: "pesticide_residue" },
    { contaminant: "Cypermethrin (sum of isomers)", limit: "0.01", unit: "mg/kg", condition: "Milk and Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 47", type: "pesticide_residue" },
    { contaminant: "Fenthion (sum with oxygen analogue, sulphoxides/sulphones)", limit: "0.05", unit: "mg/kg", condition: "Milk and Milk products, fat basis", table: "Reg. 2.3.1(2), entry 50", type: "pesticide_residue" },
    { contaminant: "Fenvalerate (fat soluble residue)", limit: "0.01", unit: "mg/kg", condition: "Milk and Milk Product, fat basis", table: "Reg. 2.3.1(2), entry 51", type: "pesticide_residue" },
    { contaminant: "Phenthoate", limit: "0.01", unit: "mg/kg", condition: "Milk & Milk products, fat basis", table: "Reg. 2.3.1(2), entry 53", type: "pesticide_residue" },
    { contaminant: "Phorate (sum with oxygen analogue, sulphoxides/sulphones)", limit: "0.05", unit: "mg/kg", condition: "Milk & Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 54", type: "pesticide_residue" },
    { contaminant: "Pirimiphos-methyl", limit: "0.05", unit: "mg/kg", condition: "Milk & Milk Products, fat basis", table: "Reg. 2.3.1(2), entry 56", type: "pesticide_residue" },
  ],
};

// Several product categories (flavoured milk, evaporated/condensed milk,
// khoa, cream, milk powder, dairy whitener, yogurt, paneer, cheese, ghee,
// ice cream, whey powder) are made from the same raw milk and share this
// regulation's Milk/Milk Products contaminant exposure, even though each
// gets its OWN additive/processing-aid table above — this list is what
// contaminantsFor() below reads to avoid duplicating the same 26-row Milk
// table under every dairy category id.
export const CONTAMINANTS_SHARE_MILK_BUCKET = [
  "milk", "flavoured_milk", "evaporated_milk", "sweetened_condensed_milk",
  "cream", "khoa", "milk_powder", "dairy_whitener", "yogurt", "paneer",
  "cheese", "ghee", "ice_cream", "whey_powder",
];

/** Resolves a category's ADDITIVES_BY_CATEGORY entry, following one level of `sameAs`. */
export function additivesFor(categoryId) {
  const entry = ADDITIVES_BY_CATEGORY[categoryId];
  if (!entry) return null;
  return entry.sameAs ? ADDITIVES_BY_CATEGORY[entry.sameAs] : entry;
}
/** Resolves a category's PROCESSING_AIDS_BY_CATEGORY entry, following one level of `sameAs`. */
export function processingAidsFor(categoryId) {
  const entry = PROCESSING_AIDS_BY_CATEGORY[categoryId];
  if (!entry) return null;
  return entry.sameAs ? PROCESSING_AIDS_BY_CATEGORY[entry.sameAs] : entry;
}
/** Resolves a category's dairy contaminant exposure via the shared Milk bucket. */
export function contaminantsFor(categoryId) {
  if (!CONTAMINANTS_SHARE_MILK_BUCKET.includes(categoryId)) return null;
  return CONTAMINANTS_BY_CATEGORY.milk;
}

// -----------------------------------------------------------------------
// Applicability engine: "same regulatory table" is not "same applicable
// requirement." additivesFor()/processingAidsFor() resolve BOTH "paneer"
// and "cheese" to one shared Appendix A / Appendix C row set — but that
// row set is itself written per FSSAI's own Table 1 sub-category
// structure (1.6.1 unripened cheese/chhana-paneer, 1.6.2 ripened, rind,
// processed, cream cheese, whey cheese...), not one undifferentiated
// bucket. A row conditioned to "cream cheese only" or "ripened cheese"
// does not become applicable to Standard Paneer just because it lives in
// the same appendix table — a founder-facing report must classify each
// row against the product actually selected before showing it as an
// applicable requirement, per the explicit correction: "do not treat
// 'same regulatory table' as 'same applicable requirement.'"
//
// This classifies using ONLY each row's own already-verified
// condition/productCategory text — it never invents a restriction the
// source doesn't state. A row with no named sub-category restriction at
// all is treated as applying to both (the source didn't scope it, so
// this doesn't either); one whose condition names a specific
// sub-category is applicable only to that one; one whose condition says
// the number itself varies by sub-type (e.g. "depends on sub-type") is
// "conditional" — shown, but never asserted as the founder's actual
// resolved limit.
const CHEESE_FAMILY_CATEGORIES = ["paneer", "cheese"];
const CHEESE_FAMILY_PANEER_PHRASES = ["chhana and paneer", "chhana or paneer", "paneer and chhana"];
const CHEESE_FAMILY_CHEESE_PHRASES = ["ripened cheese", "cheese, enzyme-modified cheese", "cheese and cheese products"];
// Named in the source but not modeled as any live sub-type in this build
// today (there is no "cream cheese" product under the live Cheese
// category) — always excluded from both, never shown as if it applied to
// whichever live product the founder actually selected.
const CHEESE_FAMILY_UNSUPPORTED_PHRASES = ["cream cheese"];

/** @returns {"applies"|"conditional"|"excluded"} */
function classifyCheeseFamilyEntry(scopeText, categoryId) {
  const text = (scopeText || "").toLowerCase();
  if (!text) return "applies";
  if (text.includes("except cream cheese")) return "applies";
  if (CHEESE_FAMILY_UNSUPPORTED_PHRASES.some((p) => text.includes(p))) return "excluded";
  if (text.includes("depend")) return "conditional";
  // "unripened cheese" contains the literal substring "ripened cheese"
  // (unRIPENED CHEESE), which would otherwise false-match the ripened-
  // cheese phrase below and wrongly mark a paneer/chhana-only entry (e.g.
  // productCategory "Unripened cheese — Paneer and Chhana") as also
  // applying to ripened cheese/cheddar. Strip that phrase before testing
  // for "ripened cheese", and treat "unripened cheese" itself as a
  // paneer/chhana signal, matching how this app's data models paneer as
  // the unripened branch of the cheese family.
  const textWithoutUnripened = text.replace(/unripened cheese/g, "");
  const paneerNamed =
    CHEESE_FAMILY_PANEER_PHRASES.some((p) => text.includes(p)) ||
    text.includes("paneer and cheese manufacture") ||
    text.includes("unripened cheese");
  const cheeseNamed =
    CHEESE_FAMILY_CHEESE_PHRASES.some((p) => textWithoutUnripened.includes(p)) ||
    text.includes("paneer and cheese manufacture");
  if (paneerNamed && cheeseNamed) return "applies";
  if (paneerNamed) return categoryId === "paneer" ? "applies" : "excluded";
  if (cheeseNamed) return categoryId === "cheese" ? "applies" : "excluded";
  return "applies";
}
/**
 * Applicability-filtered additives for a category: `{applicable,
 * conditional, excludedCount, exception, gmpNote}`. Outside the shared
 * Paneer/Cheese bucket every other category's `notable` list is already
 * scoped to exactly that one category, so it passes through unfiltered —
 * there is nothing there to reclassify.
 */
export function classifiedAdditivesFor(categoryId) {
  const entry = additivesFor(categoryId);
  if (!entry) return null;
  if (!CHEESE_FAMILY_CATEGORIES.includes(categoryId)) {
    return { applicable: entry.notable || [], conditional: [], excludedCount: 0, exception: entry.exception, gmpNote: entry.gmpNote };
  }
  const applicable = [];
  const conditional = [];
  let excludedCount = 0;
  (entry.notable || []).forEach((n) => {
    const status = classifyCheeseFamilyEntry(n.condition, categoryId);
    if (status === "applies") applicable.push(n);
    else if (status === "conditional") conditional.push(n);
    else excludedCount++;
  });
  return { applicable, conditional, excludedCount, exception: entry.exception, gmpNote: entry.gmpNote };
}
/** Applicability-filtered processing aids for a category — same principle as classifiedAdditivesFor(), keyed on each entry's `productCategory` instead of `condition`. */
export function classifiedProcessingAidsFor(categoryId) {
  const entries = processingAidsFor(categoryId);
  if (!entries) return null;
  if (!CHEESE_FAMILY_CATEGORIES.includes(categoryId)) {
    return { applicable: entries, conditional: [], excludedCount: 0 };
  }
  const applicable = [];
  const conditional = [];
  let excludedCount = 0;
  entries.forEach((p) => {
    const status = classifyCheeseFamilyEntry(p.productCategory, categoryId);
    if (status === "applies") applicable.push(p);
    else if (status === "conditional") conditional.push(p);
    else excludedCount++;
  });
  return { applicable, conditional, excludedCount };
}

// Claim wording that always routes to consultant review (spec §20) rather
// than an automated approve/reject — matched as a case-insensitive
// substring against whatever the user typed in New Submission's free-text
// description or a later message. Not exhaustive; a claim phrased another
// way still deserves the same review, this just catches the common cases
// without asking the user to flag their own claims.
export const CLAIM_KEYWORDS = [
  "high protein", "source of protein", "no added sugar", "sugar free", "sugar-free",
  "natural", "organic", "100%", "gluten free", "gluten-free", "no preservatives",
  "low fat", "fat free", "fat-free", "reduced fat", "immunity booster", "probiotic",
  "low calorie", "diet friendly", "no artificial", "farm fresh", "a2 milk", "a2 protein",
];

export const REPORT_DISCLAIMER =
  "This assessment is based on the figures you entered and regulations in force as of the date shown. " +
  "It is not a legal opinion. Verify all limits against the current gazetted FSSAI regulations before " +
  "production or sale. Inspeckt Food Solutions is not liable for regulatory decisions made on the basis " +
  "of this report.";
