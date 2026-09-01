import os
import subprocess
from datetime import datetime
from typing import Optional

from constants import RENT_AMOUNT

AGY_PATH = "/Users/tevinbandara/.local/bin/agy"
WORKSPACE_DIR = "/Users/tevinbandara/Desktop/Finance Tracker"
LOG_FILE = "/Users/tevinbandara/Desktop/Finance Tracker/backend/agy_coach.log"

def call_antigravity_cli(prompt: str) -> Optional[str]:
    """
    Calls the local Antigravity CLI (/Users/tevinbandara/.local/bin/agy) 
    in non-interactive print mode with a custom workspace log file.
    """
    if os.path.exists(AGY_PATH):
        try:
            cmd = [
                AGY_PATH,
                "--log-file", LOG_FILE,
                "--print", prompt
            ]
            result = subprocess.run(
                cmd,
                cwd=WORKSPACE_DIR,
                capture_output=True,
                text=True,
                timeout=25
            )
            output = result.stdout.strip()
            if output:
                return output
        except Exception as e:
            print("Antigravity CLI execution error:", e)

    return None

def generate_strict_ai_audit(summary_data: dict, transactions_list: list, gear_list: list, user_note: Optional[str] = None) -> dict:
    bank_balance = summary_data.get("bank_balance", 0.0)
    mom_debt = summary_data.get("mom_debt", 0.0)
    total_lent = summary_data.get("total_money_lent", 0.0)
    monthly_expenses = summary_data.get("total_monthly_expenses", 0.0)
    monthly_subs = summary_data.get("total_subscriptions_monthly", 0.0)
    upcoming_gear = summary_data.get("upcoming_gear_total", 0.0)
    paid_gear = summary_data.get("paid_gear_total", 0.0)
    runway_days = summary_data.get("runway_days", 0)
    # Computed once in main.get_summary() from ALL liquid funds (bank + cash + sub
    # account) net of unpaid subscriptions — not just bank_balance alone.
    available_for_rent = summary_data.get("available_for_rent", bank_balance)
    rent_deficit = summary_data.get("rent_deficit", bank_balance < RENT_AMOUNT)

    score = 100
    if bank_balance < 5000:
        score -= 35
    if mom_debt > 10000:
        score -= 25
    if rent_deficit:
        score -= 25
    score = max(10, min(95, score))

    action_items = []
    if rent_deficit:
        action_items.append(f"URGENT RENT DEFICIT: Total liquid funds (Rs {available_for_rent:,.2f}) do NOT cover next rent (Rs {RENT_AMOUNT:,.0f}). Freeze all non-essentials.")
    if mom_debt > 0:
        action_items.append(f"DEBT REPAYMENT: You owe Rs {mom_debt:,.2f} to Mom. Allocate 20% of incoming parent transfers to clearing this debt.")
    if upcoming_gear > 0:
        action_items.append(f"GEAR WISHLIST FREEZE: Rs {upcoming_gear:,.2f} in upcoming gear (360 Drone, 200mm Lens). Only buy gear after building a 3-month cash buffer.")
    if total_lent > 0:
        action_items.append(f"COLLECT RECEIVABLES: You have Rs {total_lent:,.2f} lent out. Collect this money from borrowers immediately.")
    action_items.append("MONETIZE EXISTING GEAR: Pitch 2 local client video/photo projects this week using your Rs 200k Gimbal and existing camera kit.")

    # Formulate prompt for Antigravity CLI
    prompt = f"""You are a strict, direct, tough-love AI Financial Coach for a video creator who is dependent on parent allowance.
Financial Data:
- Sampath Bank Cash: Rs {bank_balance:,.2f}
- Debt to Mom: Rs {mom_debt:,.2f}
- Money Lent Out: Rs {total_lent:,.2f}
- Monthly Expenses: Rs {monthly_expenses:,.2f} (Subscriptions: Rs {monthly_subs:,.2f})
- Upcoming Wishlist: Rs {upcoming_gear:,.2f}
- User Note: {user_note or 'None'}

Give a strict, candid fact-check review with 3 tough directives. No sugarcoating."""

    cli_output = call_antigravity_cli(prompt)

    if cli_output:
        strict_feedback = f"### 🤖 ANTIGRAVITY CLI AUDIT\n\n{cli_output}"
    else:
        recent_tx_desc = ", ".join([f"{t['description']} (Rs {t['amount']:,.2f})" for t in transactions_list[:5]]) or "No recent transactions."
        rent_verdict = (
            f"Your total liquid funds of **Rs {available_for_rent:,.2f}** (bank + cash + subscription account, net of unpaid subs) fail to cover your fixed rent obligation of **Rs {RENT_AMOUNT:,.0f}**."
            if rent_deficit else
            f"Your total liquid funds of **Rs {available_for_rent:,.2f}** currently cover your Rs {RENT_AMOUNT:,.0f} rent obligation, but stay disciplined."
        )
        strict_feedback = f"""### ⚠️ STRICT FINANCIAL FACT-CHECK

**Current Financial Overview**:
- **Liquid Bank Cash (Sampath)**: Rs {bank_balance:,.2f}
- **Debt to Mom**: Rs {mom_debt:,.2f}
- **Money Lent Out**: Rs {total_lent:,.2f}
- **Monthly Fixed Expenses**: Rs {monthly_expenses:,.2f} (Rent: Rs 35k, Subs: Rs {monthly_subs:,.2f})
- **Estimated Cash Runway**: {runway_days} days

**The Cold Hard Truth**:
{rent_verdict} Adding **Rs {upcoming_gear:,.2f} in upcoming gear** while carrying **Rs {mom_debt:,.2f} in debt to Mom** requires immediate discipline.

**Fact-Check Questions for You**:
1. *Why are you paying Rs {monthly_subs:,.2f}/mo in subscriptions when your liquid funds are below rent level?*
2. *When will you collect the Rs {total_lent:,.2f} you lent out to others?*
3. *What active steps are you taking this week to earn independent income from your owned Rs {paid_gear:,.2f} gear kit?*

**Weekly Action Directives**:
1. **Zero Non-Essential Spending**: Freeze any extra variable spending.
2. **Mom Debt Clearing**: Pay down your Rs {mom_debt:,.2f} debt systematically as soon as allowance arrives.
3. **Monetize Kit**: Reach out to 2 prospective video clients this week to earn independent income.
"""

    return {
        "score": score,
        "audit_summary": f"Health Score: {score}/100 | Cash Runway: {runway_days} Days | Mom Debt: Rs {mom_debt:,.2f}",
        "strict_feedback": strict_feedback,
        "action_items": action_items,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def process_ai_chat_message(user_message: str, summary_data: dict, transactions_list: list, gear_list: list) -> str:
    bank_balance = summary_data.get("bank_balance", 0.0)
    mom_debt = summary_data.get("mom_debt", 0.0)
    total_lent = summary_data.get("total_money_lent", 0.0)
    monthly_expenses = summary_data.get("total_monthly_expenses", 0.0)
    upcoming_gear = summary_data.get("upcoming_gear_total", 0.0)
    available_for_rent = summary_data.get("available_for_rent", bank_balance)
    rent_deficit = summary_data.get("rent_deficit", bank_balance < RENT_AMOUNT)

    prompt = f"""You are a strict, direct, tough-love AI Financial Coach answering a question from a video creator dependent on parent allowance.
Financial State: Bank Cash = Rs {bank_balance:,.2f}, Mom Debt = Rs {mom_debt:,.2f}, Money Lent Out = Rs {total_lent:,.2f}, Upcoming Gear Wishlist = Rs {upcoming_gear:,.2f}.
User Question: "{user_message}"

Answer strictly, directly, and concisely (2-3 sentences max). Fact-check their financial reality."""

    cli_output = call_antigravity_cli(prompt)
    if cli_output:
        return cli_output

    msg_lower = user_message.lower()
    if "rent" in msg_lower or "bank" in msg_lower:
        if rent_deficit:
            return f"Your total liquid funds (bank + cash + sub account, net of unpaid subs) are Rs {available_for_rent:,.2f}. Rent is Rs {RENT_AMOUNT:,.0f}. You have a deficit of Rs {RENT_AMOUNT - available_for_rent:,.2f}. Do not spend a single rupee on non-essentials until rent is secured."
        return f"Your total liquid funds are Rs {available_for_rent:,.2f}, which covers your Rs {RENT_AMOUNT:,.0f} rent. Don't get comfortable — keep the buffer."
    if "debt" in msg_lower or "mom" in msg_lower:
        return f"You owe Rs {mom_debt:,.2f} to your Mom. Stop planning new equipment purchases (Rs {upcoming_gear:,.2f} wishlist) until your Mom debt is completely paid off."
    if "gear" in msg_lower or "camera" in msg_lower or "drone" in msg_lower or "buy" in msg_lower:
        return f"Your upcoming gear wishlist totals Rs {upcoming_gear:,.2f}. With Rs {bank_balance:,.2f} in the bank and Rs {mom_debt:,.2f} owed to Mom, buying more gear right now is irresponsible."
    
    return f"Strict Coach Audit: Bank cash is Rs {bank_balance:,.2f}, Mom debt is Rs {mom_debt:,.2f}, monthly expenses are Rs {monthly_expenses:,.2f}. Focus on zero non-essential spending."
