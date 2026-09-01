# Shared constants used by both main.py and ai_coach.py. Split into its own module
# (rather than defining RENT_AMOUNT in main.py and importing it from there) so
# ai_coach.py doesn't have to import main.py — main.py already imports ai_coach.py,
# and a two-way import between them would be a circular import.

# Single source of truth for the rent threshold. Was previously the literal 35000
# duplicated across main.py, ai_coach.py, and the frontend's page.tsx, each doing
# its own "bank_balance < 35000" check independently.
RENT_AMOUNT = 35000.0
