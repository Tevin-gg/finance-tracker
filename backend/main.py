from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from datetime import datetime, timedelta
import json
import os

import models
import schemas
from constants import RENT_AMOUNT
from database import engine, get_db
from ai_coach import generate_strict_ai_audit, process_ai_chat_message

models.Base.metadata.create_all(bind=engine)

def maybe_close_month(db: Session = Depends(get_db)):
    """Runs on every request (registered as a global FastAPI dependency on `app`
    below) — this is the 'automatic on month change' trigger: no cron job, no
    always-on server required. If the calendar month has moved on since the last
    check, archive every not-yet-archived transaction from before this month and
    reset every subscription for the new billing cycle.

    Account balances are never touched here — they're running totals already,
    so they carry forward automatically. Debts and gear/personal wishlist items
    aren't monthly at all and are left completely alone. Defined ahead of `app`
    so it exists in time to be referenced in the FastAPI constructor below.
    """
    current_month = datetime.now().strftime("%Y-%m")
    row = db.execute(text("SELECT value FROM schema_meta WHERE key = 'last_closed_month'")).fetchone()

    if row is None:
        # First run on this database — seed the marker to the current month so
        # deploying this feature doesn't retroactively archive existing data.
        # Archiving only starts from the NEXT real month boundary onward.
        db.execute(text("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)"))
        db.execute(text("INSERT INTO schema_meta (key, value) VALUES ('last_closed_month', :m)"), {"m": current_month})
        db.commit()
        return

    if row[0] >= current_month:
        return  # already up to date, nothing to close

    # Sweep every unarchived transaction dated before this month. Using "before this
    # month" (not "in exactly the prior month") also catches the rare case where the
    # app wasn't opened for more than one month boundary, or a transaction was
    # backdated into an already-closed month — everything old gets swept together.
    db.query(models.Transaction).filter(
        models.Transaction.is_archived.is_(False),
        models.Transaction.date < f"{current_month}-01"
    ).update({"is_archived": True}, synchronize_session=False)

    # New billing cycle: nothing has been paid yet.
    db.query(models.Subscription).update(
        {"is_paid_this_month": False, "last_paid_date": None}, synchronize_session=False
    )

    db.execute(text("UPDATE schema_meta SET value = :m WHERE key = 'last_closed_month'"), {"m": current_month})
    db.commit()

app = FastAPI(
    title="Personal Finance Tracker & AI Coach API",
    version="3.5.0",
    description="Local-first cash flow tracking API tailored for parent-dependent finances.",
    # Runs the month-rollover check ahead of every single request, so the very
    # first API call after a real month boundary triggers the close — no cron
    # job, no dependency on the server having been running exactly at midnight.
    dependencies=[Depends(maybe_close_month)],
)

