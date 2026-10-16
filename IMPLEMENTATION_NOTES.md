# Word Adventure — Fox visual refresh

## Included
- `index.html`: presentation-only visual refresh; original game data and JavaScript are retained.
- `assets/fox/fox-neutral.png`: neutral fox crop exported from the supplied concept sheet with an alpha mask.

## Apply
1. Create a branch in the original repository: `git switch -c feature/fox-visual-redesign`
2. Back up the original `index.html`.
3. Copy this package's `index.html` and `assets/` into the repository root.
4. Open `index.html` through the same environment used by the original game and run the regression checklist before merging.

## Scope / limitations
This package was prepared from the uploaded `index.html` archive, which contained no Git metadata and no repository asset directory. Consequently no branch could be created here and no real browser session was available. The supplied illustration sheet is a concept sheet, not a complete set of independently delivered, transparent sprites. Only the neutral fox crop is used as a runtime asset; expression variants and backgrounds should be exported/approved as separate assets in a later batch.

## Test status
Static checks only. Browser gameplay, scoring, API integration, console, keyboard/touch and viewport regression tests remain unrun and must not be treated as passed.
