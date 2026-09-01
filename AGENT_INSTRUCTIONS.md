# AGENT_INSTRUCTIONS.md - Coding & Architectural Rules

Any AI agent working on this codebase **MUST** strictly adhere to the following rules and standards.

---

## 1. Environment & Path Specifications

* **Operating System**: macOS
* **Project Directory**: `/Users/tevinbandara/Desktop/Finance Tracker`
* **Backend Location**: `/Users/tevinbandara/Desktop/Finance Tracker/backend`
  * Python Venv: `/Users/tevinbandara/Desktop/Finance Tracker/backend/.venv/bin/python`
  * Server Port: **`8002`** (FastAPI + Uvicorn via `uvicorn main:app --host 127.0.0.1 --port 8002 --reload`)
  * Database: `/Users/tevinbandara/Desktop/Finance Tracker/backend/finance.db` (SQLite)
* **Frontend Location**: `/Users/tevinbandara/Desktop/Finance Tracker/frontend`
  * Framework: Next.js 15 (App Router, TypeScript, Tailwind CSS)
  * Dev Port: **`3000`**
* **Antigravity CLI Binary**: `/Users/tevinbandara/.local/bin/agy`
* **Export File**: `/Users/tevinbandara/Desktop/Finance Tracker/finance_audit_export.json`
* **One-Click Launcher**: `/Users/tevinbandara/Desktop/Finance Tracker/start.sh`

---

## 2. Design Aesthetics & Color Palette Rules

The application UI is designed with a **Warm Minimalist Stone / Taupe Aesthetic** inspired by high-end executive dashboards (Hermes Agent theme).

### Color Tokens:
| Token Name | Hex Code | Purpose |
| :--- | :--- | :--- |
| **Canvas Background** | `#E5E3DC` | Main page background |
| **Sidebar Background** | `#DDD9D1` | Left navigation sidebar |
| **Card Background** | `#EFECE5` | Content cards & table containers |
| **Card Border** | `#D6D2C8` | Subtle card borders |
| **Obsidian Dark** | `#18181B` | Active nav pills, primary buttons, headers |
| **Warm Bronze** | `#B45309` | Subscriptions, key accents |
| **Success Green** | `#16A34A` | Income, deposits, healthy status |
| **Alert Red** | `#DC2626` | Expenses, debt owed, rent deficit |
| **Primary Text** | `#1C1B17` | High contrast charcoal text |

> [!CAUTION]
> **COLOR PALETTE RESTRICTION**:
> **NEVER USE ELECTRIC BLUE (`#2563EB`)**. The user explicitly rejected bright electric blue. Always use Obsidian (`#18181B`) for active UI elements and Warm Bronze (`#B45309`) or Emerald Green (`#16A34A`) for accents.

---

## 3. Financial & Accounting Logic Rules

1. **Rent Obligation**: Fixed at **Rs 35,000 / month** due on the 31st.
   * If `Sampath Bank Balance < 35,000`, display **`⚠️ Rent Deficit`** badge in red.
2. **Double-Entry Transfers vs. Expenses**:
   * **Income**: Increases physical `Cash On Hand` (+Cash).
   * **Transfers (`transaction_type == "transfer"`)**: Moves cash from Wallet into Sampath Bank (-Cash On Hand, +Sampath Bank). **Total Expense = 0**.
   * **Living Expenses**: Deducts from Cash or Bank and increases `total_monthly_expenses`.
3. **Partial Repayments**:
   * Debt items track `amount` (original) and `paid_amount` (repaid so far).
   * `Remaining Balance = max(0, amount - paid_amount)`.
   * Header debt summary MUST sum remaining balances, not original totals.
4. **SQLite Schema Updates**:
   * When adding new columns to SQLAlchemy models in `backend/models.py`, you MUST execute an `ALTER TABLE` SQLite command or migrate `finance.db` to prevent `OperationalError: no such column`.

---

## 4. Execution & Verification Rules

* **DO NOT** declare a feature complete until you have run verification commands:
  * Backend verification: Test API endpoints using Python `fastapi.testclient.TestClient`.
  * Frontend verification: Run `npm run build` inside `/Users/tevinbandara/Desktop/Finance Tracker/frontend` to guarantee clean TypeScript compilation.
* **Preserve Code Quality**:
  * Keep line lengths reasonable.
  * Use proper TypeScript interfaces for all data structures in `page.tsx`.
  * Keep backend schemas strictly aligned with database models.
