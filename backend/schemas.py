from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

# Matches "YYYY-MM-DD". Several summary calculations (monthly totals, 30-day burn rate)
# do string prefix/range comparisons directly against this field, so a malformed date
# would silently corrupt those numbers rather than raising an error.
ISO_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"

class AccountBase(BaseModel):
    name: str
    type: str
    balance: float
    currency: str = "Rs"
    business_id: Optional[int] = None

class AccountResponse(AccountBase):
    id: int
    class Config:
        from_attributes = True

class TransactionBase(BaseModel):
    # Kept permissive here (plain str/float) because TransactionResponse inherits this
    # class and must still serialize rows written before this validation existed.
    # The actual enforcement lives on TransactionCreate below.
    date: str
    description: str
    amount: float
    category: str
    transaction_type: str  # 'income', 'expense', 'transfer'
    is_fixed: bool = False
    # Optional: caller may pick the account explicitly. If omitted, the backend
    # resolves and records one automatically (income/expense only — see
    # create_transaction; a transfer always requires both explicitly).
    account_id: Optional[int] = None
    # Transfer destination — required for transaction_type="transfer", meaningless
    # otherwise. This is what generalized Transfer from a hardcoded Cash->Bank-only
    # move into a real "any account -> any account" one (Owner's Draw, Capital
    # Injection, and finally being able to withdraw cash from the bank, not just
    # deposit into it).
    to_account_id: Optional[int] = None
    is_archived: bool = False

class TransactionCreate(TransactionBase):
    date: str = Field(pattern=ISO_DATE_PATTERN)
    amount: float = Field(gt=0)
    transaction_type: Literal["income", "expense", "transfer"]

class TransactionResponse(TransactionBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class DebtItemBase(BaseModel):
    # Kept permissive (plain str/float) since DebtItemResponse inherits this and must
    # still serialize existing rows. Enforcement lives on DebtItemCreate below.
    person: str
    type: str  # "i_owe" vs "lent"
    description: str
    amount: float
    paid_amount: float = 0.0
    is_settled: bool = False

class DebtItemCreate(DebtItemBase):
    type: Literal["i_owe", "lent"]
    amount: float = Field(gt=0)
    paid_amount: float = Field(default=0.0, ge=0)

class DebtItemResponse(DebtItemBase):
    id: int
    remaining_amount: Optional[float] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class DebtPaymentUpdate(BaseModel):
    payment_amount: float = Field(gt=0)
    # Optional explicit choice of which account this payment/collection hits. If
    # omitted, falls back to the old heuristic (cash if it covers the amount, else
    # bank for a repayment; cash first for a collection) — same account_id pattern
    # already used by TransactionCreate.
    account_id: Optional[int] = None

class DebtSettleUpdate(BaseModel):
    account_id: Optional[int] = None

class SubscriptionBase(BaseModel):
    name: str
    cost: float
    due_date: str
    category: str = "Software & Services"
    is_paid_this_month: bool = False
    last_paid_date: Optional[str] = None

class SubscriptionCreate(SubscriptionBase):
    cost: float = Field(gt=0)

class SubscriptionResponse(SubscriptionBase):
    id: int
    class Config:
        from_attributes = True

class BankStatementBase(BaseModel):
    date: str
    description: str
    deposit: float = 0.0
    withdrawal: float = 0.0
    balance: float = 0.0

class BankStatementCreate(BankStatementBase):
    date: str = Field(pattern=ISO_DATE_PATTERN)
    deposit: float = Field(default=0.0, ge=0)
    withdrawal: float = Field(default=0.0, ge=0)

class BankStatementResponse(BankStatementBase):
    id: int
    class Config:
        from_attributes = True

class GearItemBase(BaseModel):
    title: str
    cost: float
    saved_amount: float = 0.0
    is_paid: bool = False
    target_date: Optional[str] = None
    category: str = "Equipment"
    kind: str = "business"  # "business" (equipment kit) vs "personal" (wishlist)

class GearItemCreate(GearItemBase):
    cost: float = Field(gt=0)
    saved_amount: float = Field(default=0.0, ge=0)
    kind: Literal["business", "personal"] = "business"

class GearItemResponse(GearItemBase):
    id: int
    class Config:
        from_attributes = True

class GearSavingsUpdate(BaseModel):
    saved_amount: float = Field(ge=0)
    is_paid: Optional[bool] = None
    account_id: Optional[int] = None

class SubscriptionPaymentUpdate(BaseModel):
    account_id: Optional[int] = None

class SummaryResponse(BaseModel):
    bank_balance: float
    cash_on_hand: float = 0.0
    sub_account_balance: float = 0.0
    mom_debt: float
    total_money_lent: float
    total_monthly_income: float
    total_monthly_expenses: float
    total_fixed_expenses: float
    total_variable_expenses: float
    total_subscriptions_monthly: float
    subscriptions_paid_this_month: float
    subscriptions_unpaid_this_month: float
    upcoming_gear_total: float
    paid_gear_total: float
    upcoming_personal_total: float
    paid_personal_total: float
    runway_days: int
    available_for_rent: float
    rent_deficit: bool

class AIAuditRequest(BaseModel):
    user_note: Optional[str] = None

class AIAuditResponse(BaseModel):
    score: int
    audit_summary: str
    strict_feedback: str
    action_items: List[str]
    created_at: str

class BalanceUpdate(BaseModel):
    # Required (no default): the three balance-edit endpoints used to accept a raw
    # Dict[str, float] and silently defaulted a missing "balance" key to 0.0 — a
    # malformed request would zero out a real account balance without any error.
    # A required field here means that same request now gets a clean 422 instead.
    balance: float

class ArchivedMonthSummary(BaseModel):
    month: str  # "YYYY-MM"
    income: float
    expense: float
    net: float
    transaction_count: int

class BusinessCreate(BaseModel):
    name: str = Field(min_length=1)

class BusinessRename(BaseModel):
    name: str = Field(min_length=1)

class BusinessResponse(BaseModel):
    id: int
    name: str
    account_id: int
    balance: float
    created_at: Optional[datetime] = None