app.add_middleware(
    CORSMiddleware,
    # Only the frontend's own two possible origins — "*" here was dead weight:
    # combined with allow_credentials=True it doesn't actually widen access
    # (browsers reject a literal wildcard alongside credentials), it just
    # obscured that these are the only two origins this API is ever called from.
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Without this, a database constraint violation (e.g. a duplicate subscription
    name or gear title — both columns are unique) propagates as an unhandled 500.
    That response never reaches FastAPI's normal response pipeline, so CORSMiddleware
    never gets a chance to attach its headers — the browser then reports the request
    as a CORS failure instead of a 500, hiding the real cause completely and making
    "the backend is unreachable" look true when it isn't. Registering an explicit
    handler keeps the response inside the pipeline that adds CORS headers, and gives
    the frontend a clean, readable message instead of a raw database error. No
    explicit rollback is needed here — each request gets its own session via
    Depends(get_db), which closes it in a finally block regardless of how the
    request ends, so the failed session is simply discarded, not reused."""
    return JSONResponse(
        status_code=400,
        content={"detail": "That name is already in use — please choose a different one."},
    )

@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    """Same CORS-bypass problem as above, but for any other unexpected error.
    Logs the real exception server-side; the client only ever sees a clean message."""
    print(f"Unhandled error on {request.method} {request.url.path}: {exc!r}")
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server."})

def get_account(db: Session, name: str):
    """Look up one of the three named accounts (Sampath Bank, Cash On Hand,
    Subscription Account). Was inlined as this exact query 17 times across the
    file — a single helper means a future rename or an added lookup condition
    only needs to change in one place."""
    return db.query(models.Account).filter(models.Account.name == name).first()

def migrate_schema(db: Session):
    """Lightweight in-place migration for SQLite: add columns introduced after the
    initial deploy. Base.metadata.create_all only creates missing tables, it never
    alters existing ones, so a column added to models.py needs to be added here too."""
    existing_cols = {row[1] for row in db.execute(text("PRAGMA table_info(transactions)")).fetchall()}
    if "account_id" not in existing_cols:
        db.execute(text("ALTER TABLE transactions ADD COLUMN account_id INTEGER"))
        db.commit()
    if "is_archived" not in existing_cols:
        db.execute(text("ALTER TABLE transactions ADD COLUMN is_archived BOOLEAN DEFAULT 0"))
        db.commit()
    if "to_account_id" not in existing_cols:
        db.execute(text("ALTER TABLE transactions ADD COLUMN to_account_id INTEGER"))
        db.commit()

    # "kind" distinguishes Business Equipment Kit items from the newer Personal Wishlist.
    # DEFAULT 'business' backfills every existing row, so gear entered before this column
    # existed stays exactly where it already was on the dashboard.
    gear_cols = {row[1] for row in db.execute(text("PRAGMA table_info(gear_items)")).fetchall()}
    if "kind" not in gear_cols:
        db.execute(text("ALTER TABLE gear_items ADD COLUMN kind TEXT DEFAULT 'business'"))
        db.commit()

    # business_id on accounts: added for the Businesses feature. The businesses table
    # itself is brand new, so Base.metadata.create_all already creates it — only this
    # column on the pre-existing accounts table needs a manual migration.
    account_cols = {row[1] for row in db.execute(text("PRAGMA table_info(accounts)")).fetchall()}
    if "business_id" not in account_cols:
        db.execute(text("ALTER TABLE accounts ADD COLUMN business_id INTEGER"))
        db.commit()

    # One-time conversion of every money column from "rupees stored as float" to
    # "cents stored as integer" (see models.Money) — existing rows predate that type
    # and are still sitting in the DB as plain rupee floats, so they need converting
    # exactly once. SQLite doesn't enforce column affinity strictly, so this can be
    # done as a plain UPDATE without recreating any tables. Guarded by schema_meta:
    # running the *100 conversion twice would silently 100x every balance in the app.
    db.execute(text("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)"))
    db.commit()
    already_migrated = db.execute(
        text("SELECT value FROM schema_meta WHERE key = 'money_migrated_to_cents'")
    ).fetchone()
    if not already_migrated:
        money_columns = {
            "accounts": ["balance"],
            "transactions": ["amount"],
            "debt_items": ["amount", "paid_amount"],
            "subscriptions": ["cost"],
            "bank_statements": ["deposit", "withdrawal", "balance"],
            "gear_items": ["cost", "saved_amount"],
        }
        for table, cols in money_columns.items():
            for col in cols:
                db.execute(text(f"UPDATE {table} SET {col} = ROUND({col} * 100) WHERE {col} IS NOT NULL"))
        db.execute(text(
            "INSERT INTO schema_meta (key, value) VALUES ('money_migrated_to_cents', '1')"
        ))
        db.commit()

def seed_initial_data(db: Session):
    """Seed initial testing data matching user PDF spreadsheet."""
    if db.query(models.Account).count() == 0:
        accounts = [
            models.Account(name="Sampath Bank", type="bank", balance=0.0, currency="Rs"),
            models.Account(name="Subscription Account", type="bank", balance=0.0, currency="Rs"),
            models.Account(name="Cash On Hand", type="cash", balance=0.0, currency="Rs"),
            models.Account(name="Loan (Mom)", type="debt", balance=18000.0, currency="Rs"),
        ]
        db.add_all(accounts)
        db.commit()

    if db.query(models.DebtItem).count() == 0:
        debts = [
            models.DebtItem(person="Mom", type="i_owe", description="Loan from mom for expenses", amount=18000.0, is_settled=False),
            models.DebtItem(person="Pasindu", type="lent", description="Money lent for project", amount=5000.0, is_settled=False),
        ]
        db.add_all(debts)
        db.commit()

    if db.query(models.Subscription).count() == 0:
        subs = [
            models.Subscription(name="ChatGPT Plus", cost=6000.0, due_date="2026-01-31", category="AI Tools", is_paid_this_month=False),
            models.Subscription(name="Spotify Premium", cost=1500.0, due_date="2026-01-31", category="Entertainment", is_paid_this_month=False),
            models.Subscription(name="TradingView Package (Monthly)", cost=4000.0, due_date="2026-01-31", category="Trading Tools", is_paid_this_month=False),
            models.Subscription(name="Internet Bill", cost=6000.0, due_date="2026-01-31", category="Utilities", is_paid_this_month=False),
            models.Subscription(name="Gym Membership", cost=6000.0, due_date="2026-01-31", category="Health", is_paid_this_month=False),
            models.Subscription(name="API Services", cost=2200.0, due_date="2026-01-31", category="Developer Tools", is_paid_this_month=False),
        ]
        db.add_all(subs)
        db.commit()

    if db.query(models.Transaction).count() == 0:
        transactions = [
            models.Transaction(date="2026-01-31", description="Gavindu Allowance", amount=10000.0, category="Income", transaction_type="income", is_fixed=False),
            models.Transaction(date="2026-01-31", description="Rent", amount=35000.0, category="Housing", transaction_type="expense", is_fixed=True),
            models.Transaction(date="2026-01-31", description="Gym", amount=6000.0, category="Health", transaction_type="expense", is_fixed=True),
            models.Transaction(date="2026-01-31", description="Spotify", amount=1500.0, category="Subscriptions", transaction_type="expense", is_fixed=True),
            models.Transaction(date="2026-01-31", description="ChatGPT", amount=6000.0, category="Subscriptions", transaction_type="expense", is_fixed=True),
            models.Transaction(date="2026-01-31", description="Internet", amount=6000.0, category="Utilities", transaction_type="expense", is_fixed=True),
            models.Transaction(date="2026-01-31", description="API", amount=2200.0, category="Subscriptions", transaction_type="expense", is_fixed=False),
            models.Transaction(date="2026-01-31", description="Liki", amount=2200.0, category="Personal", transaction_type="expense", is_fixed=False),
            models.Transaction(date="2026-01-31", description="Pasindu", amount=5000.0, category="Personal", transaction_type="expense", is_fixed=False),
        ]
        db.add_all(transactions)
        db.commit()

    if db.query(models.BankStatementItem).count() == 0:
        statements = [
            models.BankStatementItem(date="2026-01-31", description="Total money that forwarded", deposit=1000.0, withdrawal=0.0, balance=1000.0),
        ]
        db.add_all(statements)
        db.commit()

    if db.query(models.GearItem).count() == 0:
        gear_items = [
            models.GearItem(title="Gimbal", cost=200000.0, saved_amount=200000.0, is_paid=True, category="Camera Gear"),
            models.GearItem(title="Portable hard disk", cost=20000.0, saved_amount=20000.0, is_paid=True, category="Storage"),
            models.GearItem(title="Memory Card reader", cost=1000.0, saved_amount=1000.0, is_paid=True, category="Accessories"),
            models.GearItem(title="Tripod", cost=15000.0, saved_amount=4000.0, is_paid=False, category="Camera Gear"),
            models.GearItem(title="360 Drone", cost=270000.0, saved_amount=0.0, is_paid=False, category="Camera Gear"),
            models.GearItem(title="360 Cam", cost=160000.0, saved_amount=0.0, is_paid=False, category="Camera Gear"),
            models.GearItem(title="Dry Cabinet", cost=30000.0, saved_amount=0.0, is_paid=False, category="Accessories"),
            models.GearItem(title="Camera UV filter", cost=7500.0, saved_amount=0.0, is_paid=False, category="Accessories"),
            models.GearItem(title="200mm Lens", cost=300000.0, saved_amount=0.0, is_paid=False, category="Camera Gear"),
        ]
        db.add_all(gear_items)
        db.commit()

@app.on_event("startup")
def startup_event():
    db = next(get_db())
    migrate_schema(db)
    seed_initial_data(db)

@app.get("/")
def read_root():
    return {"message": "Personal Finance Tracker API is active."}

@app.get("/api/v1/summary", response_model=schemas.SummaryResponse)
def get_summary(db: Session = Depends(get_db)):
    bank_acc = get_account(db, "Sampath Bank")
    cash_acc = get_account(db, "Cash On Hand")
    sub_acc = get_account(db, "Subscription Account")

    bank_balance = bank_acc.balance if bank_acc else 0.0
    cash_on_hand = cash_acc.balance if cash_acc else 0.0
    sub_account_balance = sub_acc.balance if sub_acc else 0.0

    debts_i_owe = db.query(models.DebtItem).filter(models.DebtItem.type == "i_owe", models.DebtItem.is_settled == False).all()
    debts_lent = db.query(models.DebtItem).filter(models.DebtItem.type == "lent", models.DebtItem.is_settled == False).all()

    mom_debt = sum((d.amount - d.paid_amount) for d in debts_i_owe)
    total_lent = sum((d.amount - d.paid_amount) for d in debts_lent)

    # "Monthly" figures must be scoped to the current calendar month, not every
    # transaction ever logged — otherwise these numbers only ever grow and stop
    # meaning anything after the first month of use. Dates are stored as "YYYY-MM-DD"
    # strings, so a prefix match against "YYYY-MM" is enough to select this month.
    current_month_prefix = datetime.now().strftime("%Y-%m")
    monthly_transactions = db.query(models.Transaction).filter(
        models.Transaction.date.like(f"{current_month_prefix}%"),
        models.Transaction.is_archived.is_(False),
    ).all()
    income = sum(t.amount for t in monthly_transactions if t.transaction_type == "income")
    fixed_exp = sum(t.amount for t in monthly_transactions if t.transaction_type == "expense" and t.is_fixed)
    var_exp = sum(t.amount for t in monthly_transactions if t.transaction_type == "expense" and not t.is_fixed)
    total_expenses = fixed_exp + var_exp

    # total_subscriptions_monthly is the full recurring bill regardless of paid status.
    # Once a subscription is paid, pay_subscription() logs a real expense Transaction for
    # it (category="Subscriptions"), which is already counted inside total_monthly_expenses
    # above. So total_subscriptions_monthly and total_monthly_expenses overlap for whatever
    # portion has been paid this month — adding them together double-counts that portion.
    # Splitting into paid/unpaid makes the overlap explicit instead of a silent trap:
    # total_monthly_expenses already reflects subscriptions_paid_this_month, while
    # subscriptions_unpaid_this_month is the part still to come and safe to add on top.
    subs = db.query(models.Subscription).all()
    total_subs = sum(s.cost for s in subs)
    subs_paid_this_month = sum(s.cost for s in subs if s.is_paid_this_month)
    subs_unpaid_this_month = total_subs - subs_paid_this_month

    # Business Equipment Kit and Personal Wishlist share one table (models.GearItem),
    # distinguished by `kind`. Legacy rows with no kind set default to "business" via the
    # migration, so upcoming_gear_total/paid_gear_total keep meaning exactly what they
    # always meant — the split-out personal totals are purely additive, not a rename.
    gear_items = db.query(models.GearItem).all()
    business_items = [g for g in gear_items if g.kind != "personal"]
    personal_items = [g for g in gear_items if g.kind == "personal"]
    upcoming_gear = sum(g.cost for g in business_items if not g.is_paid)
    paid_gear = sum(g.cost for g in business_items if g.is_paid)
    upcoming_personal_total = sum(g.cost for g in personal_items if not g.is_paid)
    paid_personal_total = sum(g.cost for g in personal_items if g.is_paid)

    # Burn rate must reflect actual recent spending pace, not month-to-date total_expenses
    # (which resets near-zero on the 1st of every month) or an all-time cumulative total
    # (which only ever grows and makes runway shrink forever regardless of real habits).
    # A rolling trailing-30-day window stays meaningful on any given day of the month.
    thirty_days_ago = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    recent_expense_total = sum(
        t.amount for t in db.query(models.Transaction).filter(
            models.Transaction.transaction_type == "expense",
            models.Transaction.date >= thirty_days_ago
        ).all()
    )
    daily_burn = (recent_expense_total / 30.0) if recent_expense_total > 0 else 100.0
    runway_days = int(bank_balance / daily_burn) if daily_burn > 0 else 0

    # Whether rent is actually covered depends on ALL liquid funds, not just bank_balance —
    # cash on hand and the subscription account can cover rent too. It also needs to net out
    # subscriptions still unpaid this cycle, since that money is already spoken for and will
    # leave the same accounts before rent does. Computed once here so the frontend badge and
    # the AI coach (previously three separate "bank_balance < 35000" checks) agree.
    total_liquid_funds = bank_balance + cash_on_hand + sub_account_balance
    available_for_rent = total_liquid_funds - subs_unpaid_this_month
    rent_deficit = available_for_rent < RENT_AMOUNT

    return {
        "bank_balance": bank_balance,
        "cash_on_hand": cash_on_hand,
        "sub_account_balance": sub_account_balance,
        "mom_debt": mom_debt,
        "total_money_lent": total_lent,
        "total_monthly_income": income,
        "total_monthly_expenses": total_expenses,
        "total_fixed_expenses": fixed_exp,
        "total_variable_expenses": var_exp,
        "total_subscriptions_monthly": total_subs,
        "subscriptions_paid_this_month": subs_paid_this_month,
        "subscriptions_unpaid_this_month": subs_unpaid_this_month,
        "upcoming_gear_total": upcoming_gear,
        "paid_gear_total": paid_gear,
        "upcoming_personal_total": upcoming_personal_total,
        "paid_personal_total": paid_personal_total,
        "runway_days": runway_days,
        "available_for_rent": available_for_rent,
        "rent_deficit": rent_deficit
    }

# Transactions API
@app.get("/api/v1/transactions", response_model=List[schemas.TransactionResponse])
def get_transactions(db: Session = Depends(get_db)):
    return db.query(models.Transaction).order_by(models.Transaction.id.desc()).all()

@app.post("/api/v1/transactions", response_model=schemas.TransactionResponse)
def create_transaction(tx: schemas.TransactionCreate, db: Session = Depends(get_db)):
    db_tx = models.Transaction(**tx.dict())

    bank_acc = get_account(db, "Sampath Bank")
    cash_acc = get_account(db, "Cash On Hand")
    explicit_acc = (
        db.query(models.Account).filter(models.Account.id == tx.account_id).first()
        if tx.account_id is not None else None
    )

    if tx.transaction_type == "income":
        # Prefer the caller's explicit choice; otherwise default to cash, then bank.
        target = explicit_acc or cash_acc or bank_acc
        if target:
            target.balance += tx.amount
            db_tx.account_id = target.id
    elif tx.transaction_type == "expense":
        # Prefer the caller's explicit choice; otherwise pay from cash if it covers the
        # amount, else fall back to bank. Whichever account is actually charged here is
        # the SAME one recorded on db_tx.account_id, so a later delete reverses it exactly.
        if explicit_acc:
            target = explicit_acc
        elif cash_acc and cash_acc.balance >= tx.amount:
            target = cash_acc
        else:
            target = bank_acc
        if target:
            target.balance -= tx.amount
            db_tx.account_id = target.id
    elif tx.transaction_type == "transfer":
        # Generalized: any account -> any account (used to be hardcoded Cash On Hand ->
        # Sampath Bank only, which meant no withdrawal direction existed at all, and no
        # way to move money into or out of a business account). Both ends are now
        # required explicitly — there's no sensible default to guess for "which two
        # accounts" the way there is for income/expense.
        from_acc = explicit_acc
        to_acc = (
            db.query(models.Account).filter(models.Account.id == tx.to_account_id).first()
            if tx.to_account_id is not None else None
        )
        if not from_acc or not to_acc:
            raise HTTPException(status_code=400, detail="A transfer needs both a source (account_id) and a destination (to_account_id) account.")
        if from_acc.id == to_acc.id:
            raise HTTPException(status_code=400, detail="Transfer source and destination must be different accounts.")
        from_acc.balance -= tx.amount
        to_acc.balance += tx.amount
        db_tx.account_id = from_acc.id
        db_tx.to_account_id = to_acc.id

    db.add(db_tx)
    db.commit()
    db.refresh(db_tx)
    return db_tx

@app.delete("/api/v1/transactions/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    bank_acc = get_account(db, "Sampath Bank")
    cash_acc = get_account(db, "Cash On Hand")

    if tx.transaction_type == "transfer":
        # Reverse the exact pair this transfer moved between. Falls back to the old
        # hardcoded Cash -> Bank pair only for legacy rows from before transfers
        # recorded their own accounts (account_id/to_account_id both null then).
        if tx.account_id is not None and tx.to_account_id is not None:
            from_acc = db.query(models.Account).filter(models.Account.id == tx.account_id).first()
            to_acc = db.query(models.Account).filter(models.Account.id == tx.to_account_id).first()
            if from_acc:
                from_acc.balance += tx.amount
            if to_acc:
                to_acc.balance -= tx.amount
        else:
            if cash_acc:
                cash_acc.balance += tx.amount
            if bank_acc:
                bank_acc.balance -= tx.amount
    else:
        # Reverse the exact account this transaction hit at creation time, not whichever
        # account happens to look right now. Falls back to the old cash-first guess only
        # for legacy rows that predate the account_id column.
        target = (
            db.query(models.Account).filter(models.Account.id == tx.account_id).first()
            if tx.account_id is not None else (cash_acc or bank_acc)
        )
        if target:
            if tx.transaction_type == "income":
                target.balance -= tx.amount
            elif tx.transaction_type == "expense":
                target.balance += tx.amount

    db.delete(tx)
    db.commit()
    return {"message": "Transaction deleted successfully"}

# History API — archived (closed) months. See maybe_close_month() for how and
# when a month actually gets archived.
@app.get("/api/v1/history/months", response_model=List[schemas.ArchivedMonthSummary])
def get_archived_months(db: Session = Depends(get_db)):
    """One row per closed month, most recent first, with quick totals."""
    archived = db.query(models.Transaction).filter(models.Transaction.is_archived.is_(True)).all()
    months: Dict[str, Dict[str, Any]] = {}
    for t in archived:
        m = t.date[:7]
        bucket = months.setdefault(m, {"month": m, "income": 0.0, "expense": 0.0, "transaction_count": 0})
        if t.transaction_type == "income":
            bucket["income"] += t.amount
        elif t.transaction_type == "expense":
            bucket["expense"] += t.amount
        bucket["transaction_count"] += 1
    for bucket in months.values():
        bucket["net"] = bucket["income"] - bucket["expense"]
    return sorted(months.values(), key=lambda m: m["month"], reverse=True)

@app.get("/api/v1/history/{month}", response_model=List[schemas.TransactionResponse])
def get_archived_month_transactions(month: str, db: Session = Depends(get_db)):
    """Every archived transaction for one closed 'YYYY-MM' month, most recent first."""
    return db.query(models.Transaction).filter(
        models.Transaction.is_archived.is_(True),
        models.Transaction.date.like(f"{month}%")
    ).order_by(models.Transaction.date.desc()).all()

def _move_money_for_debt_payment(db: Session, debt: models.DebtItem, payment: float, account_id: int = None):
    """Move real money for a debt payment and log a transaction for it.
    Direction depends on which side of the debt this is: paying down what I owe
    ('i_owe', e.g. Mom's loan) is money leaving my accounts; collecting a
    receivable ('lent', e.g. Pasindu paying me back) is money coming in. This
    mirrors the 'repayment' vs 'collection' language the frontend already uses.

    account_id is the caller's explicit choice, when given — the frontend's account
    picker. Without one, this falls back to the old heuristic (cash if it covers the
    amount else bank for a repayment; cash first for a collection), which is exactly
    what used to silently redirect payments to bank whenever tracked cash looked too
    low, with no way to override it."""
    if payment <= 0:
        return

    bank_acc = get_account(db, "Sampath Bank")
    cash_acc = get_account(db, "Cash On Hand")
    explicit_acc = db.query(models.Account).filter(models.Account.id == account_id).first() if account_id is not None else None

    if debt.type == "i_owe":
        target = explicit_acc or (cash_acc if (cash_acc and cash_acc.balance >= payment) else bank_acc)
        tx_type, sign, desc = "expense", -1, f"Debt repayment to {debt.person}"
    else:
        target = explicit_acc or cash_acc or bank_acc
        tx_type, sign, desc = "income", 1, f"Debt collected from {debt.person}"

    if target:
        target.balance += sign * payment
        db.add(models.Transaction(
            date=datetime.now().strftime("%Y-%m-%d"),
            description=desc,
            amount=payment,
            category="Debt",
            transaction_type=tx_type,
            is_fixed=False,
            account_id=target.id,
        ))

# Debts API
@app.get("/api/v1/debts", response_model=List[schemas.DebtItemResponse])
def get_debts(db: Session = Depends(get_db)):
    debts = db.query(models.DebtItem).order_by(models.DebtItem.is_settled.asc(), models.DebtItem.id.desc()).all()
    results = []
    for d in debts:
        resp = schemas.DebtItemResponse.from_orm(d)
        resp.remaining_amount = max(0.0, d.amount - d.paid_amount)
        results.append(resp)
    return results

@app.post("/api/v1/debts", response_model=schemas.DebtItemResponse)
def create_debt(debt: schemas.DebtItemCreate, db: Session = Depends(get_db)):
    db_debt = models.DebtItem(**debt.dict())
    if db_debt.paid_amount >= db_debt.amount and db_debt.amount > 0:
        db_debt.is_settled = True
    db.add(db_debt)
    db.commit()
    db.refresh(db_debt)
    resp = schemas.DebtItemResponse.from_orm(db_debt)
    resp.remaining_amount = max(0.0, db_debt.amount - db_debt.paid_amount)
    return resp

@app.patch("/api/v1/debts/{debt_id}/settle", response_model=schemas.DebtItemResponse)
def settle_debt(debt_id: int, payload: schemas.DebtSettleUpdate = schemas.DebtSettleUpdate(), db: Session = Depends(get_db)):
    debt = db.query(models.DebtItem).filter(models.DebtItem.id == debt_id).first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt item not found")

    remaining = max(0.0, debt.amount - debt.paid_amount)
    debt.paid_amount = debt.amount
    debt.is_settled = True
    _move_money_for_debt_payment(db, debt, remaining, account_id=payload.account_id)

    db.commit()
    db.refresh(debt)
    resp = schemas.DebtItemResponse.from_orm(debt)
    resp.remaining_amount = 0.0
    return resp

@app.patch("/api/v1/debts/{debt_id}/pay", response_model=schemas.DebtItemResponse)
def pay_debt(debt_id: int, payload: schemas.DebtPaymentUpdate, db: Session = Depends(get_db)):
    debt = db.query(models.DebtItem).filter(models.DebtItem.id == debt_id).first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt item not found")

    payment = payload.payment_amount
    if payment > 0:
        payment = min(payment, debt.amount - debt.paid_amount)
        debt.paid_amount = debt.paid_amount + payment
        if debt.paid_amount >= debt.amount:
            debt.is_settled = True
        _move_money_for_debt_payment(db, debt, payment, account_id=payload.account_id)
        db.commit()
        db.refresh(debt)

    resp = schemas.DebtItemResponse.from_orm(debt)
    resp.remaining_amount = max(0.0, debt.amount - debt.paid_amount)
    return resp

@app.delete("/api/v1/debts/{debt_id}")
def delete_debt(debt_id: int, db: Session = Depends(get_db)):
    debt = db.query(models.DebtItem).filter(models.DebtItem.id == debt_id).first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt item not found")
    db.delete(debt)
    db.commit()
    return {"message": "Debt item deleted successfully"}

# Subscriptions API
@app.get("/api/v1/subscriptions", response_model=List[schemas.SubscriptionResponse])
def get_subscriptions(db: Session = Depends(get_db)):
    return db.query(models.Subscription).order_by(models.Subscription.is_paid_this_month.asc(), models.Subscription.cost.desc()).all()

@app.post("/api/v1/subscriptions", response_model=schemas.SubscriptionResponse)
def create_subscription(sub: schemas.SubscriptionCreate, db: Session = Depends(get_db)):
    db_sub = models.Subscription(**sub.dict())
    db.add(db_sub)
    db.commit()
    db.refresh(db_sub)
    return db_sub

@app.patch("/api/v1/subscriptions/{sub_id}/pay", response_model=schemas.SubscriptionResponse)
def pay_subscription(sub_id: int, payload: schemas.SubscriptionPaymentUpdate = schemas.SubscriptionPaymentUpdate(), db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    sub.is_paid_this_month = True
    sub.last_paid_date = datetime.now().strftime("%Y-%m-%d")

    bank_acc = get_account(db, "Sampath Bank")
    # Previously this unconditionally hit bank with no way to say otherwise — there
    # was no way to record a subscription paid in cash at all. Default stays bank
    # (unchanged behavior for anyone who doesn't pick), but an explicit account_id
    # now overrides it.
    explicit_acc = (
        db.query(models.Account).filter(models.Account.id == payload.account_id).first()
        if payload.account_id is not None else None
    )
    target = explicit_acc or bank_acc

    tx = models.Transaction(
        date=sub.last_paid_date,
        description=f"Subscription: {sub.name}",
        amount=sub.cost,
        category="Subscriptions",
        transaction_type="expense",
        is_fixed=True,
        # Record which account this actually hit so a later delete reverses the
        # same account instead of falling back to the cash-first legacy guess.
        account_id=target.id if target else None,
    )
    db.add(tx)

    if target:
        target.balance -= sub.cost

    db.commit()
    db.refresh(sub)
    return sub

@app.delete("/api/v1/subscriptions/{sub_id}")
def delete_subscription(sub_id: int, db: Session = Depends(get_db)):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(sub)
    db.commit()
    return {"message": "Subscription deleted successfully"}

# Accounts API — lets the frontend offer an explicit "which account" picker
# instead of relying on the create_transaction/gear-savings heuristics (cash if it
# covers the amount, else bank) to guess. The schema already existed; no endpoint
# had ever used it.
@app.get("/api/v1/accounts", response_model=List[schemas.AccountResponse])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()

# Businesses API — each business gets exactly one Account (type="business"), created
# alongside it and kept name-synced on rename. Which business a transaction belongs
# to is derived entirely from account_id/to_account_id, never stored redundantly.
@app.get("/api/v1/businesses", response_model=List[schemas.BusinessResponse])
def get_businesses(db: Session = Depends(get_db)):
    businesses = db.query(models.Business).order_by(models.Business.name.asc()).all()
    results = []
    for b in businesses:
        acc = db.query(models.Account).filter(models.Account.business_id == b.id).first()
        results.append(schemas.BusinessResponse(
            id=b.id, name=b.name, created_at=b.created_at,
            account_id=acc.id if acc else 0,
            balance=acc.balance if acc else 0.0,
        ))
    return results

@app.post("/api/v1/businesses", response_model=schemas.BusinessResponse)
def create_business(payload: schemas.BusinessCreate, db: Session = Depends(get_db)):
    business = models.Business(name=payload.name)
    db.add(business)
    db.flush()  # assigns business.id without ending the transaction

    account = models.Account(name=payload.name, type="business", balance=0.0, currency="Rs", business_id=business.id)
    db.add(account)
    db.commit()
    db.refresh(business)
    db.refresh(account)
    return schemas.BusinessResponse(id=business.id, name=business.name, created_at=business.created_at, account_id=account.id, balance=account.balance)

@app.patch("/api/v1/businesses/{business_id}", response_model=schemas.BusinessResponse)
def rename_business(business_id: int, payload: schemas.BusinessRename, db: Session = Depends(get_db)):
    business = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    account = db.query(models.Account).filter(models.Account.business_id == business.id).first()

    business.name = payload.name
    if account:
        account.name = payload.name  # keep the account's own name in sync
    db.commit()
    db.refresh(business)
    return schemas.BusinessResponse(
        id=business.id, name=business.name, created_at=business.created_at,
        account_id=account.id if account else 0,
        balance=account.balance if account else 0.0,
    )

# Bank Statements & Account Balance API
@app.get("/api/v1/bank-statements", response_model=List[schemas.BankStatementResponse])
def get_bank_statements(db: Session = Depends(get_db)):
    return db.query(models.BankStatementItem).order_by(models.BankStatementItem.id.desc()).all()

@app.post("/api/v1/bank-statements", response_model=schemas.BankStatementResponse)
def create_bank_statement(item: schemas.BankStatementCreate, db: Session = Depends(get_db)):
    db_item = models.BankStatementItem(**item.dict())
    db.add(db_item)

    bank_acc = get_account(db, "Sampath Bank")
    if bank_acc:
        if item.deposit > 0:
            bank_acc.balance += item.deposit
        elif item.withdrawal > 0:
            bank_acc.balance -= item.withdrawal

    db.commit()
    db.refresh(db_item)
    return db_item

@app.delete("/api/v1/bank-statements/{item_id}")
def delete_bank_statement(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.BankStatementItem).filter(models.BankStatementItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Bank statement item not found")

    bank_acc = get_account(db, "Sampath Bank")
    if bank_acc:
        if item.deposit > 0:
            bank_acc.balance -= item.deposit
        elif item.withdrawal > 0:
            bank_acc.balance += item.withdrawal

    db.delete(item)
    db.commit()
    return {"message": "Bank statement item deleted successfully"}

@app.patch("/api/v1/accounts/bank-balance")
def update_bank_balance(payload: schemas.BalanceUpdate, db: Session = Depends(get_db)):
    bank_acc = get_account(db, "Sampath Bank")
    if not bank_acc:
        bank_acc = models.Account(name="Sampath Bank", type="bank", balance=payload.balance, currency="Rs")
        db.add(bank_acc)
    else:
        bank_acc.balance = payload.balance
    db.commit()
    return {"message": "Bank balance updated successfully", "bank_balance": bank_acc.balance}

@app.patch("/api/v1/accounts/cash-balance")
def update_cash_balance(payload: schemas.BalanceUpdate, db: Session = Depends(get_db)):
    cash_acc = get_account(db, "Cash On Hand")
    if not cash_acc:
        cash_acc = models.Account(name="Cash On Hand", type="cash", balance=payload.balance, currency="Rs")
        db.add(cash_acc)
    else:
        cash_acc.balance = payload.balance
    db.commit()
    return {"message": "Cash on hand updated successfully", "cash_on_hand": cash_acc.balance}

@app.patch("/api/v1/accounts/sub-account-balance")
def update_sub_account_balance(payload: schemas.BalanceUpdate, db: Session = Depends(get_db)):
    sub_acc = get_account(db, "Subscription Account")
    if not sub_acc:
        sub_acc = models.Account(name="Subscription Account", type="bank", balance=payload.balance, currency="Rs")
        db.add(sub_acc)
    else:
        sub_acc.balance = payload.balance
    db.commit()
    return {"message": "Subscription account balance updated successfully", "sub_account_balance": sub_acc.balance}

# Gear API
@app.get("/api/v1/gear", response_model=List[schemas.GearItemResponse])
def get_gear_items(db: Session = Depends(get_db)):
    return db.query(models.GearItem).order_by(models.GearItem.is_paid.asc(), models.GearItem.cost.desc()).all()

@app.post("/api/v1/gear", response_model=schemas.GearItemResponse)
def create_gear_item(item: schemas.GearItemCreate, db: Session = Depends(get_db)):
    db_gear = models.GearItem(**item.dict())
    db.add(db_gear)
    db.commit()
    db.refresh(db_gear)
    return db_gear

@app.patch("/api/v1/gear/{gear_id}", response_model=schemas.GearItemResponse)
def update_gear_savings(gear_id: int, update_data: schemas.GearSavingsUpdate, db: Session = Depends(get_db)):
    gear = db.query(models.GearItem).filter(models.GearItem.id == gear_id).first()
    if not gear:
        raise HTTPException(status_code=404, detail="Gear item not found")

    # The client sends the new absolute saved_amount, not an increment, so the actual
    # money movement is the delta against what was saved before. A positive delta is
    # cash leaving liquid funds into savings; a negative delta (a correction, or pulling
    # saved money back out) returns it. Mirrors how debt payments now move money instead
    # of just updating a number that never touched the actual accounts.
    delta = update_data.saved_amount - gear.saved_amount
    if delta != 0:
        bank_acc = get_account(db, "Sampath Bank")
        cash_acc = get_account(db, "Cash On Hand")
        explicit_acc = (
            db.query(models.Account).filter(models.Account.id == update_data.account_id).first()
            if update_data.account_id is not None else None
        )

        if delta > 0:
            target = explicit_acc or (cash_acc if (cash_acc and cash_acc.balance >= delta) else bank_acc)
            tx_type, desc = "expense", f"Savings contribution: {gear.title}"
        else:
            target = explicit_acc or cash_acc or bank_acc
            tx_type, desc = "income", f"Savings withdrawal: {gear.title}"

        if target:
            target.balance -= delta
            db.add(models.Transaction(
                date=datetime.now().strftime("%Y-%m-%d"),
                description=desc,
                amount=abs(delta),
                category=gear.category or "Equipment",
                transaction_type=tx_type,
                is_fixed=False,
                account_id=target.id,
            ))

    gear.saved_amount = update_data.saved_amount
    if gear.saved_amount >= gear.cost:
        gear.is_paid = True
    if update_data.is_paid is not None:
        gear.is_paid = update_data.is_paid

    db.commit()
    db.refresh(gear)
    return gear

@app.delete("/api/v1/gear/{gear_id}")
def delete_gear_item(gear_id: int, db: Session = Depends(get_db)):
    gear = db.query(models.GearItem).filter(models.GearItem.id == gear_id).first()
    if not gear:
        raise HTTPException(status_code=404, detail="Gear item not found")
    db.delete(gear)
    db.commit()
    return {"message": "Gear item deleted successfully"}

# AI Audit & Interactive Chat API
@app.post("/api/v1/ai/audit", response_model=schemas.AIAuditResponse)
def run_ai_audit(request: schemas.AIAuditRequest = schemas.AIAuditRequest(), db: Session = Depends(get_db)):
    summary = get_summary(db)
    txs = [schemas.TransactionResponse.from_orm(t).dict() for t in db.query(models.Transaction).all()]
    gears = [schemas.GearItemResponse.from_orm(g).dict() for g in db.query(models.GearItem).all()]

    result = generate_strict_ai_audit(summary, txs, gears, user_note=request.user_note)
    
    log_entry = models.AIAdviceLog(
        score=result["score"],
        audit_summary=result["audit_summary"],
        strict_feedback=result["strict_feedback"]
    )
    db.add(log_entry)
    db.commit()

    return result

@app.post("/api/v1/ai/chat")
def chat_with_ai(payload: Dict[str, Any], db: Session = Depends(get_db)):
    user_msg = payload.get("message", "")
    summary = get_summary(db)
    txs = [schemas.TransactionResponse.from_orm(t).dict() for t in db.query(models.Transaction).all()]
    gears = [schemas.GearItemResponse.from_orm(g).dict() for g in db.query(models.GearItem).all()]

    reply = process_ai_chat_message(user_msg, summary, txs, gears)
    return {
        "reply": reply,
        "created_at": datetime.now().strftime("%I:%M %p")
    }

@app.post("/api/v1/ai/export-json")
def export_json_payload(db: Session = Depends(get_db)):
    summary = get_summary(db)
    txs = [schemas.TransactionResponse.from_orm(t).dict() for t in db.query(models.Transaction).all()]
    debts = [schemas.DebtItemResponse.from_orm(d).dict() for d in db.query(models.DebtItem).all()]
    subs = [schemas.SubscriptionResponse.from_orm(s).dict() for s in db.query(models.Subscription).all()]
    gears = [schemas.GearItemResponse.from_orm(g).dict() for g in db.query(models.GearItem).all()]

    export_data = {
        "generated_at": datetime.now().isoformat(),
        "summary": summary,
        "transactions": txs,
        "debts": debts,
        "subscriptions": subs,
        "equipment_kit": gears,
    }

    # Write to local file for Antigravity CLI / agent ingestion. Derived from this
    # file's own location (not hardcoded) so it stays correct if the project folder
    # is ever moved again — a hardcoded absolute path here is exactly what broke
    # when the project moved from Desktop to Documents/Projects.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    filepath = os.path.join(project_root, "finance_audit_export.json")
    with open(filepath, "w") as f:
        json.dump(export_data, f, indent=2, default=str)

    return {
        "message": "JSON exported successfully for Antigravity CLI",
        "filepath": filepath,
        "payload": export_data
    }
