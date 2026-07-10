// QA Run 7 — dictated-negation rating correctness + summary-overwrite guard schema.
// Pure Node (no browser). Regression tests for the follow-up fixes that were
// missed when the original deep-QA patch was partially reconstructed:
//   • contraction negators ("doesn't leak", "didn't find any cracks") must not
//     rate Poor — this is how inspectors dictate a PASSING check
//   • iOS curly apostrophes ("isn’t broken") must negate exactly like straight
//   • real defects still rate Poor; negated-good still downgrades to Fair
import { deriveCondition } from '../src/lib/segment.js'
import { newReport } from '../src/lib/schema.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 120) : ''}`) }
const rate = (t) => deriveCondition(t)

// Contraction negators — statements of ABSENCE must not rate Poor
check('"doesn\'t leak" not Poor', rate("The roof doesn't leak") !== 'Poor', rate("The roof doesn't leak"))
check('"does not leak" not Poor', rate('The faucet does not leak') !== 'Poor', rate('The faucet does not leak'))
check('"didn\'t find any cracks" not Poor', rate("I didn't find any cracks") !== 'Poor', rate("I didn't find any cracks"))
check('"don\'t see any mold" not Poor', rate("I don't see any mold") !== 'Poor', rate("I don't see any mold"))
check('"hasn\'t rusted" not Poor', rate("The railing hasn't rusted") !== 'Poor', rate("The railing hasn't rusted"))
check('"won\'t find damage" not Poor', rate("You won't find damage here") !== 'Poor', rate("You won't find damage here"))
check('apostrophe-less "doesnt leak" not Poor', rate('The roof doesnt leak') !== 'Poor', rate('The roof doesnt leak'))

// Curly apostrophes (iOS dictation)
check('curly "isn’t broken" not Poor', rate('The window isn’t broken') !== 'Poor', rate('The window isn’t broken'))
check('curly "doesn’t leak" not Poor', rate('The roof doesn’t leak') !== 'Poor', rate('The roof doesn’t leak'))
check('curly "isn’t in good condition" → Fair', rate('The deck isn’t in good condition') === 'Fair', rate('The deck isn’t in good condition'))

// No regressions on real defects
check('real leak still Poor', rate('The ceiling has a leak') === 'Poor')
check('"doesn\'t work" still Poor (defect, not absence)', rate("The exhaust fan doesn't work") === 'Poor', rate("The exhaust fan doesn't work"))
check('"no issues" still Good', rate('The roof has no issues') === 'Good')
check('"not in good condition" still Fair', rate('The deck is not in good condition') === 'Fair')
check('plain worn still Poor', rate('The counters are worn') === 'Poor')

// Summary-overwrite guard schema
check('newReport carries summaryEdited=false', newReport().summaryEdited === false)

console.log(`\nRUN7: ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
