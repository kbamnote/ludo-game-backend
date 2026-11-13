# @ludo/engine
#
# The canonical, authoritative Ludo rule set. Shared with the mobile client.
#
# Constraints (see ../../PROJECT_STATUS.md section 4):
#   - Plain JavaScript (ESM) + JSDoc. No TypeScript syntax, no build step.
#   - Zero dependencies. No Node built-ins, no React Native, no I/O.
#   - Pure and deterministic: (state, action) -> newState.
#   - RNG is injected, never ambient, so matches are reproducible.
#
# Scope: board geometry (15x15 grid, 52-cell track, four 5-cell home
# columns, 8 safe cells), legal moves, capture, extra turns, three-sixes
# forfeiture, exact-count home entry, win conditions, turn sequencing.
#
# Implemented in Phase 4.
