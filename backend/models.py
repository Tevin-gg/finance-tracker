from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.types import TypeDecorator
from datetime import datetime
from database import Base

class Money(TypeDecorator):
    """Currency amounts stored as integer cents underneath, exposed as a plain Python
    float (rupees) everywhere the ORM attribute is read or written. main.py's existing
    `+=`/`-=` arithmetic doesn't need to change at all — the difference is that every
    write now rounds to the nearest cent before hitting the database, which quantizes
    away accumulated in-memory float drift on every commit instead of letting it
    silently compound across years of transactions."""
    impl = Integer
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return round(value * 100)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value / 100.0

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    type = Column(String)  # 'bank', 'debt', 'cash'
    balance = Column(Money, default=0.0)
    currency = Column(String, default="Rs")

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, index=True)
    description = Column(String)
    amount = Column(Money)
    category = Column(String)
    transaction_type = Column(String)  # 'income', 'expense', 'transfer'
    is_fixed = Column(Boolean, default=False)
    # Which single account this income/expense actually hit. Recorded at creation time
    # so a later delete reverses the SAME account instead of re-guessing (which used to
    # cause cash/bank balance drift when the guess at delete time didn't match create time).
    # Null on rows created before this column existed, or on transfers (which always
    # touch both cash and bank deterministically and don't need it).
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    # Set True by the monthly close-out (see main.maybe_close_month): the transaction
    # belongs to a prior, already-closed month. Archived rows are never deleted and
    # never touched again — they stay out of the "current" Cash Flow Ledger and
    # current-month totals, but remain queryable for History and for anything that
    # needs real trailing history (e.g. the 30-day burn rate, which must see across
    # a month boundary). Account balances are never touched by archiving — they're
    # running totals already, so they carry forward automatically.
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class DebtItem(Base):
    __tablename__ = "debt_items"

    id = Column(Integer, primary_key=True, index=True)
    person = Column(String)  # e.g. "Mom", "John"
    type = Column(String)    # "i_owe" (I owe someone) vs "lent" (someone owes me)
    description = Column(String)
    amount = Column(Money)
    paid_amount = Column(Money, default=0.0)
    is_settled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    cost = Column(Money)
    due_date = Column(String)  # e.g. "2026-01-31" or day "31"
    category = Column(String, default="Software & Services")
    is_paid_this_month = Column(Boolean, default=False)
    last_paid_date = Column(String, nullable=True)

class BankStatementItem(Base):
    __tablename__ = "bank_statements"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String, index=True)
    description = Column(String)
    deposit = Column(Money, default=0.0)
    withdrawal = Column(Money, default=0.0)
    balance = Column(Money, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

class GearItem(Base):
    __tablename__ = "gear_items"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, unique=True)
    cost = Column(Money)
    saved_amount = Column(Money, default=0.0)
    is_paid = Column(Boolean, default=False)
    target_date = Column(String, nullable=True)
    category = Column(String, default="Equipment")
    # "business" (camera/video gear, the original Business Equipment Kit) vs "personal"
    # (everything else you just want to buy). Same savings-tracking mechanics for both —
    # only the dashboard section and summary totals they're grouped into differ.
    kind = Column(String, default="business")

class AIAdviceLog(Base):
    __tablename__ = "ai_advice_logs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    score = Column(Integer, default=50)
    audit_summary = Column(String)
    strict_feedback = Column(Text)
