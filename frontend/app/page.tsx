"use client";

import React, { useState, useEffect } from "react";
import { 
  Wallet, 
  CreditCard, 
  Camera, 
  Bot, 
  AlertCircle, 
  CheckCircle2, 
  Plus, 
  Sparkles, 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  X, 
  Search, 
  ChevronRight, 
  Send, 
  Paperclip, 
  Pin,
  Receipt,
  PieChart,
  Landmark,
  Repeat,
  Check,
  Trash2,
  Download,
  MessageSquare,
  Edit3,
  ArrowLeftRight,
  ShoppingBag,
  BarChart3,
  Archive,
  ChevronLeft,
  Briefcase
} from "lucide-react";
import { DailyCashFlowChart, CategoryBreakdownChart, DebtProgressChart, SavingsGoalsChart } from "./components/Charts";

// A plain fetch() only rejects on network failure — a 4xx/5xx response resolves
// normally, so every call site used to silently treat backend validation errors
// (or the backend being down) as success. This wrapper makes that impossible:
// it throws with a readable message (parsed from FastAPI's error body when
// present) on any non-OK response, so every caller's catch block actually fires.
async function apiFetch(url: string, options?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error("Can't reach the backend. Is it running?");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI/Pydantic validation error shape: [{loc: [...], msg: "..."}]
        message = body.detail
          .map((d: any) => `${(d.loc || []).slice(-1)[0] || "field"}: ${d.msg}`)
          .join("; ");
      }
    } catch {
      // Response body wasn't JSON — keep the generic status-based message.
    }
    throw new Error(message);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

interface SummaryData {
  bank_balance: number;
  cash_on_hand: number;
  sub_account_balance: number;
  mom_debt: number;
  total_money_lent: number;
  total_monthly_income: number;
  total_monthly_expenses: number;
  total_fixed_expenses: number;
  total_variable_expenses: number;
  total_subscriptions_monthly: number;
  subscriptions_paid_this_month: number;
  subscriptions_unpaid_this_month: number;
  upcoming_gear_total: number;
  paid_gear_total: number;
  upcoming_personal_total: number;
  paid_personal_total: number;
  runway_days: number;
  available_for_rent: number;
  rent_deficit: boolean;
}

interface TransactionItem {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
  transaction_type: string;
  is_fixed: boolean;
  is_archived?: boolean;
  account_id?: number | null;
  to_account_id?: number | null;
}

interface ArchivedMonthSummary {
  month: string; // "YYYY-MM"
  income: number;
  expense: number;
  net: number;
  transaction_count: number;
}

interface DebtItem {
  id: number;
  person: string;
  type: string;
  description: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  is_settled: boolean;
}

interface SubscriptionItem {
  id: number;
  name: string;
  cost: number;
  due_date: string;
  category: string;
  is_paid_this_month: boolean;
  last_paid_date?: string;
}

interface BankStatementItem {
  id: number;
  date: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number;
}

interface GearItem {
  id: number;
  title: string;
  cost: number;
  saved_amount: number;
  is_paid: boolean;
  category: string;
  kind: string; // "business" (Equipment Kit) vs "personal" (Personal Wishlist)
}

interface AccountItem {
  id: number;
  name: string;
  type: string;
  balance: number;
  currency: string;
  business_id?: number | null;
}

interface Business {
  id: number;
  name: string;
  account_id: number;
  balance: number;
  created_at?: string;
}

interface AIAuditResult {
  score: number;
  audit_summary: string;
  strict_feedback: string;
  action_items: string[];
  created_at: string;
}

interface ChatMessage {
  sender: "user" | "ai";
  text: string;
  timestamp: string;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [bankStatements, setBankStatements] = useState<BankStatementItem[]>([]);
  const [gearItems, setGearItems] = useState<GearItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<number | null>(null);

