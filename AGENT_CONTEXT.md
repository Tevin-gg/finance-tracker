# AGENT_CONTEXT.md - Project Context & Domain Knowledge

Welcome to the **Personal Finance Tracker & Wealth OS** project! This document provides complete context on the user's financial domain, system architecture, database models, and calculation formulas.

---

## 1. User Profile & Financial Context

* **User Name**: Tevin Bandara
* **Profile**: University student dependent on parent allowances / pocket money, with occasional freelance revenue.
* **Monthly Fixed Obligation**: Rent (Rs 35,000) due on the 31st of every month.
* **Active Debt Obligations**:
  * Loan from Mom: Originally Rs 18,000 (partially paid down to Rs 7,000 remaining).
* **Active Receivables (Money Lent Out)**:
  * Money lent to Pasindu: Rs 5,000.
* **Recurring Software & Bills**:
  * Subscriptions (~Rs 11,300/mo): ChatGPT Plus (Rs 6,000), Internet (Rs 6,000), Gym (Rs 6,000), Spotify (Rs 1,500), TradingView (Rs 4,000), API Services (Rs 2,200).
* **Business Equipment Wishlist**:
  * High-end video creator kit (Gimbal owned: Rs 200k, Portable HD owned: Rs 20k, 360 Drone wishlist: Rs 270k, 200mm Lens wishlist: Rs 300k, 360 Cam wishlist: Rs 160k).

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js 15 Frontend                             │
│       (App Router, TypeScript, Tailwind CSS, Lucide Icons)             │
│                     Running on http://localhost:3000                   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP REST API
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        FastAPI Backend Engine                          │
│                     Running on http://127.0.0.1:8002                   │
└───────────────┬────────────────────────────────────────┬───────────────┘
                │ SQLite ORM                             │ CLI Subprocess
                ▼                                        ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│     SQLite Database           │        │   Antigravity CLI (/agy)      │
│  (backend/finance.db)         │        │  Exports: audit_export.json   │
└───────────────────────────────┘        └───────────────────────────────┘
```

---

## 3. Database Schemas (`backend/models.py`)

1. **`Account`**:
   - `id`, `name` ("Sampath Bank", "Subscription Account", "Cash On Hand", "Loan (Mom)"), `type` ("bank", "cash", "debt"), `balance`, `currency`.
2. **`Transaction`**:
   - `id`, `date`, `description`, `amount`, `category`, `transaction_type` ("income", "expense", "transfer"), `is_fixed`, `created_at`.
3. **`DebtItem`**:
   - `id`, `person`, `type` ("i_owe" vs "lent"), `description`, `amount` (original), `paid_amount` (repaid so far), `is_settled` (boolean), `created_at`.
4. **`Subscription`**:
   - `id`, `name`, `cost`, `due_date`, `category`, `is_paid_this_month`, `last_paid_date`.
5. **`BankStatementItem`**:
   - `id`, `date`, `description`, `deposit`, `withdrawal`, `balance`.
6. **`GearItem`**:
   - `id`, `title`, `cost`, `saved_amount`, `is_paid`, `category`.
7. **`AIAdviceLog`**:
   - `id`, `created_at`, `audit_summary`, `score`, `strict_feedback`, `action_items`.

---

## 4. Key Calculation Formulas

* **Liquid Bank Balance**:
  $$\text{Bank Balance} = \text{Initial Balance} + \sum \text{Deposits/Transfers} - \sum \text{Expenses/Withdrawals} - \sum \text{Paid Subscriptions}$$
* **Rent Deficit Indicator**:
  $$\text{Rent Status} = \begin{cases} \text{⚠️ Rent Deficit (Red)}, & \text{if Bank Balance} < \text{Rs } 35,000 \\ \text{Healthy Buffer (Green)}, & \text{if Bank Balance} \ge \text{Rs } 35,000 \end{cases}$$
* **Remaining Debt**:
  $$\text{Remaining Debt} = \max(0, \text{Original Amount} - \text{Paid Amount})$$
* **Daily Burn Rate & Runway Days**:
  $$\text{Daily Burn} = \frac{\text{Total Expenses}}{30}, \quad \text{Runway Days} = \frac{\text{Bank Balance}}{\text{Daily Burn}}$$

---

## 5. AI Assistant & Antigravity CLI Integration

The system integrates directly with the user's local **Antigravity CLI binary** (`/Users/tevinbandara/.local/bin/agy`).

* **Export Pipeline**: `POST /api/v1/ai/export-json` dumps structured summary data into `/Users/tevinbandara/Desktop/Finance Tracker/finance_audit_export.json`.
* **Interactive AI Chat Drawer**: The right drawer on the frontend enables real-time Q&A with an AI Coach that enforces tough-love financial discipline regarding rent deficit, Mom debt clearance, and business gear savings.