  // Keep the selection in sync with what actually exists: default to the first
  // business once any load, and drop back to null if the selected one gets deleted
  // elsewhere. Without this, the ledger view (which already falls back to
  // businesses[0] for display) and the header's "+ Add Entry" button visibility
  // (which checks the raw state) could disagree about whether a business is
  // "selected" — which is exactly what happened: the button hid itself while the
  // ledger showed a business anyway.
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAudit, setAiAudit] = useState<AIAuditResult | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [userNote, setUserNote] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      sender: "ai",
      text: "I am your Strict AI Coach. Rent is Rs 35,000 and your bank balance is low. Ask me about your cash flow, rent runway, or debt payoff plan.",
      timestamp: "Just now"
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [historyMonths, setHistoryMonths] = useState<ArchivedMonthSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState<string | null>(null);
  const [historyTransactions, setHistoryTransactions] = useState<TransactionItem[]>([]);

  const [activeCategory, setActiveCategory] = useState<"overview" | "cashflow" | "debt" | "subscriptions" | "bank" | "equipment" | "personal" | "insights" | "history" | "businesses">("overview");
  const [activeBankSubTab, setActiveBankSubTab] = useState<"sampath" | "subscription_acc">("sampath");

  const [showModal, setShowModal] = useState(false);
  const [modalFormType, setModalFormType] = useState<"cashflow" | "debt" | "subscription" | "gear" | "bank" | "personal" | "business">("cashflow");

  const [fieldDesc, setFieldDesc] = useState("");
  const [fieldAmount, setFieldAmount] = useState("");
  const [fieldCategory, setFieldCategory] = useState("General");
  const [fieldType, setFieldType] = useState("expense");
  const [fieldPerson, setFieldPerson] = useState("");
  const [fieldDueDate, setFieldDueDate] = useState(new Date().toISOString().split("T")[0]);
  // Which account an income/expense entry should hit. Left empty ("") means "let the
  // backend guess" (cash if it covers the amount, else bank) — the old, confusing
  // default. Picking one explicitly here is what actually fixes "cash expenses keep
  // coming out of the bank": the guess only kicked in because tracked Cash On Hand
  // was too low to 'afford' the expense, so it silently fell back to Sampath Bank.
  const [fieldAccountId, setFieldAccountId] = useState<string>("");

  // Shared modal for the four actions that used to move money via the same silent
  // cash-if-it-covers-it-else-bank guess as the Add Entry form: paying a
  // subscription, settling a debt, a partial debt payment, and adjusting gear
  // savings. Each just needs an explicit account choice, some also an amount.
  const [accountModal, setAccountModal] = useState<
    | { type: "sub-pay"; sub: SubscriptionItem }
    | { type: "debt-settle"; debt: DebtItem }
    | { type: "debt-pay"; debt: DebtItem }
    | { type: "gear-savings"; gear: GearItem }
    | null
  >(null);
  const [actionAmount, setActionAmount] = useState("");
  const [actionAccountId, setActionAccountId] = useState("");

  // Replaces window.prompt()/window.confirm() everywhere in this file. Native dialogs
  // are unreliable in real browsers — Chrome permanently silences alert/confirm/prompt
  // on a page after the user (or an extension) dismisses one and checks "Prevent this
  // page from creating additional dialogs," and some privacy extensions block them
  // outright. When that happens the call just returns null/false instantly with no
  // visible error, which looks exactly like "the button does nothing" — that's what
  // broke the Add Business button. These two in-app modals never rely on the browser's
  // own dialog system, so they can't be silenced that way.
  const [promptModal, setPromptModal] = useState<
    | { title: string; label: string; placeholder?: string; isNumber?: boolean; onSubmit: (value: string) => void }
    | null
  >(null);
  const [promptValue, setPromptValue] = useState("");
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const API_URL = "http://localhost:8002/api/v1";

  const [toast, setToast] = useState<{ message: string; type: "error" | "success" } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Escape closes whichever modal is open — neither modal had any keyboard dismiss
  // before, only the small X button.
  useEffect(() => {
    if (!showModal && !showAiModal && !accountModal && !promptModal && !confirmModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setShowModal(false);
      setShowAiModal(false);
      setAccountModal(null);
      setPromptModal(null);
      setConfirmModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showModal, showAiModal, accountModal, promptModal, confirmModal]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const showError = (fallback: string, err: unknown) => {
    console.error(fallback, err);
    setToast({ message: err instanceof Error ? err.message : fallback, type: "error" });
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [sumData, txData, debtData, subData, bankData, gearData, accountData, businessData] = await Promise.all([
        apiFetch(`${API_URL}/summary`),
        apiFetch(`${API_URL}/transactions`),
        apiFetch(`${API_URL}/debts`),
        apiFetch(`${API_URL}/subscriptions`),
        apiFetch(`${API_URL}/bank-statements`),
        apiFetch(`${API_URL}/gear`),
        apiFetch(`${API_URL}/accounts`),
        apiFetch(`${API_URL}/businesses`),
      ]);

      setSummary(sumData);
      setTransactions(txData);
      setDebts(debtData);
      setSubscriptions(subData);
      setBankStatements(bankData);
      setGearItems(gearData);
      setAccounts(accountData);
      setBusinesses(businessData);
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to reach the backend.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (businesses.length === 0) {
      if (activeBusinessId !== null) setActiveBusinessId(null);
      return;
    }
    if (!businesses.some((b) => b.id === activeBusinessId)) {
      setActiveBusinessId(businesses[0].id);
    }
  }, [businesses, activeBusinessId]);

  const fetchHistoryMonths = async () => {
    try {
      setHistoryLoading(true);
      const data = await apiFetch(`${API_URL}/history/months`);
      setHistoryMonths(data);
    } catch (err) {
      showError("Failed to fetch history months.", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistoryMonth = async (month: string) => {
    try {
      setHistoryLoading(true);
      setSelectedHistoryMonth(month);
      const data = await apiFetch(`${API_URL}/history/${month}`);
      setHistoryTransactions(data);
    } catch (err) {
      showError("Failed to fetch that month's transactions.", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeCategory === "history") {
      setSelectedHistoryMonth(null);
      fetchHistoryMonths();
    }
  }, [activeCategory]);

  const openAddModal = () => {
    if (activeCategory === "debt") {
      setModalFormType("debt");
      setFieldType("i_owe");
    } else if (activeCategory === "subscriptions") {
      setModalFormType("subscription");
    } else if (activeCategory === "equipment") {
      setModalFormType("gear");
    } else if (activeCategory === "personal") {
      setModalFormType("personal");
    } else if (activeCategory === "bank") {
      setModalFormType("bank");
      setFieldType("deposit");
    } else if (activeCategory === "businesses") {
      setModalFormType("business");
      setFieldType("expense");
    } else {
      setModalFormType("cashflow");
      setFieldType("expense");
    }

    setFieldDesc("");
    setFieldAmount("");
    setFieldPerson("");
    setFieldAccountId("");
    setShowModal(true);
  };

  const handleAddBusiness = () => {
    setPromptValue("");
    setPromptModal({
      title: "Add Business",
      label: "Business name",
      placeholder: "e.g. Photography, Trading",
      onSubmit: async (name) => {
        if (!name.trim()) return;
        try {
          const biz = await apiFetch(`${API_URL}/businesses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim() }),
          });
          setToast({ message: "Business added.", type: "success" });
          setActiveBusinessId(biz.id);
          fetchData();
        } catch (err) {
          showError("Couldn't add that business.", err);
        }
      },
    });
  };

  const handleRunAiAudit = async () => {
    setAiLoading(true);
    setShowAiModal(true);
    try {
      const data = await apiFetch(`${API_URL}/ai/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_note: userNote || undefined }),
      });
      setAiAudit(data);
    } catch (err) {
      showError("The AI audit couldn't be generated.", err);
      setShowAiModal(false);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSendChatMessage = async () => {
    if (!chatInput.trim()) return;

    const userText = chatInput;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setChatMessages((prev) => [...prev, { sender: "user", text: userText, timestamp: now }]);
    setChatInput("");

    try {
      const data = await apiFetch(`${API_URL}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      setChatMessages((prev) => [
        ...prev,
        { sender: "ai", text: data.reply, timestamp: data.created_at || "Now" }
      ]);
    } catch (err) {
      showError("The AI Coach couldn't respond.", err);
      setChatMessages((prev) => [
        ...prev,
        { sender: "ai", text: "I couldn't reach the backend just now — try again in a moment.", timestamp: "Now" }
      ]);
    }
  };

  const handleExportJson = async () => {
    try {
      await apiFetch(`${API_URL}/ai/export-json`, { method: "POST" });
      setExportStatus("JSON Exported for Antigravity CLI!");
      setTimeout(() => setExportStatus(null), 4000);
    } catch (err) {
      showError("Export failed.", err);
    }
  };

  const handleEditBankBalance = () => {
    setPromptValue(summary ? summary.bank_balance.toString() : "0");
    setPromptModal({
      title: "Edit Bank Balance",
      label: "New Sampath Bank balance (Rs)",
      isNumber: true,
      onSubmit: async (newBalStr) => {
        const num = parseFloat(newBalStr);
        if (isNaN(num)) return;
        try {
          await apiFetch(`${API_URL}/accounts/bank-balance`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ balance: num }),
          });
          fetchData();
        } catch (err) {
          showError("Failed to update the bank balance.", err);
        }
      },
    });
  };

  const handleEditCashBalance = () => {
    setPromptValue(summary ? (summary.cash_on_hand || 0).toString() : "0");
    setPromptModal({
      title: "Edit Cash On Hand",
      label: "Physical Cash On Hand in wallet (Rs)",
      isNumber: true,
      onSubmit: async (newBalStr) => {
        const num = parseFloat(newBalStr);
        if (isNaN(num)) return;
        try {
          await apiFetch(`${API_URL}/accounts/cash-balance`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ balance: num }),
          });
          fetchData();
        } catch (err) {
          showError("Failed to update Cash On Hand.", err);
        }
      },
    });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(fieldAmount);
    if (!amount) return;

    try {
      if (modalFormType === "cashflow") {
        // "transfer_deposit"/"transfer_withdraw" are a frontend-only split of the one
        // backend transaction_type "transfer" — Transfer is now a real from-account ->
        // to-account move (any pair), not hardcoded Cash -> Bank only, so a plain
        // "transfer" dropdown value can't say which direction on its own anymore.
        const isDeposit = fieldType === "transfer_deposit";
        const isWithdraw = fieldType === "transfer_withdraw";
        await apiFetch(`${API_URL}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: new Date().toISOString().split("T")[0],
            description: fieldDesc,
            amount: amount,
            category: fieldCategory,
            transaction_type: (isDeposit || isWithdraw) ? "transfer" : fieldType, // "expense", "income", or "transfer"
            is_fixed: false,
            // Explicit choice for income/expense — this is what stops the backend
            // from guessing cash-if-it-covers-it-else-bank. For a transfer, these two
            // ARE the whole point: which account it left from and landed in.
            account_id: isDeposit ? cashAccount?.id : isWithdraw ? bankAccount?.id : (fieldAccountId ? Number(fieldAccountId) : undefined),
            to_account_id: isDeposit ? bankAccount?.id : isWithdraw ? cashAccount?.id : undefined,
          }),
        });
      } else if (modalFormType === "business") {
        const business = businesses.find((b) => b.id === activeBusinessId);
        if (!business) return;
        const isDraw = fieldType === "draw";       // business -> personal (Owner's Draw)
        const isInject = fieldType === "inject";   // personal -> business (Capital Injection)
        const otherAccountId = fieldAccountId ? Number(fieldAccountId) : undefined;
        await apiFetch(`${API_URL}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: new Date().toISOString().split("T")[0],
            description: fieldDesc,
            amount: amount,
            category: fieldCategory,
            transaction_type: (isDraw || isInject) ? "transfer" : fieldType, // "expense", "income", "draw", or "inject"
            is_fixed: false,
            // Income/expense always hit this business's own account — no guessing
            // possible since a business has exactly one account. Draw/Inject move
            // between this business's account and whichever personal account was
            // picked (Cash On Hand or Sampath Bank).
            account_id: isDraw ? business.account_id : isInject ? otherAccountId : business.account_id,
            to_account_id: isDraw ? otherAccountId : isInject ? business.account_id : undefined,
          }),
        });
      } else if (modalFormType === "debt") {
        await apiFetch(`${API_URL}/debts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: fieldPerson || (fieldType === "i_owe" ? "Mom" : "Friend"),
            type: fieldType,
            description: fieldDesc,
            amount: amount,
            paid_amount: 0.0,
            is_settled: false,
          }),
        });
      } else if (modalFormType === "subscription") {
        await apiFetch(`${API_URL}/subscriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fieldDesc,
            cost: amount,
            due_date: fieldDueDate,
            category: fieldCategory,
            is_paid_this_month: false,
          }),
        });
      } else if (modalFormType === "gear") {
        await apiFetch(`${API_URL}/gear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: fieldDesc,
            cost: amount,
            saved_amount: 0.0,
            is_paid: false,
            category: fieldCategory,
            kind: "business",
          }),
        });
      } else if (modalFormType === "personal") {
        await apiFetch(`${API_URL}/gear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: fieldDesc,
            cost: amount,
            saved_amount: 0.0,
            is_paid: false,
            category: fieldCategory,
            kind: "personal",
          }),
        });
      } else if (modalFormType === "bank") {
        await apiFetch(`${API_URL}/bank-statements`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: new Date().toISOString().split("T")[0],
            description: fieldDesc,
            deposit: fieldType === "deposit" ? amount : 0.0,
            withdrawal: fieldType === "withdrawal" ? amount : 0.0,
            balance: summary ? summary.bank_balance + (fieldType === "deposit" ? amount : -amount) : amount,
          }),
        });
      }

      setShowModal(false);
      setToast({ message: "Saved.", type: "success" });
      fetchData();
    } catch (err) {
      showError("Couldn't save that entry — nothing was changed.", err);
    }
  };

  const handleDeleteTransaction = (id: number) => {
    setConfirmModal({
      message: "Are you sure you want to remove this transaction entry?",
      onConfirm: async () => {
        try {
          await apiFetch(`${API_URL}/transactions/${id}`, { method: "DELETE" });
          fetchData();
        } catch (err) {
          showError("Failed to delete that transaction.", err);
        }
      },
    });
  };

  const handleDeleteDebt = (id: number) => {
    setConfirmModal({
      message: "Are you sure you want to remove this debt entry?",
      onConfirm: async () => {
        try {
          await apiFetch(`${API_URL}/debts/${id}`, { method: "DELETE" });
          fetchData();
        } catch (err) {
          showError("Failed to delete that debt.", err);
        }
      },
    });
  };

  const handleDeleteSubscription = (id: number) => {
    setConfirmModal({
      message: "Are you sure you want to remove this subscription?",
      onConfirm: async () => {
        try {
          await apiFetch(`${API_URL}/subscriptions/${id}`, { method: "DELETE" });
          fetchData();
        } catch (err) {
          showError("Failed to delete that subscription.", err);
        }
      },
    });
  };

  const handleDeleteBankItem = (id: number) => {
    setConfirmModal({
      message: "Are you sure you want to remove this bank statement entry?",
      onConfirm: async () => {
        try {
          await apiFetch(`${API_URL}/bank-statements/${id}`, { method: "DELETE" });
          fetchData();
        } catch (err) {
          showError("Failed to delete that bank statement entry.", err);
        }
      },
    });
  };

  const handleDeleteGearItem = (id: number) => {
    setConfirmModal({
      message: "Are you sure you want to remove this equipment item?",
      onConfirm: async () => {
        try {
          await apiFetch(`${API_URL}/gear/${id}`, { method: "DELETE" });
          fetchData();
        } catch (err) {
          showError("Failed to delete that item.", err);
        }
      },
    });
  };

  // These four actions all used to move money by guessing an account (cash if it
  // covers the amount, else bank) with no way to override it — same bug class as
  // the main Add Entry form had. They now open a shared modal with an explicit
  // account picker instead of firing straight off a button click / prompt().
  const openPaySubscriptionModal = (sub: SubscriptionItem) => {
    setActionAccountId("");
    setAccountModal({ type: "sub-pay", sub });
  };

  const openSettleDebtModal = (debt: DebtItem) => {
    setActionAccountId("");
    setAccountModal({ type: "debt-settle", debt });
  };

  const openPartialPayDebtModal = (debt: DebtItem) => {
    setActionAmount("");
    setActionAccountId("");
    setAccountModal({ type: "debt-pay", debt });
  };

  const openUpdateSavingsModal = (gear: GearItem) => {
    setActionAmount(gear.saved_amount.toString());
    setActionAccountId("");
    setAccountModal({ type: "gear-savings", gear });
  };

  const handleAccountModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountModal) return;
    const accountId = actionAccountId ? Number(actionAccountId) : undefined;

    try {
      if (accountModal.type === "sub-pay") {
        await apiFetch(`${API_URL}/subscriptions/${accountModal.sub.id}/pay`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        });
      } else if (accountModal.type === "debt-settle") {
        await apiFetch(`${API_URL}/debts/${accountModal.debt.id}/settle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        });
      } else if (accountModal.type === "debt-pay") {
        const num = parseFloat(actionAmount);
        if (isNaN(num) || num <= 0) return;
        await apiFetch(`${API_URL}/debts/${accountModal.debt.id}/pay`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_amount: num, account_id: accountId }),
        });
      } else if (accountModal.type === "gear-savings") {
        const num = parseFloat(actionAmount);
        if (isNaN(num)) return;
        await apiFetch(`${API_URL}/gear/${accountModal.gear.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ saved_amount: num, account_id: accountId }),
        });
      }
      setAccountModal(null);
      setToast({ message: "Saved.", type: "success" });
      fetchData();
    } catch (err) {
      showError("That couldn't be saved.", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#E5E3DC] text-[#1C1B17]">
        <div className="flex flex-col items-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-[#18181B]" />
          <p className="text-sm font-medium text-[#6B6860]">Loading Finance OS...</p>
        </div>
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#E5E3DC] text-[#1C1B17] p-6">
        <div className="flex flex-col items-center space-y-3 text-center max-w-sm">
          <div className="p-3 rounded-full bg-[#FEE2E2] text-[#DC2626]">
            <AlertCircle className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-[#1C1B17]">Can't reach the backend</p>
          <p className="text-xs text-[#6B6860]">
            {loadError || "No data came back."} Make sure the FastAPI server is running on http://127.0.0.1:8002.
          </p>
          <button
            onClick={fetchData}
            className="flex items-center space-x-1.5 px-4 py-2 bg-[#18181B] hover:bg-[#27272A] text-white rounded-xl text-xs font-semibold transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  const cashAccount = accounts.find((a) => a.name === "Cash On Hand");
  const bankAccount = accounts.find((a) => a.name === "Sampath Bank");

  // Once a month is closed (see the History tab), its transactions are archived —
  // they stay in the database for History and for the Charts tab's real trailing
  // history, but the live Cash Flow Ledger only ever shows the current, open month.
  const currentTransactions = transactions.filter((t) => !t.is_archived);
  const incomeList = currentTransactions.filter((t) => t.transaction_type === "income");
  const expenseList = currentTransactions.filter((t) => t.transaction_type === "expense");
  const transferList = currentTransactions.filter((t) => t.transaction_type === "transfer");
  const debtsIOwe = debts.filter((d) => d.type === "i_owe");
  const debtsLent = debts.filter((d) => d.type === "lent");
  // gearItems now holds both Business Equipment Kit and Personal Wishlist items,
  // distinguished by `kind` — split them so each tab only ever sees its own items.
  const upcomingGearList = gearItems.filter((g) => g.kind !== "personal" && !g.is_paid);
  const paidGearList = gearItems.filter((g) => g.kind !== "personal" && g.is_paid);
  const upcomingPersonalList = gearItems.filter((g) => g.kind === "personal" && !g.is_paid);
  const paidPersonalList = gearItems.filter((g) => g.kind === "personal" && g.is_paid);

  return (
    <div className="flex h-screen overflow-hidden bg-[#E5E3DC] text-[#1C1B17]">

      {/* TOAST — surfaces the errors that used to only reach the console */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center space-x-2 px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold border ${
            toast.type === "error"
              ? "bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]"
              : "bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]"
          }`}
        >
          {toast.type === "error" ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SIDEBAR CATEGORY SWITCHER */}
      <aside className="w-64 warm-sidebar flex flex-col justify-between p-3 select-none flex-shrink-0">
        <div className="space-y-4">
          <div className="relative px-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#8E8A80]" />
            <input
              type="text"
              placeholder="Search tables..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#E3E0D8] border border-[#CECAC0] rounded-xl text-xs text-[#1C1B17] placeholder-[#8E8A80] focus:outline-none focus:bg-white focus:border-[#18181B]"
            />
          </div>

          <div className="space-y-1 text-xs">
            <div className="px-2 py-1 text-[10px] font-bold text-[#8E8A80] uppercase tracking-wider flex items-center space-x-1">
              <Pin className="w-3 h-3 text-[#74716A]" />
              <span>Categorized Tables</span>
            </div>

            <button
              onClick={() => setActiveCategory("overview")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "overview" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <PieChart className="w-4 h-4" />
              <span className="truncate">0. Overview Dashboard</span>
            </button>

            <button
              onClick={() => setActiveCategory("cashflow")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "cashflow" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <Receipt className="w-4 h-4" />
              <span className="truncate">1. Cash Flow Ledger</span>
            </button>

            <button
              onClick={() => setActiveCategory("debt")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "debt" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span className="truncate">2. Debts & Lent Money</span>
            </button>

            <button
              onClick={() => setActiveCategory("subscriptions")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "subscriptions" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <Repeat className="w-4 h-4" />
              <span className="truncate">3. Subscriptions & Bills</span>
            </button>

            <button
              onClick={() => setActiveCategory("bank")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "bank" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <Landmark className="w-4 h-4" />
              <span className="truncate">4. Bank Accounts Ledger</span>
            </button>

            <button
              onClick={() => setActiveCategory("equipment")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "equipment" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <Camera className="w-4 h-4" />
              <span className="truncate">5. Business Equipment Kit</span>
            </button>

            <button
              onClick={() => setActiveCategory("personal")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "personal" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="truncate">6. Personal Wishlist</span>
            </button>

            <button
              onClick={() => setActiveCategory("insights")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "insights" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span className="truncate">7. Charts & Insights</span>
            </button>

            <button
              onClick={() => setActiveCategory("history")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "history" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <Archive className="w-4 h-4" />
              <span className="truncate">8. History</span>
            </button>

            <button
              onClick={() => setActiveCategory("businesses")}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left font-medium transition ${
                activeCategory === "businesses" ? "bg-[#18181B] text-white shadow-sm font-semibold" : "text-[#2C2B27] hover:bg-[#D5D1C7]"
              }`}
            >
              <Briefcase className="w-4 h-4" />
              <span className="truncate">9. Businesses</span>
            </button>
          </div>

          <div className="space-y-1 text-xs pt-3 border-t border-[#D2CDC3]">
            <div className="px-2 py-1 text-[10px] font-bold text-[#8E8A80] uppercase tracking-wider">
              Summaries
            </div>
            <div className="px-3 py-1 text-[#52504A] flex justify-between items-center text-[11px]">
              <span>Mom Debt</span>
              <span className="font-mono text-[#DC2626] font-semibold">Rs {summary.mom_debt.toLocaleString()}</span>
            </div>
            <div className="px-3 py-1 text-[#52504A] flex justify-between items-center text-[11px]">
              <span>Money Lent Out</span>
              <span className="font-mono text-[#16A34A] font-semibold">Rs {summary.total_money_lent.toLocaleString()}</span>
            </div>
            <div className="px-3 py-1 text-[#52504A] flex justify-between items-center text-[11px]">
              <span>Monthly Subs</span>
              <span className="font-mono text-[#B45309] font-semibold">Rs {summary.total_subscriptions_monthly.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="p-2 bg-[#E5E2DA] rounded-xl border border-[#D5D1C8] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-[#18181B] text-white flex items-center justify-center font-bold text-xs">
              TB
            </div>
            <div>
              <p className="text-xs font-semibold text-[#1C1B17]">Tevin Bandara</p>
              <p className="text-[10px] text-[#74716A]">Dependent Cash Flow</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#8E8A80]" />
        </div>
      </aside>

      {/* CENTER MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#E5E3DC] overflow-hidden">
        
        {/* HEADER BAR */}
        <header className="h-14 px-6 border-b border-[#D6D2C8] flex items-center justify-between bg-[#E5E3DC] flex-shrink-0">
          <div className="flex items-center space-x-3">
            <h2 className="text-base font-bold text-[#1C1B17]">
              {activeCategory === "overview" && "Categorized Finance Overview"}
              {activeCategory === "cashflow" && "1. Operational Cash Flow (Pocket Money & Expenses)"}
              {activeCategory === "debt" && "2. Debts I Owe & Money Lent Table"}
              {activeCategory === "subscriptions" && "3. Subscriptions & Monthly Bills"}
              {activeCategory === "bank" && "4. Bank Accounts Ledger (Sampath & Subscription Bank)"}
              {activeCategory === "equipment" && "5. Business Equipment Kit Wishlist"}
              {activeCategory === "personal" && "6. Personal Wishlist"}
              {activeCategory === "insights" && "7. Charts & Insights"}
              {activeCategory === "history" && "8. History"}
              {activeCategory === "businesses" && "9. Businesses"}
            </h2>
          </div>

          <div className="flex items-center space-x-2">
            {activeCategory === "businesses" && (
              <button
                onClick={handleAddBusiness}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#EFECE5] hover:bg-[#F6F4EE] text-[#1C1B17] border border-[#D6D2C8] rounded-xl text-xs font-semibold transition shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#7C3AED]" />
                <span>+ Add Business</span>
              </button>
            )}

            {activeCategory !== "insights" && activeCategory !== "history" && !(activeCategory === "businesses" && !activeBusinessId) && (
              <button
                onClick={openAddModal}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#EFECE5] hover:bg-[#F6F4EE] text-[#1C1B17] border border-[#D6D2C8] rounded-xl text-xs font-semibold transition shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#16A34A]" />
                <span>
                  {activeCategory === "debt" && "+ Add Debt / Lent Money"}
                  {activeCategory === "subscriptions" && "+ Add Subscription"}
                  {activeCategory === "equipment" && "+ Add Equipment"}
                  {activeCategory === "personal" && "+ Add Personal Item"}
                  {activeCategory === "bank" && "+ Add Bank Entry"}
                  {activeCategory === "businesses" && "+ Add Entry"}
                  {activeCategory !== "debt" && activeCategory !== "subscriptions" && activeCategory !== "equipment" && activeCategory !== "personal" && activeCategory !== "bank" && activeCategory !== "businesses" && "+ Add Entry"}
                </span>
              </button>
            )}

            <button
              onClick={handleRunAiAudit}
              className="flex items-center space-x-2 px-4 py-1.5 bg-[#18181B] hover:bg-[#27272A] text-white rounded-xl text-xs font-semibold shadow-sm transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FDE68A]" />
              <span>Weekly AI Fact-Check</span>
            </button>
          </div>
        </header>

        {/* MAIN DISPLAY AREA */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* TOP SUMMARY CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* KPI CARD 1: BANK BALANCE */}
            <div className="warm-card p-4 rounded-2xl">
              <div className="flex justify-between items-center text-xs font-semibold text-[#6B6860]">
                <div className="flex items-center space-x-1.5">
                  <span>Bank Balance (Sampath)</span>
                  <button onClick={handleEditBankBalance} title="Edit Bank Balance" className="text-[#8E8A80] hover:text-[#18181B] p-0.5">
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>
                <Landmark className="w-4 h-4 text-[#16A34A]" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[#1C1B17] font-mono">
                Rs {summary.bank_balance.toLocaleString()}
              </div>
              <div className="mt-2">
                {summary.rent_deficit ? (
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-[#FEE2E2] text-[#DC2626] rounded-md border border-[#FCA5A5] flex items-center gap-1 w-fit">
                    <AlertCircle className="w-3 h-3" /> Rent Deficit
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-[#DCFCE7] text-[#15803D] rounded-md border border-[#86EFAC]">
                    Healthy Buffer
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[#8E8A80] mt-1">
                Liquid funds for rent: Rs {summary.available_for_rent.toLocaleString()} (bank + cash + sub account, net of unpaid subs)
              </p>
            </div>

            {/* KPI CARD 2: DEBT VS LENT */}
            <div className="warm-card p-4 rounded-2xl">
              <div className="flex justify-between items-center text-xs font-semibold text-[#6B6860]">
                <span>Debt vs Lent</span>
                <AlertCircle className="w-4 h-4 text-[#DC2626]" />
              </div>
              <div className="mt-2 space-y-0.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#6B6860]">I Owe (Mom):</span>
                  <span className="font-bold font-mono text-[#DC2626]">Rs {summary.mom_debt.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B6860]">Lent Out:</span>
                  <span className="font-bold font-mono text-[#16A34A]">Rs {summary.total_money_lent.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* KPI CARD 3: SUBSCRIPTIONS MONTHLY */}
            <div className="warm-card p-4 rounded-2xl">
              <div className="flex justify-between items-center text-xs font-semibold text-[#6B6860]">
                <span>Subscriptions Monthly</span>
                <Repeat className="w-4 h-4 text-[#B45309]" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[#B45309] font-mono">
                Rs {summary.total_subscriptions_monthly.toLocaleString()}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-[#74716A]">
                <span>Paid: Rs {summary.subscriptions_paid_this_month.toLocaleString()} <span className="text-[#8E8A80]">(already in Total Expenses)</span></span>
              </div>
              <div className="flex justify-between text-[11px] text-[#74716A]">
                <span>Still due: Rs {summary.subscriptions_unpaid_this_month.toLocaleString()}</span>
              </div>
            </div>

            {/* REPLACED KPI CARD 4: CASH ON HAND (WALLET CASH) */}
            <div className="warm-card p-4 rounded-2xl">
              <div className="flex justify-between items-center text-xs font-semibold text-[#6B6860]">
                <div className="flex items-center space-x-1.5">
                  <span>Cash On Hand (Wallet)</span>
                  <button onClick={handleEditCashBalance} title="Edit Physical Wallet Cash" className="text-[#8E8A80] hover:text-[#18181B] p-0.5">
                    <Edit3 className="w-3 h-3" />
                  </button>
                </div>
                <Wallet className="w-4 h-4 text-[#16A34A]" />
              </div>
              <div className="mt-2 text-2xl font-bold text-[#16A34A] font-mono">
                Rs {(summary.cash_on_hand || 0).toLocaleString()}
              </div>
              <p className="text-[11px] text-[#74716A] mt-1">Physical cash for daily uni expenses</p>
            </div>
          </div>

          {/* VIEW 0: OVERVIEW DASHBOARD */}
          {activeCategory === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-4">
                <div className="warm-card p-5 rounded-2xl">
                  <h3 className="text-sm font-bold text-[#1C1B17] mb-3 flex items-center space-x-2">
                    <Receipt className="w-4 h-4 text-[#18181B]" />
                    <span>Recent Cash Flow Entries</span>
                  </h3>
                  <div className="space-y-2">
                    {currentTransactions.slice(0, 5).map((tx) => (
                      <div key={tx.id} className="p-3 bg-[#EFECE5] rounded-xl border border-[#D6D2C8] flex justify-between items-center text-xs">
                        <div className="flex items-center space-x-2.5">
                          <div className={`p-1.5 rounded-lg ${
                            tx.transaction_type === "income" ? "bg-[#DCFCE7] text-[#16A34A]" :
                            tx.transaction_type === "transfer" ? "bg-[#FEF3C7] text-[#B45309]" : "bg-[#FEE2E2] text-[#DC2626]"
                          }`}>
                            {tx.transaction_type === "income" ? <ArrowDownLeft className="w-3.5 h-3.5" /> :
                             tx.transaction_type === "transfer" ? <ArrowLeftRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                          </div>
                          <div>
                            <p className="font-semibold text-[#1C1B17]">{tx.description}</p>
                            <span className="text-[10px] text-[#74716A]">{tx.date} • {tx.category}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className={`font-mono font-bold ${
                            tx.transaction_type === "income" ? "text-[#16A34A]" :
                            tx.transaction_type === "transfer" ? "text-[#B45309]" : "text-[#1C1B17]"
                          }`}>
                            {tx.transaction_type === "income" ? "+" : tx.transaction_type === "transfer" ? "↔" : "-"}Rs {tx.amount.toLocaleString()}
                          </span>
                          <button onClick={() => handleDeleteTransaction(tx.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-4">
                <div className="warm-card p-5 rounded-2xl">
                  <h3 className="text-sm font-bold text-[#1C1B17] mb-3 flex items-center space-x-2">
                    <Repeat className="w-4 h-4 text-[#B45309]" />
                    <span>Upcoming Subscriptions</span>
                  </h3>
                  <div className="space-y-2">
                    {subscriptions.slice(0, 4).map((sub) => (
                      <div key={sub.id} className="p-3 bg-[#EFECE5] rounded-xl border border-[#D6D2C8] flex justify-between items-center text-xs">
                        <div>
                          <p className="font-semibold text-[#1C1B17]">{sub.name}</p>
                          <span className="text-[10px] text-[#74716A]">Due: {sub.due_date}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-[#B45309]">Rs {sub.cost.toLocaleString()}</span>
                          <button onClick={() => handleDeleteSubscription(sub.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 1: CASH FLOW TABLE (INCOME, EXPENSES, & TRANSFERS) */}
          {activeCategory === "cashflow" && (
            <div className="space-y-6">
              {/* Pocket Money / Income Table */}
              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <ArrowDownLeft className="w-4 h-4 text-[#16A34A]" />
                    <span>Pocket Money & Income Table (+Cash On Hand)</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#16A34A]">Total Income: Rs {summary.total_monthly_income.toLocaleString()}</span>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Details / Source</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3 text-right">Amount (Rs)</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD6]">
                    {incomeList.map((tx) => (
                      <tr key={tx.id} className="hover:bg-[#F6F4EE]">
                        <td className="py-2.5 px-3 font-mono text-[#74716A]">{tx.date}</td>
                        <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{tx.description}</td>
                        <td className="py-2.5 px-3 text-[#6B6860]">{tx.category}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#16A34A]">+Rs {tx.amount.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-center">
                          <button onClick={() => handleDeleteTransaction(tx.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bank Deposit Transfers Table */}
              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <ArrowLeftRight className="w-4 h-4 text-[#B45309]" />
                    <span>Bank Deposit Transfers (Cash On Hand → Sampath Bank)</span>
                  </h3>
                  <span className="text-xs text-[#74716A]">0 Expense • Moves Cash to Bank</span>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Details / Transfer</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Amount (Rs)</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD6]">
                    {transferList.map((tx) => (
                      <tr key={tx.id} className="hover:bg-[#F6F4EE]">
                        <td className="py-2.5 px-3 font-mono text-[#74716A]">{tx.date}</td>
                        <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{tx.description}</td>
                        <td className="py-2.5 px-3 text-[#B45309] font-medium">Cash → Bank Transfer</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#B45309]">↔ Rs {tx.amount.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-center">
                          <button onClick={() => handleDeleteTransaction(tx.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Living Expenses Table */}
              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <ArrowUpRight className="w-4 h-4 text-[#DC2626]" />
                    <span>Living Expenses Table</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#DC2626]">Total Expenses: Rs {summary.total_monthly_expenses.toLocaleString()}</span>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Details / Item</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3 text-right">Amount (Rs)</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD6]">
                    {expenseList.map((tx) => (
                      <tr key={tx.id} className="hover:bg-[#F6F4EE]">
                        <td className="py-2.5 px-3 font-mono text-[#74716A]">{tx.date}</td>
                        <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{tx.description}</td>
                        <td className="py-2.5 px-3 text-[#6B6860]">{tx.category}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#1C1B17]">-Rs {tx.amount.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-center">
                          <button onClick={() => handleDeleteTransaction(tx.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW 2: DEBTS & MONEY LENT TABLE */}
          {activeCategory === "debt" && (
            <div className="space-y-6">
              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <CreditCard className="w-4 h-4 text-[#DC2626]" />
                    <span>Debts I Owe (Mom & Others)</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#DC2626]">Remaining Owed: Rs {summary.mom_debt.toLocaleString()}</span>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                      <th className="py-2 px-3">Person / Lender</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3">Repayment Progress</th>
                      <th className="py-2 px-3 text-right">Original (Rs)</th>
                      <th className="py-2 px-3 text-right">Paid (Rs)</th>
                      <th className="py-2 px-3 text-right">Remaining (Rs)</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD6]">
                    {debtsIOwe.map((debt) => {
                      const paid = debt.paid_amount || 0;
                      const remaining = debt.remaining_amount ?? Math.max(0, debt.amount - paid);
                      const pct = Math.min(100, Math.round((paid / (debt.amount || 1)) * 100));

                      return (
                        <tr key={debt.id} className="hover:bg-[#F6F4EE]">
                          <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{debt.person}</td>
                          <td className="py-2.5 px-3 text-[#6B6860]">{debt.description}</td>
                          <td className="py-2.5 px-3 w-40">
                            <div className="flex justify-between text-[10px] text-[#74716A] mb-1">
                              <span>{pct}% Paid</span>
                              <span>{debt.is_settled ? "Settled" : "Active"}</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#E2DFD6] rounded-full overflow-hidden">
                              <div className="h-full bg-[#DC2626]" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#6B6860]">Rs {debt.amount.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#16A34A]">Rs {paid.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#DC2626]">Rs {remaining.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-center space-x-1.5">
                            {!debt.is_settled && (
                              <>
                                <button
                                  onClick={() => openPartialPayDebtModal(debt)}
                                  className="px-2 py-1 bg-[#18181B] text-white rounded text-[10px] font-semibold hover:bg-[#27272A]"
                                >
                                  + Pay
                                </button>
                                <button
                                  onClick={() => openSettleDebtModal(debt)}
                                  className="px-2 py-1 bg-[#16A34A] text-white rounded text-[10px] font-semibold hover:bg-[#15803D]"
                                >
                                  Full Settle
                                </button>
                              </>
                            )}
                            <button onClick={() => handleDeleteDebt(debt.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1 align-middle">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <ArrowDownLeft className="w-4 h-4 text-[#16A34A]" />
                    <span>Money I Lent to Others</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#16A34A]">Remaining Receivable: Rs {summary.total_money_lent.toLocaleString()}</span>
                </div>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                      <th className="py-2 px-3">Borrower Name</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3">Collection Progress</th>
                      <th className="py-2 px-3 text-right">Original (Rs)</th>
                      <th className="py-2 px-3 text-right">Collected (Rs)</th>
                      <th className="py-2 px-3 text-right">Remaining (Rs)</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD6]">
                    {debtsLent.map((debt) => {
                      const paid = debt.paid_amount || 0;
                      const remaining = debt.remaining_amount ?? Math.max(0, debt.amount - paid);
                      const pct = Math.min(100, Math.round((paid / (debt.amount || 1)) * 100));

                      return (
                        <tr key={debt.id} className="hover:bg-[#F6F4EE]">
                          <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{debt.person}</td>
                          <td className="py-2.5 px-3 text-[#6B6860]">{debt.description}</td>
                          <td className="py-2.5 px-3 w-40">
                            <div className="flex justify-between text-[10px] text-[#74716A] mb-1">
                              <span>{pct}% Collected</span>
                              <span>{debt.is_settled ? "Collected" : "Pending"}</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#E2DFD6] rounded-full overflow-hidden">
                              <div className="h-full bg-[#16A34A]" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#6B6860]">Rs {debt.amount.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#16A34A]">Rs {paid.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#16A34A]">Rs {remaining.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-center space-x-1.5">
                            {!debt.is_settled && (
                              <>
                                <button
                                  onClick={() => openPartialPayDebtModal(debt)}
                                  className="px-2 py-1 bg-[#18181B] text-white rounded text-[10px] font-semibold hover:bg-[#27272A]"
                                >
                                  + Collect
                                </button>
                                <button
                                  onClick={() => openSettleDebtModal(debt)}
                                  className="px-2 py-1 bg-[#16A34A] text-white rounded text-[10px] font-semibold hover:bg-[#15803D]"
                                >
                                  Full Settle
                                </button>
                              </>
                            )}
                            <button onClick={() => handleDeleteDebt(debt.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1 align-middle">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW 3: SUBSCRIPTIONS TABLE */}
          {activeCategory === "subscriptions" && (
            <div className="warm-card p-5 rounded-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                  <Repeat className="w-4 h-4 text-[#B45309]" />
                  <span>Subscriptions & Recurring Services</span>
                </h3>
                <span className="text-xs font-mono font-bold text-[#B45309]">
                  Total Monthly Subs: Rs {summary.total_subscriptions_monthly.toLocaleString()}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                      <th className="py-2 px-3">Subscription Name</th>
                      <th className="py-2 px-3">Category</th>
                      <th className="py-2 px-3">Due Date</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Cost (Rs)</th>
                      <th className="py-2 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2DFD6]">
                    {subscriptions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-[#F6F4EE]">
                        <td className="py-3 px-3 font-semibold text-[#1C1B17]">{sub.name}</td>
                        <td className="py-3 px-3 text-[#6B6860]">{sub.category}</td>
                        <td className="py-3 px-3 text-[#74716A] font-mono">{sub.due_date}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${sub.is_paid_this_month ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
                            {sub.is_paid_this_month ? "Paid for Month" : "Due Soon"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-[#B45309]">
                          Rs {sub.cost.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-center space-x-2">
                          {!sub.is_paid_this_month ? (
                            <button
                              onClick={() => openPaySubscriptionModal(sub)}
                              className="px-3 py-1 bg-[#18181B] text-white rounded text-[10px] font-semibold hover:bg-[#27272A] transition"
                            >
                              Mark Paid
                            </button>
                          ) : (
                            <span className="text-[10px] text-[#16A34A] font-bold inline-flex items-center gap-1">
                              <Check className="w-3 h-3" /> Paid
                            </span>
                          )}
                          <button onClick={() => handleDeleteSubscription(sub.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1 align-middle">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW 4: BANK ACCOUNTS LEDGER (2-ACCOUNT TOGGLE) */}
          {activeCategory === "bank" && (
            <div className="space-y-4">
              {/* Account Switcher Sub-Tabs */}
              <div className="flex space-x-2 border-b border-[#D6D2C8] pb-2 text-xs">
                <button
                  onClick={() => setActiveBankSubTab("sampath")}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    activeBankSubTab === "sampath" ? "bg-[#18181B] text-white" : "bg-[#EFECE5] text-[#6B6860] hover:bg-[#F6F4EE]"
                  }`}
                >
                  1. Sampath Main Account (Rs {summary.bank_balance.toLocaleString()})
                </button>
                <button
                  onClick={() => setActiveBankSubTab("subscription_acc")}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    activeBankSubTab === "subscription_acc" ? "bg-[#18181B] text-white" : "bg-[#EFECE5] text-[#6B6860] hover:bg-[#F6F4EE]"
                  }`}
                >
                  2. Subscription Bank Account (Rs {(summary.sub_account_balance || 0).toLocaleString()})
                </button>
              </div>

              {activeBankSubTab === "sampath" ? (
                <div className="warm-card p-5 rounded-2xl space-y-4">
                  <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                    <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                      <Landmark className="w-4 h-4 text-[#16A34A]" />
                      <span>Sampath Agency Main Bank Ledger</span>
                    </h3>
                    <span className="text-xs font-mono font-bold text-[#16A34A]">
                      Balance: Rs {summary.bank_balance.toLocaleString()}
                    </span>
                  </div>

                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Transaction Details</th>
                        <th className="py-2 px-3 text-right">Deposit (Rs)</th>
                        <th className="py-2 px-3 text-right">Withdrawal (Rs)</th>
                        <th className="py-2 px-3 text-right">Reconciled Balance</th>
                        <th className="py-2 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2DFD6]">
                      {bankStatements.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F6F4EE]">
                          <td className="py-2.5 px-3 font-mono text-[#74716A]">{item.date}</td>
                          <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{item.description}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#16A34A]">
                            {item.deposit > 0 ? `+Rs ${item.deposit.toLocaleString()}` : "-"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[#DC2626]">
                            {item.withdrawal > 0 ? `-Rs ${item.withdrawal.toLocaleString()}` : "-"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#1C1B17]">
                            Rs {item.balance.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button onClick={() => handleDeleteBankItem(item.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="warm-card p-5 rounded-2xl space-y-4">
                  <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                    <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                      <Repeat className="w-4 h-4 text-[#B45309]" />
                      <span>Dedicated Subscription Bank Account Ledger</span>
                    </h3>
                    <span className="text-xs font-mono font-bold text-[#B45309]">
                      Account Balance: Rs {(summary.sub_account_balance || 0).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-[#6B6860]">
                    Dedicated secondary bank account used specifically for auto-paying recurring software & bill subscriptions.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* VIEW 5: BUSINESS EQUIPMENT KIT TABLE */}
          {activeCategory === "equipment" && (
            <div className="space-y-6">
              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <Camera className="w-4 h-4 text-[#D97706]" />
                    <span>Upcoming Business Expenses Wishlist</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#D97706]">
                    Wishlist Total: Rs {summary.upcoming_gear_total.toLocaleString()}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                        <th className="py-2 px-3">Item Details</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Savings Progress</th>
                        <th className="py-2 px-3 text-right">Cost (Rs)</th>
                        <th className="py-2 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2DFD6]">
                      {upcomingGearList.map((item) => {
                        const pct = Math.min(100, Math.round((item.saved_amount / item.cost) * 100));
                        return (
                          <tr key={item.id} className="hover:bg-[#F6F4EE]">
                            <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{item.title}</td>
                            <td className="py-2.5 px-3 text-[#6B6860]">{item.category}</td>
                            <td className="py-2.5 px-3 w-48">
                              <div className="flex justify-between text-[10px] text-[#74716A] mb-1">
                                <span>Rs {item.saved_amount.toLocaleString()}</span>
                                <span className="font-bold">{pct}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-[#E2DFD6] rounded-full overflow-hidden">
                                <div className="h-full bg-[#18181B]" style={{ width: `${pct}%` }} />
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#D97706]">
                              Rs {item.cost.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-center space-x-2">
                              <button
                                onClick={() => openUpdateSavingsModal(item)}
                                className="px-2 py-1 bg-[#18181B] text-white rounded text-[10px] font-semibold hover:bg-[#27272A]"
                              >
                                + Savings
                              </button>
                              <button onClick={() => handleDeleteGearItem(item.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1 align-middle">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                    <span>Paid & Owned Equipment Table</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#16A34A]">
                    Total Owned Assets: Rs {summary.paid_gear_total.toLocaleString()}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                        <th className="py-2 px-3">Item Details</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 text-right">Amount Paid (Rs)</th>
                        <th className="py-2 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2DFD6]">
                      {paidGearList.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F6F4EE]">
                          <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{item.title}</td>
                          <td className="py-2.5 px-3 text-[#6B6860]">{item.category}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] rounded text-[10px] font-semibold border border-[#86EFAC]">
                              Paid & Owned
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#16A34A]">
                            Rs {item.cost.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button onClick={() => handleDeleteGearItem(item.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* VIEW 6: PERSONAL WISHLIST TABLE */}
          {activeCategory === "personal" && (
            <div className="space-y-6">
              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <ShoppingBag className="w-4 h-4 text-[#7C3AED]" />
                    <span>Things I Want to Buy</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#7C3AED]">
                    Wishlist Total: Rs {summary.upcoming_personal_total.toLocaleString()}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                        <th className="py-2 px-3">Item Details</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Savings Progress</th>
                        <th className="py-2 px-3 text-right">Cost (Rs)</th>
                        <th className="py-2 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2DFD6]">
                      {upcomingPersonalList.map((item) => {
                        const pct = Math.min(100, Math.round((item.saved_amount / item.cost) * 100));
                        return (
                          <tr key={item.id} className="hover:bg-[#F6F4EE]">
                            <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{item.title}</td>
                            <td className="py-2.5 px-3 text-[#6B6860]">{item.category}</td>
                            <td className="py-2.5 px-3 w-48">
                              <div className="flex justify-between text-[10px] text-[#74716A] mb-1">
                                <span>Rs {item.saved_amount.toLocaleString()}</span>
                                <span className="font-bold">{pct}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-[#E2DFD6] rounded-full overflow-hidden">
                                <div className="h-full bg-[#18181B]" style={{ width: `${pct}%` }} />
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#7C3AED]">
                              Rs {item.cost.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-center space-x-2">
                              <button
                                onClick={() => openUpdateSavingsModal(item)}
                                className="px-2 py-1 bg-[#18181B] text-white rounded text-[10px] font-semibold hover:bg-[#27272A]"
                              >
                                + Savings
                              </button>
                              <button onClick={() => handleDeleteGearItem(item.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1 align-middle">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="warm-card p-5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                  <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                    <span>Purchased Table</span>
                  </h3>
                  <span className="text-xs font-mono font-bold text-[#16A34A]">
                    Total Bought: Rs {summary.paid_personal_total.toLocaleString()}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                        <th className="py-2 px-3">Item Details</th>
                        <th className="py-2 px-3">Category</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 text-right">Amount Paid (Rs)</th>
                        <th className="py-2 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2DFD6]">
                      {paidPersonalList.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F6F4EE]">
                          <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{item.title}</td>
                          <td className="py-2.5 px-3 text-[#6B6860]">{item.category}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] rounded text-[10px] font-semibold border border-[#86EFAC]">
                              Bought
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#16A34A]">
                            Rs {item.cost.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button onClick={() => handleDeleteGearItem(item.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* VIEW 7: CHARTS & INSIGHTS */}
          {activeCategory === "insights" && (
            <div className="space-y-6">
              <DailyCashFlowChart transactions={transactions} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <CategoryBreakdownChart transactions={transactions} />
                <DebtProgressChart debts={debts} />
              </div>
              <SavingsGoalsChart gearItems={gearItems} />
            </div>
          )}

          {/* VIEW 8: HISTORY (CLOSED MONTHS) */}
          {activeCategory === "history" && (
            <div className="space-y-4">
              {!selectedHistoryMonth ? (
                <div className="warm-card p-5 rounded-2xl space-y-3">
                  <div className="border-b border-[#D6D2C8] pb-3">
                    <h3 className="text-sm font-bold text-[#1C1B17]">Closed Months</h3>
                    <p className="text-[11px] text-[#8E8A80] mt-0.5">
                      Each month closes automatically when a new one starts — its transactions are archived here, and your account balances carry forward untouched.
                    </p>
                  </div>

                  {historyLoading ? (
                    <p className="text-xs text-[#8E8A80] py-8 text-center">Loading…</p>
                  ) : historyMonths.length === 0 ? (
                    <p className="text-xs text-[#8E8A80] py-8 text-center">No months closed yet — this month is still open on the Cash Flow Ledger.</p>
                  ) : (
                    <div className="space-y-2">
                      {historyMonths.map((m) => {
                        const label = new Date(m.month + "-02T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
                        return (
                          <button
                            key={m.month}
                            onClick={() => openHistoryMonth(m.month)}
                            className="w-full flex items-center justify-between p-4 bg-[#EFECE5] hover:bg-[#F6F4EE] border border-[#D6D2C8] rounded-xl text-left transition"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="p-2 rounded-lg bg-[#E2DFD6] text-[#6B6860]">
                                <Archive className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-[#1C1B17]">{label}</p>
                                <p className="text-[11px] text-[#8E8A80]">{m.transaction_count} transactions</p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-4 text-xs font-mono">
                              <span className="text-[#16A34A] font-bold">+Rs {m.income.toLocaleString()}</span>
                              <span className="text-[#DC2626] font-bold">-Rs {m.expense.toLocaleString()}</span>
                              <span className={`font-bold ${m.net >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                                Net {m.net >= 0 ? "+" : ""}Rs {m.net.toLocaleString()}
                              </span>
                              <ChevronRight className="w-4 h-4 text-[#8E8A80]" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="warm-card p-5 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between border-b border-[#D6D2C8] pb-3">
                    <button
                      onClick={() => setSelectedHistoryMonth(null)}
                      className="flex items-center space-x-1 text-xs font-semibold text-[#6B6860] hover:text-[#1C1B17]"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back to Closed Months</span>
                    </button>
                    <h3 className="text-sm font-bold text-[#1C1B17]">
                      {new Date(selectedHistoryMonth + "-02T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                    </h3>
                  </div>

                  {historyLoading ? (
                    <p className="text-xs text-[#8E8A80] py-8 text-center">Loading…</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                            <th className="py-2 px-3">Date</th>
                            <th className="py-2 px-3">Description</th>
                            <th className="py-2 px-3">Category</th>
                            <th className="py-2 px-3">Type</th>
                            <th className="py-2 px-3 text-right">Amount (Rs)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2DFD6]">
                          {historyTransactions.map((tx) => (
                            <tr key={tx.id} className="hover:bg-[#F6F4EE]">
                              <td className="py-2.5 px-3 text-[#6B6860]">{tx.date}</td>
                              <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{tx.description}</td>
                              <td className="py-2.5 px-3 text-[#6B6860]">{tx.category}</td>
                              <td className="py-2.5 px-3 text-[#6B6860] capitalize">{tx.transaction_type}</td>
                              <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                                tx.transaction_type === "income" ? "text-[#16A34A]" :
                                tx.transaction_type === "transfer" ? "text-[#B45309]" : "text-[#DC2626]"
                              }`}>
                                {tx.transaction_type === "income" ? "+" : tx.transaction_type === "transfer" ? "↔" : "-"}Rs {tx.amount.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* VIEW 9: BUSINESSES */}
          {activeCategory === "businesses" && (
            <div className="space-y-4">
              {businesses.length === 0 ? (
                <div className="warm-card p-8 rounded-2xl text-center space-y-2">
                  <Briefcase className="w-8 h-8 text-[#8E8A80] mx-auto" />
                  <p className="text-sm font-bold text-[#1C1B17]">No businesses yet</p>
                  <p className="text-xs text-[#8E8A80]">Click "+ Add Business" above to set up your first one — each gets its own balance, completely separate from your personal accounts.</p>
                </div>
              ) : (() => {
                const business = businesses.find((b) => b.id === activeBusinessId) || businesses[0];
                const businessTx = currentTransactions.filter(
                  (t) => t.account_id === business.account_id || t.to_account_id === business.account_id
                );
                return (
                  <>
                    {/* Business Switcher Sub-Tabs */}
                    <div className="flex flex-wrap gap-2 border-b border-[#D6D2C8] pb-2 text-xs">
                      {businesses.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setActiveBusinessId(b.id)}
                          className={`px-3 py-1.5 rounded-xl font-bold transition ${
                            business.id === b.id ? "bg-[#18181B] text-white" : "bg-[#EFECE5] text-[#6B6860] hover:bg-[#F6F4EE]"
                          }`}
                        >
                          {b.name} (Rs {b.balance.toLocaleString()})
                        </button>
                      ))}
                    </div>

                    <div className="warm-card p-5 rounded-2xl space-y-4">
                      <div className="flex justify-between items-center border-b border-[#D6D2C8] pb-3">
                        <h3 className="text-sm font-bold text-[#1C1B17] flex items-center space-x-2">
                          <Briefcase className="w-4 h-4 text-[#7C3AED]" />
                          <span>{business.name} Ledger</span>
                        </h3>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              setPromptValue(business.name);
                              setPromptModal({
                                title: "Rename Business",
                                label: "Business name",
                                onSubmit: async (name) => {
                                  if (!name.trim() || name.trim() === business.name) return;
                                  try {
                                    await apiFetch(`${API_URL}/businesses/${business.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ name: name.trim() }),
                                    });
                                    fetchData();
                                  } catch (err) {
                                    showError("Couldn't rename that business.", err);
                                  }
                                },
                              });
                            }}
                            className="text-[#8E8A80] hover:text-[#1C1B17]"
                            title="Rename business"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-mono font-bold text-[#7C3AED]">
                            Balance: Rs {business.balance.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {businessTx.length === 0 ? (
                        <p className="text-xs text-[#8E8A80] py-8 text-center">No entries yet for {business.name}. Use "+ Add Entry" above.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="text-[#6B6860] border-b border-[#D6D2C8] font-semibold">
                                <th className="py-2 px-3">Date</th>
                                <th className="py-2 px-3">Description</th>
                                <th className="py-2 px-3">Type</th>
                                <th className="py-2 px-3 text-right">Amount (Rs)</th>
                                <th className="py-2 px-3 text-center">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2DFD6]">
                              {businessTx.map((tx) => {
                                const isDrawOut = tx.transaction_type === "transfer" && tx.account_id === business.account_id;
                                const label = tx.transaction_type === "income" ? "Income"
                                  : tx.transaction_type === "expense" ? "Expense"
                                  : isDrawOut ? "Owner's Draw" : "Capital Injection";
                                const isOutflow = tx.transaction_type === "expense" || isDrawOut;
                                return (
                                  <tr key={tx.id} className="hover:bg-[#F6F4EE]">
                                    <td className="py-2.5 px-3 text-[#6B6860]">{tx.date}</td>
                                    <td className="py-2.5 px-3 font-semibold text-[#1C1B17]">{tx.description}</td>
                                    <td className="py-2.5 px-3 text-[#6B6860]">{label}</td>
                                    <td className={`py-2.5 px-3 text-right font-mono font-bold ${isOutflow ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
                                      {isOutflow ? "-" : "+"}Rs {tx.amount.toLocaleString()}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <button onClick={() => handleDeleteTransaction(tx.id)} className="text-[#8E8A80] hover:text-[#DC2626] p-1">
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

        </div>
      </main>

      {/* RIGHT AI COACH DRAWER (INTERACTIVE CHAT + ANTIGRAVITY EXPORT) */}
      <aside className="w-80 warm-sidebar flex flex-col justify-between border-l border-[#D2CDC3] flex-shrink-0 select-none">
        
        {/* Drawer Header */}
        <div className="p-3.5 border-b border-[#D6D2C8] flex justify-between items-center bg-[#E5E3DC]">
          <div className="flex items-center space-x-2">
            <Bot className="w-4 h-4 text-[#18181B]" />
            <span className="text-xs font-bold text-[#1C1B17] uppercase tracking-wider">Strict AI Coach</span>
          </div>

          <button
            onClick={handleExportJson}
            title="Export JSON for Antigravity CLI Ingestion"
            className="flex items-center space-x-1 px-2.5 py-1 bg-[#18181B] hover:bg-[#27272A] text-white rounded-lg text-[10px] font-bold shadow-xs transition"
          >
            <Download className="w-3 h-3 text-[#FDE68A]" />
            <span>Export CLI JSON</span>
          </button>
        </div>

        {exportStatus && (
          <div className="px-4 py-1.5 bg-[#DCFCE7] text-[#15803D] text-[10px] font-bold border-b border-[#86EFAC] flex items-center justify-between">
            <span>{exportStatus}</span>
            <Check className="w-3 h-3" />
          </div>
        )}

        {/* Interactive Chat Messages Stream */}
        <div className="flex-1 p-3.5 overflow-y-auto space-y-3 text-xs">
          {chatMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-xl text-xs space-y-1 ${
                msg.sender === "user"
                  ? "bg-[#18181B] text-white ml-6 shadow-xs"
                  : "bg-[#EFECE5] text-[#1C1B17] border border-[#D6D2C8] shadow-xs"
              }`}
            >
              <div className="flex items-center justify-between text-[9px] font-semibold opacity-75">
                <span>{msg.sender === "user" ? "You" : "Strict AI Coach"}</span>
                <span>{msg.timestamp}</span>
              </div>
              <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            </div>
          ))}
        </div>

        {/* Bottom Interactive Chat Input Bar */}
        <div className="p-3 border-t border-[#D6D2C8] bg-[#E5E3DC]">
          <div className="relative flex items-center bg-[#E3E0D8] border border-[#CECAC0] rounded-2xl px-3 py-2 focus-within:bg-white focus-within:border-[#18181B] transition">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendChatMessage()}
              placeholder="Ask AI Coach (e.g. rent, debt, gear)..."
              className="w-full bg-transparent text-xs text-[#1C1B17] placeholder-[#8E8A80] focus:outline-none pr-14"
            />
            <div className="absolute right-2 flex items-center space-x-1">
              <button
                onClick={handleSendChatMessage}
                className="p-1.5 rounded-full bg-[#18181B] text-white hover:bg-[#27272A] transition"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

      </aside>

      {/* CONTEXT-AWARE ENTRY CREATION MODAL */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-[#EFECE5] w-full max-w-md rounded-2xl border border-[#D6D2C8] p-6 space-y-4 shadow-xl relative">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 text-[#74716A] hover:text-[#1C1B17]">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-[#1C1B17]">
              {modalFormType === "debt" && "Add Debt or Lent Money Entry"}
              {modalFormType === "subscription" && "Add Subscription Entry"}
              {modalFormType === "gear" && "Add Equipment Wishlist Entry"}
              {modalFormType === "personal" && "Add Personal Wishlist Entry"}
              {modalFormType === "bank" && "Add Bank Transaction"}
              {modalFormType === "cashflow" && "Add Cash Flow Entry"}
              {modalFormType === "business" && `Add Entry — ${businesses.find((b) => b.id === activeBusinessId)?.name || ""}`}
            </h3>

            <form onSubmit={handleFormSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#6B6860] mb-1 font-medium">Description / Name</label>
                <input
                  type="text"
                  required
                  value={fieldDesc}
                  onChange={(e) => setFieldDesc(e.target.value)}
                  placeholder={
                    modalFormType === "debt" ? "e.g. Loan from Mom or Lent to Friend" :
                    modalFormType === "subscription" ? "e.g. ChatGPT, Spotify, Gym" :
                    modalFormType === "gear" ? "e.g. 360 Drone, 200mm Lens" :
                    modalFormType === "personal" ? "e.g. Sneakers, Headphones, Watch" :
                    modalFormType === "business" ? "e.g. Client payment, Camera rental, Owner draw" : "e.g. Pocket Money, Rent, Deposit"
                  }
                  className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                />
              </div>

              {modalFormType === "debt" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">Person Name</label>
                  <input
                    type="text"
                    required
                    value={fieldPerson}
                    onChange={(e) => setFieldPerson(e.target.value)}
                    placeholder="e.g. Mom, Pasindu, John"
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  />
                </div>
              )}

              <div>
                <label className="block text-[#6B6860] mb-1 font-medium">Amount (Rs)</label>
                <input
                  type="number"
                  required
                  value={fieldAmount}
                  onChange={(e) => setFieldAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                />
              </div>

              {modalFormType === "debt" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">Debt Type</label>
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  >
                    <option value="i_owe">Debt I Owe (Money Borrowed)</option>
                    <option value="lent">Money I Lent (Receivable from Someone Else)</option>
                  </select>
                </div>
              )}

              {modalFormType === "cashflow" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">Entry Type</label>
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  >
                    <option value="expense">Living Expense (Spent Money)</option>
                    <option value="income">Pocket Money / Income (+Cash On Hand)</option>
                    <option value="transfer_deposit">Deposit to Bank (Cash On Hand → Sampath Bank)</option>
                    <option value="transfer_withdraw">Withdraw to Cash (Sampath Bank → Cash On Hand)</option>
                  </select>
                </div>
              )}

              {modalFormType === "cashflow" && fieldType !== "transfer_deposit" && fieldType !== "transfer_withdraw" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">
                    {fieldType === "expense" ? "Paid From" : "Received Into"}
                  </label>
                  <select
                    value={fieldAccountId}
                    onChange={(e) => setFieldAccountId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  >
                    <option value="">Auto (cash if it covers it, else bank)</option>
                    {cashAccount && <option value={cashAccount.id}>Cash On Hand (Rs {cashAccount.balance.toLocaleString()})</option>}
                    {bankAccount && <option value={bankAccount.id}>Sampath Bank (Rs {bankAccount.balance.toLocaleString()})</option>}
                  </select>
                  <p className="text-[10.5px] text-[#8E8A80] mt-1">
                    Pick this explicitly for a cash {fieldType === "expense" ? "expense" : "income"} so it doesn't guess — "Auto" falls back to Sampath Bank whenever tracked cash can't cover the full amount.
                  </p>
                </div>
              )}

              {modalFormType === "business" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">Entry Type</label>
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  >
                    <option value="expense">Business Expense (Spent Money)</option>
                    <option value="income">Business Income (+{businesses.find((b) => b.id === activeBusinessId)?.name})</option>
                    <option value="draw">Owner's Draw (Business → Personal)</option>
                    <option value="inject">Capital Injection (Personal → Business)</option>
                  </select>
                </div>
              )}

              {modalFormType === "business" && (fieldType === "draw" || fieldType === "inject") && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">
                    {fieldType === "draw" ? "Send To (Personal Account)" : "Take From (Personal Account)"}
                  </label>
                  <select
                    value={fieldAccountId}
                    onChange={(e) => setFieldAccountId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  >
                    <option value="">Select an account…</option>
                    {cashAccount && <option value={cashAccount.id}>Cash On Hand (Rs {cashAccount.balance.toLocaleString()})</option>}
                    {bankAccount && <option value={bankAccount.id}>Sampath Bank (Rs {bankAccount.balance.toLocaleString()})</option>}
                  </select>
                  <p className="text-[10.5px] text-[#8E8A80] mt-1">
                    {fieldType === "draw"
                      ? "Money leaves this business and lands in the personal account you pick."
                      : "Money leaves the personal account you pick and funds this business."}
                  </p>
                </div>
              )}

              {modalFormType === "bank" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">Transaction Type</label>
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  >
                    <option value="deposit">Deposit (Money In)</option>
                    <option value="withdrawal">Withdrawal (Money Out)</option>
                  </select>
                </div>
              )}

              {modalFormType === "subscription" && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">Monthly Due Date</label>
                  <input
                    type="date"
                    required
                    value={fieldDueDate}
                    onChange={(e) => setFieldDueDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  />
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2 bg-[#18181B] hover:bg-[#27272A] text-white rounded-xl font-bold text-xs mt-2 transition"
              >
                Save {modalFormType.toUpperCase()} Entry
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ACCOUNT-PICKER MODAL — shared by pay subscription / settle debt / partial debt
          payment / update gear savings, replacing the plain prompt()s and one-click
          buttons those used to be. All four used to move money by guessing an account
          the same way the old Add Entry form did. */}
      {accountModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setAccountModal(null); }}
        >
          <div className="bg-[#EFECE5] w-full max-w-md rounded-2xl border border-[#D6D2C8] p-6 space-y-4 shadow-xl relative">
            <button onClick={() => setAccountModal(null)} className="absolute top-4 right-4 text-[#74716A] hover:text-[#1C1B17]">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-[#1C1B17]">
              {accountModal.type === "sub-pay" && `Pay ${accountModal.sub.name}`}
              {accountModal.type === "debt-settle" && `Settle Debt — ${accountModal.debt.person}`}
              {accountModal.type === "debt-pay" && (accountModal.debt.type === "i_owe" ? `Record Repayment — ${accountModal.debt.person}` : `Record Collection — ${accountModal.debt.person}`)}
              {accountModal.type === "gear-savings" && `Update Savings — ${accountModal.gear.title}`}
            </h3>

            <form onSubmit={handleAccountModalSubmit} className="space-y-3 text-xs">
              {accountModal.type === "sub-pay" && (
                <p className="text-[#6B6860]">Amount: <span className="font-mono font-bold text-[#1C1B17]">Rs {accountModal.sub.cost.toLocaleString()}</span></p>
              )}

              {accountModal.type === "debt-settle" && (
                <p className="text-[#6B6860]">
                  Remaining balance:{" "}
                  <span className="font-mono font-bold text-[#1C1B17]">
                    Rs {(accountModal.debt.remaining_amount ?? (accountModal.debt.amount - accountModal.debt.paid_amount)).toLocaleString()}
                  </span>
                </p>
              )}

              {(accountModal.type === "debt-pay" || accountModal.type === "gear-savings") && (
                <div>
                  <label className="block text-[#6B6860] mb-1 font-medium">
                    {accountModal.type === "debt-pay"
                      ? (accountModal.debt.type === "i_owe" ? "Repayment Amount (Rs)" : "Collection Amount (Rs)")
                      : "New Total Saved (Rs)"}
                  </label>
                  <input
                    type="number"
                    required
                    autoFocus
                    value={actionAmount}
                    onChange={(e) => setActionAmount(e.target.value)}
                    placeholder={
                      accountModal.type === "debt-pay"
                        ? `Remaining: Rs ${(accountModal.debt.remaining_amount ?? (accountModal.debt.amount - accountModal.debt.paid_amount)).toLocaleString()}`
                        : `Cost: Rs ${accountModal.gear.cost.toLocaleString()}`
                    }
                    className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                  />
                </div>
              )}

              <div>
                <label className="block text-[#6B6860] mb-1 font-medium">
                  {accountModal.type === "debt-pay" && accountModal.debt.type === "lent" ? "Received Into" : "Paid From"}
                </label>
                <select
                  value={actionAccountId}
                  onChange={(e) => setActionAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                >
                  <option value="">Auto (cash if it covers it, else bank)</option>
                  {cashAccount && <option value={cashAccount.id}>Cash On Hand (Rs {cashAccount.balance.toLocaleString()})</option>}
                  {bankAccount && <option value={bankAccount.id}>Sampath Bank (Rs {bankAccount.balance.toLocaleString()})</option>}
                </select>
                <p className="text-[10.5px] text-[#8E8A80] mt-1">
                  Pick this explicitly so it doesn't guess — "Auto" falls back to Sampath Bank whenever tracked cash can't cover the full amount.
                </p>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-[#18181B] hover:bg-[#27272A] text-white rounded-xl font-bold text-xs mt-2 transition"
              >
                {accountModal.type === "sub-pay" && "Mark Paid"}
                {accountModal.type === "debt-settle" && "Settle in Full"}
                {accountModal.type === "debt-pay" && "Save Payment"}
                {accountModal.type === "gear-savings" && "Update Savings"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* PROMPT MODAL — replaces window.prompt() (Add/Rename Business, Edit Bank/Cash Balance) */}
      {promptModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setPromptModal(null); }}
        >
          <div className="bg-[#EFECE5] w-full max-w-md rounded-2xl border border-[#D6D2C8] p-6 space-y-4 shadow-xl relative">
            <button onClick={() => setPromptModal(null)} className="absolute top-4 right-4 text-[#74716A] hover:text-[#1C1B17]">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-[#1C1B17]">{promptModal.title}</h3>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const { onSubmit } = promptModal;
                setPromptModal(null);
                onSubmit(promptValue);
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-[#6B6860] mb-1 font-medium">{promptModal.label}</label>
                <input
                  type={promptModal.isNumber ? "number" : "text"}
                  required
                  autoFocus
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={promptModal.placeholder}
                  className="w-full px-3 py-2 bg-white border border-[#D6D2C8] rounded-xl text-[#1C1B17] focus:outline-none focus:border-[#18181B]"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-[#18181B] hover:bg-[#27272A] text-white rounded-xl font-bold text-xs mt-2 transition"
              >
                Save
              </button>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM MODAL — replaces window.confirm() (delete entry confirmations) */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal(null); }}
        >
          <div className="bg-[#EFECE5] w-full max-w-sm rounded-2xl border border-[#D6D2C8] p-6 space-y-4 shadow-xl relative">
            <button onClick={() => setConfirmModal(null)} className="absolute top-4 right-4 text-[#74716A] hover:text-[#1C1B17]">
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-sm font-semibold text-[#1C1B17] pr-6">{confirmModal.message}</h3>

            <div className="flex space-x-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2 bg-white border border-[#D6D2C8] hover:bg-[#F6F4EE] text-[#1C1B17] rounded-xl font-bold text-xs transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { onConfirm } = confirmModal;
                  setConfirmModal(null);
                  onConfirm();
                }}
                className="flex-1 py-2 bg-[#DC2626] hover:bg-[#B91C1C] text-white rounded-xl font-bold text-xs transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI AUDIT FULL MODAL */}
      {showAiModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAiModal(false); }}
        >
          <div className="bg-[#EFECE5] w-full max-w-xl rounded-2xl border border-[#D6D2C8] p-6 space-y-4 shadow-xl relative max-h-[85vh] overflow-y-auto">
            <button onClick={() => setShowAiModal(false)} className="absolute top-4 right-4 text-[#74716A] hover:text-[#1C1B17]">
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2.5 text-[#18181B]">
              <Bot className="w-6 h-6 text-[#18181B]" />
              <div>
                <h3 className="text-lg font-bold text-[#1C1B17]">Strict AI Financial Audit</h3>
                <p className="text-xs text-[#74716A]">Tough-love analysis of your cash flow & gear wishlist</p>
              </div>
            </div>

            {aiLoading ? (
              <div className="py-10 flex flex-col items-center justify-center space-y-3">
                <RefreshCw className="w-7 h-7 text-[#18181B] animate-spin" />
                <p className="text-xs font-medium text-[#6B6860]">Fact-checking bank cash against rent & debt...</p>
              </div>
            ) : aiAudit ? (
              <div className="space-y-4">
                <div className="p-3 bg-[#FEE2E2] border border-[#FCA5A5] rounded-xl text-[#DC2626] text-xs font-semibold">
                  {aiAudit.audit_summary}
                </div>

                <div className="bg-white p-4 rounded-xl border border-[#D6D2C8] text-xs text-[#1C1B17] leading-relaxed whitespace-pre-wrap font-sans">
                  {aiAudit.strict_feedback}
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#1C1B17]">Directives:</h4>
                  <ul className="space-y-1 text-xs text-[#2C2B27]">
                    {aiAudit.action_items.map((item, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="text-[#DC2626] font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <div className="pt-2 border-t border-[#D6D2C8] flex justify-end">
              <button onClick={() => setShowAiModal(false)} className="px-4 py-1.5 bg-[#18181B] text-white font-bold text-xs rounded-xl hover:bg-[#27272A]">
                Close Audit
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
