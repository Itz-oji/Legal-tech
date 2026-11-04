import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  CalendarDays,
  CarFront,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CreditCard,
  Download,
  FileCheck2,
  FilePlus2,
  Files,
  FileText,
  FolderOpen,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Badge,
  Disclaimer,
  Empty,
  Modal,
  SectionHead,
  TextLink,
} from "./components/ui";
import {
  calculateBalance,
  addBusinessDays,
  formatCLP,
  formatDate,
  assessContractText,
} from "./lib/domain";
import type { RiskAssessment } from "./lib/domain";
import { loadContracts, saveContracts, todayISO } from "./lib/store";
import type { Contract, Milestone, MilestoneType } from "./lib/store";
import {
  downloadEvidence,
  readContractFile,
  storeEvidenceFile,
} from "./lib/files";

type Page =
  "dashboard" | "contracts" | "evaluation" | "tracking" | "claims" | "evidence";
type Dialog = {
  type: "new" | "milestone" | "notifications" | "help";
  id?: string;
} | null;
const navigation: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Resumen", icon: LayoutDashboard },
  { id: "contracts", label: "Mis contratos", icon: FileText },
  { id: "evaluation", label: "Evaluar contrato", icon: ShieldCheck },
  { id: "tracking", label: "Seguimiento", icon: ListChecks },
  { id: "claims", label: "Informes y reclamos", icon: Files },
  { id: "evidence", label: "Mis documentos", icon: FolderOpen },
];
const milestoneNames: Record<MilestoneType, string> = {
  entrega: "Entrega del vehículo",
  venta: "Venta informada",
  pago: "Pago recibido",
  traspaso: "Traspaso del vehículo",
};
function financial(c: Contract) {
  return calculateBalance(
    c.price,
    c.commission,
    c.milestones.filter((m) => m.type === "pago").map((m) => m.amount || 0),
  );
}
function deadline(c: Contract) {
  const sale = c.milestones.find((m) => m.type === "venta");
  return sale ? addBusinessDays(sale.date, c.paymentDays) : null;
}
function contractStatus(c: Contract) {
  const money = financial(c);
  const due = deadline(c);
  if (c.milestones.some((m) => m.type === "traspaso") && money.balance <= 0)
    return { label: "Finalizado", tone: "neutral" };
  if (due && due < todayISO() && money.balance > 0)
    return { label: "Pago vencido", tone: "danger" };
  if (c.milestones.some((m) => m.type === "venta") && money.balance > 0)
    return { label: "Pendiente de pago", tone: "warning" };
  if (money.balance <= 0) return { label: "Pago completo", tone: "success" };
  return { label: "En consignación", tone: "success" };
}
function isUnsafe(c: Contract) {
  const transfer = c.milestones.find((m) => m.type === "traspaso");
  if (!transfer) return false;
  return (
    calculateBalance(
      c.price,
      c.commission,
      c.milestones
        .filter((m) => m.type === "pago" && m.date <= transfer.date)
        .map((m) => m.amount || 0),
    ).balance > 0
  );
}
function isClaimable(c: Contract) {
  return (
    financial(c).balance > 0 &&
    (isUnsafe(c) || (!!deadline(c) && (deadline(c) as string) < todayISO()))
  );
}
function VehicleIcon({ index = 0 }: { index?: number }) {
  return (
    <div className={`vehicle-icon vehicle-${index % 4}`}>
      <CarFront size={24} strokeWidth={1.6} />
    </div>
  );
}
function CarIllustration() {
  return (
    <svg
      className="hero-illustration"
      viewBox="0 0 390 190"
      fill="none"
      aria-hidden="true"
    >
      <path d="M39 149h319M67 164h248" stroke="#ffffff" strokeOpacity=".13" />
      <circle cx="257" cy="89" r="75" fill="#ffffff" fillOpacity=".025" />
      <circle
        cx="257"
        cy="89"
        r="56"
        stroke="#ffffff"
        strokeOpacity=".1"
        strokeDasharray="4 6"
      />
      <path
        d="m72 109 23-8 37-39c5-5 10-7 18-7h84c11 0 18 4 25 12l30 35 35 13c8 3 13 10 13 18v8H62v-17c0-7 3-12 10-15Z"
        fill="#8FBAA7"
        fillOpacity=".14"
        stroke="#9CC2B1"
        strokeWidth="1.5"
      />
      <path
        d="m109 101 34-34h43v34h-77Zm88 0V67h33c7 0 10 3 15 8l23 26h-71Z"
        fill="#C2D6CD"
        fillOpacity=".12"
        stroke="#9CC2B1"
      />
      <path
        d="M63 121h30m209-3 30 8M188 109h13M108 141h166"
        stroke="#B7D3C5"
        strokeWidth="2"
      />
      <circle
        cx="113"
        cy="140"
        r="22"
        fill="#204C40"
        stroke="#A7C7B7"
        strokeWidth="1.5"
      />
      <circle cx="113" cy="140" r="11" stroke="#A7C7B7" />
      <circle
        cx="285"
        cy="140"
        r="22"
        fill="#204C40"
        stroke="#A7C7B7"
        strokeWidth="1.5"
      />
      <circle cx="285" cy="140" r="11" stroke="#A7C7B7" />
      <rect x="274" y="19" width="54" height="59" rx="15" fill="#DDEBDB" />
      <path
        d="m301 32 14 5v10c0 9-14 17-14 17s-14-8-14-17V37l14-5Z"
        stroke="#2E6250"
        strokeWidth="1.8"
      />
      <path
        d="m294 46 5 5 9-10"
        stroke="#2E6250"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M66 59v12m-6-6h12M346 88v8m-4-4h8"
        stroke="#A9C4B3"
        strokeOpacity=".6"
      />
    </svg>
  );
}

export default function App() {
  const [contracts, setContracts] = useState<Contract[]>(loadContracts);
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedId, setSelectedId] = useState("CT-001");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [storageWarn, setStorageWarn] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setStorageWarn(!saveContracts(contracts));
  }, [contracts]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const close = useCallback(() => setDialog(null), []);
  const navigate = (next: Page, id?: string) => {
    setPage(next);
    if (id) setSelectedId(id);
    setMobileOpen(false);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selected = contracts.find((c) => c.id === selectedId) || contracts[0];
  const overdue = contracts.filter((c) => isClaimable(c));
  const active = contracts.filter(
    (c) => contractStatus(c).label !== "Finalizado",
  );
  const filtered = useMemo(
    () =>
      contracts.filter((c) =>
        `${c.vehicle} ${c.plate} ${c.dealer}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [contracts, query],
  );
  function addContract(c: Contract) {
    setContracts((old) => [c, ...old]);
    setSelectedId(c.id);
    setDialog(null);
    navigate("contracts", c.id);
    setToast("Contrato creado. Ya puedes evaluar sus términos.");
  }
  function addMilestone(m: Milestone) {
    setContracts((old) =>
      old.map((c) =>
        c.id === dialog?.id ? { ...c, milestones: [...c.milestones, m] } : c,
      ),
    );
    setDialog(null);
    setToast("Hito guardado en la cronología.");
  }
  return (
    <div className="app-shell">
      {mobileOpen && (
        <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />
      )}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("dashboard")}
          aria-label="Consigna, ir al resumen"
        >
          <span className="brand-mark">
            <ShieldCheck size={24} strokeWidth={1.7} />
          </span>
          <span>
            consigna<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace-label">TU ESPACIO PERSONAL</div>
        <nav aria-label="Navegación principal">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "nav-active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "contracts" && (
                <span className="nav-count">{contracts.length}</span>
              )}
              {id === "claims" && overdue.length > 0 && (
                <span className="nav-alert" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon">
              <ShieldCheck size={20} />
            </div>
            <h3>Tu tranquilidad va primero</h3>
            <p>Un contrato claro es el primer paso para una venta segura.</p>
            <button onClick={() => setDialog({ type: "help" })}>
              Conoce cómo te ayudamos <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className="help-link"
            onClick={() => setDialog({ type: "help" })}
          >
            <HelpCircle size={18} /> Centro de ayuda
            <ArrowUpRight size={15} />
          </button>
          <div className="profile">
            <div className="avatar">CP</div>
            <div>
              <strong>Camila Pérez</strong>
              <span>Espacio de demostración</span>
            </div>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menú"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Mi espacio</span>
            <ChevronRight size={14} />
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={17} />
              <input
                ref={searchRef}
                aria-label="Buscar contratos"
                placeholder="Buscar un contrato..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </div>
            <span className="topbar-divider" />
            <button
              className="notification-button icon-button"
              aria-label={`Notificaciones: ${overdue.length} pendientes`}
              onClick={() => setDialog({ type: "notifications" })}
            >
              <Bell size={20} />
              {overdue.length > 0 && <i />}
            </button>
            <div className="avatar avatar-small">CP</div>
          </div>
        </header>
        <main>
          <div className="demo-label">
            <span />
            <span>Espacio de demostración</span>
            <span className="demo-label-detail">
              Tus datos se guardan solo en este navegador
            </span>
          </div>
          {storageWarn && (
            <div className="notice notice-warning">
              No se pudo guardar en el navegador. Mantén esta página abierta
              para conservar los cambios.
            </div>
          )}
          {query ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BUSCADOR</div>
                  <h1>Resultados de búsqueda</h1>
                  <p>
                    {filtered.length} contratos coinciden con «{query}».
                  </p>
                </div>
              </div>
              <ContractsTable
                contracts={filtered}
                onOpen={(id) => navigate("tracking", id)}
              />
            </>
          ) : (
            <>
              {page === "dashboard" && (
                <Dashboard
                  contracts={contracts}
                  active={active}
                  onNavigate={navigate}
                  onNew={() => setDialog({ type: "new" })}
                  onMilestone={(id) => setDialog({ type: "milestone", id })}
                />
              )}
              {page === "contracts" && (
                <ContractsPage
                  contracts={contracts}
                  onNew={() => setDialog({ type: "new" })}
                  onOpen={(id) => navigate("tracking", id)}
                  onEvaluate={(id) => navigate("evaluation", id)}
                />
              )}
              {page === "evaluation" && (
                <Evaluation
                  contracts={contracts}
                  selectedId={selected?.id}
                  onSelect={setSelectedId}
                  onNew={() => setDialog({ type: "new" })}
                />
              )}
              {page === "tracking" && (
                <Tracking
                  contracts={contracts}
                  selected={selected}
                  onSelect={setSelectedId}
                  onAdd={() =>
                    setDialog({ type: "milestone", id: selected?.id })
                  }
                  onClaim={() => navigate("claims", selected?.id)}
                  onNew={() => setDialog({ type: "new" })}
                  notify={setToast}
                />
              )}
              {page === "claims" && (
                <Claims
                  contracts={contracts}
                  selected={selected}
                  onSelect={setSelectedId}
                  onTrack={() => navigate("tracking")}
                  notify={setToast}
                />
              )}
              {page === "evidence" && (
                <EvidencePage
                  contracts={contracts}
                  notify={setToast}
                  onTrack={(id) => navigate("tracking", id)}
                />
              )}
            </>
          )}
          <footer className="main-footer">
            <span>© {new Date().getFullYear()} Consigna</span>
            <span>
              <ShieldCheck size={13} /> Tu vehículo, tus términos.
            </span>
            <button onClick={() => setDialog({ type: "help" })}>
              Ayuda y orientación
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {dialog?.type === "new" && (
        <NewContract close={close} onSave={addContract} />
      )}
      {dialog?.type === "milestone" && (
        <MilestoneForm
          contract={contracts.find((c) => c.id === dialog.id)!}
          close={close}
          onSave={addMilestone}
        />
      )}
      {dialog?.type === "notifications" && (
        <Modal
          title="Tus notificaciones"
          subtitle="Los pendientes que merecen tu atención."
          close={close}
        >
          <div className="notification-list">
            {overdue.length ? (
              overdue.map((c) => (
                <button
                  key={c.id}
                  className="notification-row"
                  onClick={() => {
                    close();
                    navigate("tracking", c.id);
                  }}
                >
                  <span className="notification-icon">
                    <CircleAlert size={21} />
                  </span>
                  <div>
                    <strong>{c.vehicle}: revisa el pago pendiente</strong>
                    <p>Saldo por recibir: {formatCLP(financial(c).balance)}</p>
                  </div>
                  <ChevronRight size={17} />
                </button>
              ))
            ) : (
              <Empty
                title="Todo al día"
                description="No tienes notificaciones pendientes."
              />
            )}
          </div>
          <div className="notice">
            Las alertas se muestran dentro de esta demostración. El envío de
            correos requiere conectar el backend y SMTP.
          </div>
        </Modal>
      )}
      {dialog?.type === "help" && (
        <Modal
          title="Te acompañamos en cada paso"
          subtitle="Más claridad para consignar tu vehículo."
          close={close}
        >
          <div className="help-steps">
            {[
              {
                icon: ShieldCheck,
                title: "1. Revisa antes de firmar",
                text: "Carga un contrato en texto o PDF y revisa los términos importantes. El análisis actual es una demostración basada en reglas.",
              },
              {
                icon: ListChecks,
                title: "2. Mantén el proceso a la vista",
                text: "Registra la entrega, la venta, los pagos y el traspaso. Confirma el pago completo antes de autorizar el traspaso.",
              },
              {
                icon: FileCheck2,
                title: "3. Prepara tu documentación",
                text: "Organiza la cronología y los comprobantes. Ante un incumplimiento, prepara un borrador para revisar y presentar tú mismo.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <span className="help-icon">
                  <Icon size={21} />
                </span>
                <section>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </section>
              </div>
            ))}
          </div>
          <div className="notice notice-warning">
            No envía reclamos ni ofrece asesoría jurídica. El calendario usa
            feriados de referencia; verifica los plazos aplicables con tu
            contrato. No ingreses datos sensibles en una demostración.
          </div>
          <Disclaimer />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button aria-label="Cerrar aviso" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Dashboard({
  contracts,
  active,
  onNavigate,
  onNew,
}: {
  contracts: Contract[];
  active: Contract[];
  onNavigate: (p: Page, id?: string) => void;
  onNew: () => void;
  onMilestone: (id: string) => void;
}) {
  const pending = active.filter(
    (c) => !!deadline(c) && financial(c).balance > 0,
  );
  const alerts = contracts.filter(isClaimable);
  const total = active.reduce((sum, c) => sum + c.price, 0);
  const metrics = [
    {
      label: "Consignaciones activas",
      value: String(active.length).padStart(2, "0"),
      description: "Vehículos en proceso",
      icon: CarFront,
      tone: "green",
    },
    {
      label: "Valor en consignación",
      value: formatCLP(total),
      description: "Precio de venta registrado",
      icon: Wallet,
      tone: "green",
    },
    {
      label: "Pagos por recibir",
      value: String(pending.length).padStart(2, "0"),
      description: "Mantén tus plazos a la vista",
      icon: CreditCard,
      tone: "amber",
    },
    {
      label: "Requieren tu atención",
      value: String(alerts.length).padStart(2, "0"),
      description: "Un pendiente por resolver",
      icon: Bell,
      tone: "amber",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TODO BAJO CONTROL</div>
          <h1>
            Tu tranquilidad, en un solo lugar
            <span className="heading-dot">.</span>
          </h1>
          <p>Revisa tus contratos y acompaña cada paso de tu consignación.</p>
        </div>
        <button className="button button-primary" onClick={onNew}>
          <Plus size={17} />
          Nuevo contrato
        </button>
      </div>
      <section className="welcome-banner">
        <div className="banner-content">
          <span className="banner-eyebrow">
            <span /> UN BUEN ACUERDO EMPIEZA CON CLARIDAD
          </span>
          <h2>
            Antes de entregar las llaves,
            <br />
            asegura tus condiciones.
          </h2>
          <p>
            Revisa tu contrato, identifica riesgos y toma decisiones informado.
          </p>
          <button
            className="button button-banner"
            onClick={() => onNavigate("evaluation")}
          >
            <ShieldCheck size={16} />
            Evaluar un contrato
            <ArrowUpRight size={16} />
          </button>
        </div>
        <CarIllustration />
        <span className="banner-number">01 — PREVENIR ES PROTEGER</span>
      </section>
      <section className="metrics-grid" aria-label="Resumen de consignaciones">
        {metrics.map(({ label, value, description, icon: Icon, tone }) => (
          <div className="metric-card" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <span className={`metric-icon metric-${tone}`}>
                <Icon size={18} strokeWidth={1.7} />
              </span>
            </div>
            <strong className={value.length > 9 ? "metric-money" : ""}>
              {value}
            </strong>
            <p>
              {label === "Requieren tu atención" && alerts.length > 0 ? (
                <>
                  <span className="tiny-dot" />
                  {alerts.length === 1
                    ? "Un pendiente por resolver"
                    : `${alerts.length} pendientes por resolver`}
                </>
              ) : (
                description
              )}
            </p>
          </div>
        ))}
      </section>
      <div className="dashboard-columns">
        <section className="panel contracts-panel">
          <SectionHead
            title="Tus consignaciones"
            subtitle="Cada vehículo, un proceso más claro."
            action={
              <TextLink onClick={() => onNavigate("contracts")}>
                Ver todos
              </TextLink>
            }
          />
          <ContractsTable
            contracts={active.slice(0, 3)}
            compact
            onOpen={(id) => onNavigate("tracking", id)}
          />
          <button className="panel-bottom-link" onClick={onNew}>
            <Plus size={15} />
            Agregar una consignación
          </button>
        </section>
        <section className="panel safe-card">
          <div className="safe-heading">
            <span className="safe-shield">
              <ShieldCheck size={21} />
            </span>
            <Badge tone="success" dot={false}>
              RECOMENDADO
            </Badge>
          </div>
          <h2>
            Primero el pago.
            <br />
            Después, el traspaso.
          </h2>
          <p>
            Protege lo que es tuyo siguiendo
            <br className="desktop-break" /> la secuencia segura.
          </p>
          <div className="safe-steps">
            <div>
              <span>
                <Check size={14} />
              </span>
              <p>Venta confirmada</p>
            </div>
            <div>
              <span>
                <Check size={14} />
              </span>
              <p>Pago completo recibido</p>
            </div>
            <div>
              <span className="last-step">3</span>
              <p>Firma del traspaso</p>
              <ShieldCheck size={15} />
            </div>
          </div>
          <button className="safe-link" onClick={() => onNavigate("tracking")}>
            Revisar mi seguimiento
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="dashboard-columns bottom-columns">
        <section className="panel reminders-panel">
          <SectionHead
            title="Lo que viene"
            action={
              <span className="subtle">
                <CalendarDays size={15} /> Tus próximos pasos
              </span>
            }
          />
          {pending.length ? (
            pending.slice(0, 2).map((c) => {
              const due = deadline(c)!;
              const late = due < todayISO();
              return (
                <div className="reminder" key={c.id}>
                  <div className={`date-tile ${late ? "date-late" : ""}`}>
                    <strong>{new Date(due + "T12:00:00").getDate()}</strong>
                    <span>
                      {new Date(due + "T12:00:00")
                        .toLocaleDateString("es-CL", { month: "short" })
                        .replace(".", "")
                        .toUpperCase()}
                    </span>
                  </div>
                  <div className="reminder-text">
                    <strong>
                      {late
                        ? "Pago pendiente de regularizar"
                        : "Fecha límite de pago"}
                    </strong>
                    <span>
                      {c.vehicle} <b>·</b> {c.dealer}
                    </span>
                  </div>
                  <Badge tone={late ? "danger" : "warning"}>
                    {late ? "Vencido" : "Por vencer"}
                  </Badge>
                  <button
                    className="icon-button"
                    aria-label={`Ver seguimiento de ${c.vehicle}`}
                    onClick={() => onNavigate("tracking", c.id)}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              );
            })
          ) : (
            <p className="panel-padding subtle">
              Sin pagos pendientes. Todo al día.
            </p>
          )}
        </section>
        <section className="guide-card">
          <div className="guide-title">
            <BookOpen size={19} />
            <span>UN POCO MÁS DE CLARIDAD</span>
          </div>
          <h3>
            ¿Qué revisar antes de firmar
            <br />
            un contrato de consignación?
          </h3>
          <p>
            Precio, comisiones y plazos. Conoce los
            <br className="desktop-break" /> términos que hacen la diferencia.
          </p>
          <button
            className="text-link"
            onClick={() => onNavigate("evaluation")}
          >
            Revisar los términos clave
            <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      <Disclaimer />
    </>
  );
}

function ContractsTable({
  contracts,
  onOpen,
  compact = false,
}: {
  contracts: Contract[];
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  if (!contracts.length)
    return (
      <Empty
        title="Aún no hay contratos aquí"
        description="Agrega un contrato o prueba con otra búsqueda."
      />
    );
  return (
    <div className={`table-wrap ${compact ? "table-compact" : ""}`}>
      <table>
        <thead>
          <tr>
            <th>VEHÍCULO / AUTOMOTORA</th>
            {!compact && <th>PRECIO DE VENTA</th>}
            <th>ESTADO</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {contracts.map((c, i) => {
            const status = contractStatus(c);
            return (
              <tr key={c.id}>
                <td>
                  <button className="vehicle-cell" onClick={() => onOpen(c.id)}>
                    <VehicleIcon index={i} />
                    <span>
                      <strong>
                        {c.vehicle}
                        <small>{c.plate}</small>
                      </strong>
                      <span>{c.dealer}</span>
                    </span>
                  </button>
                </td>
                {!compact && (
                  <td className="money-cell">{formatCLP(c.price)}</td>
                )}
                <td>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td>
                  <button
                    className="icon-button table-arrow"
                    aria-label={`Abrir ${c.vehicle}`}
                    onClick={() => onOpen(c.id)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContractsPage({
  contracts,
  onNew,
  onOpen,
  onEvaluate,
}: {
  contracts: Contract[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onEvaluate: (id: string) => void;
}) {
  const [filter, setFilter] = useState("Todos");
  const [search, setSearch] = useState("");
  const visible = contracts.filter(
    (c) =>
      (filter === "Todos" ||
        (filter === "Activos"
          ? contractStatus(c).label !== "Finalizado"
          : filter === "Finalizados"
            ? contractStatus(c).label === "Finalizado"
            : isClaimable(c))) &&
      `${c.vehicle} ${c.plate} ${c.dealer}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACUERDOS CON CLARIDAD</div>
          <h1>
            Mis contratos<span className="heading-dot">.</span>
          </h1>
          <p>Todos tus vehículos y acuerdos, en un mismo lugar.</p>
        </div>
        <button className="button button-primary" onClick={onNew}>
          <Plus size={17} />
          Nuevo contrato
        </button>
      </div>
      <section className="panel">
        <div className="table-toolbar">
          <div className="tabs">
            {["Todos", "Activos", "Con alertas", "Finalizados"].map((tab) => (
              <button
                className={filter === tab ? "tab-active" : ""}
                key={tab}
                onClick={() => setFilter(tab)}
              >
                {tab}
                {tab === "Todos" && <span>{contracts.length}</span>}
              </button>
            ))}
          </div>
          <div className="input-search">
            <Search size={16} />
            <input
              aria-label="Filtrar mis contratos"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar vehículo o automotora"
            />
          </div>
        </div>
        <ContractsTable contracts={visible} onOpen={onOpen} />
        <div className="table-footer">
          <span>
            {visible.length} de {contracts.length} contratos
          </span>
          <span>Página 1 de 1</span>
        </div>
      </section>
      <div className="inline-guide">
        <div className="inline-guide-icon">
          <ShieldCheck size={25} />
        </div>
        <div>
          <h3>¿Ya revisaste las condiciones de tu contrato?</h3>
          <p>
            Identifica los términos que podrían poner en riesgo tu consignación.
          </p>
        </div>
        <button
          className="button button-outline"
          onClick={() => (contracts[0] ? onEvaluate(contracts[0].id) : onNew())}
        >
          Evaluar contrato
          <ArrowUpRight size={16} />
        </button>
      </div>
      <Disclaimer />
    </>
  );
}

function ContractSelect({
  contracts,
  selected,
  onSelect,
}: {
  contracts: Contract[];
  selected?: Contract;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="contract-picker">
      <CarFront size={19} />
      <select
        aria-label="Seleccionar contrato"
        value={selected?.id || ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.vehicle} · {c.plate} — {c.dealer}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </div>
  );
}

function Tracking({
  contracts,
  selected: c,
  onSelect,
  onAdd,
  onClaim,
  onNew,
  notify,
}: {
  contracts: Contract[];
  selected?: Contract;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClaim: () => void;
  onNew: () => void;
  notify: (s: string) => void;
}) {
  if (!c)
    return (
      <Empty
        title="Cada paso cuenta"
        description="Agrega tu primer contrato para empezar el seguimiento."
        action={
          <button className="button button-primary" onClick={onNew}>
            <Plus size={16} />
            Nuevo contrato
          </button>
        }
      />
    );
  const balance = financial(c);
  const due = deadline(c);
  const status = contractStatus(c);
  const events = [...c.milestones].sort((a, b) => a.date.localeCompare(b.date));
  const paid = balance.balance <= 0;
  const unsafe = isUnsafe(c);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EL PROCESO, A LA VISTA</div>
          <h1>
            Seguimiento de consignación<span className="heading-dot">.</span>
          </h1>
          <p>Registra cada avance. Conserva lo que respalda tu acuerdo.</p>
        </div>
        <button className="button button-primary" onClick={onAdd}>
          <Plus size={17} />
          Registrar hito
        </button>
      </div>
      <ContractSelect contracts={contracts} selected={c} onSelect={onSelect} />
      {(isClaimable(c) || unsafe) && (
        <div className="notice notice-danger">
          <CircleAlert size={20} />
          <div>
            <strong>
              {unsafe
                ? "Se registró un traspaso antes de completar el pago."
                : "El plazo de pago ha vencido."}
            </strong>
            <p>
              Revisa el saldo pendiente y reúne tus antecedentes para el
              siguiente paso.
            </p>
          </div>
          <button onClick={onClaim}>
            Preparar informe
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="tracking-layout">
        <div>
          <section className="panel vehicle-summary">
            <div className="vehicle-summary-title">
              <VehicleIcon />
              <div>
                <span className="eyebrow">{c.id}</span>
                <h2>
                  {c.vehicle} <span>{c.plate}</span>
                </h2>
                <p>{c.dealer}</p>
              </div>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            {c.original && (
              <button
                className="evidence-chip"
                onClick={() =>
                  downloadEvidence(c.original!.id, c.original!.name).catch(
                    (e) => notify(e.message),
                  )
                }
              >
                <FileText size={14} />
                {c.original.name}
                <Download size={13} />
              </button>
            )}
            <div className="summary-details">
              <div>
                <span>Precio de venta</span>
                <strong>{formatCLP(c.price)}</strong>
              </div>
              <div>
                <span>Comisión ({c.commission}%)</span>
                <strong>{formatCLP(balance.commission)}</strong>
              </div>
              <div>
                <span>Neto a recibir</span>
                <strong>{formatCLP(balance.netAmount)}</strong>
              </div>
            </div>
          </section>
          <section className="panel timeline-panel">
            <SectionHead
              title="La historia de tu consignación"
              subtitle="Hitos y comprobantes, en orden cronológico."
              action={<Badge dot={false}>{events.length} hitos</Badge>}
            />
            <div className="timeline">
              {events.length ? (
                events.map((m) => {
                  const Icon = {
                    entrega: CarFront,
                    venta: FileCheck2,
                    pago: CreditCard,
                    traspaso: CheckCheck,
                  }[m.type];
                  return (
                    <div className="timeline-event" key={m.id}>
                      <span
                        className={`timeline-icon ${m.type === "pago" ? "timeline-paid" : ""}`}
                      >
                        <Icon size={19} />
                      </span>
                      <div className="timeline-content">
                        <span className="timeline-date">
                          {formatDate(m.date)}
                        </span>
                        <h3>
                          {milestoneNames[m.type]}
                          {m.amount !== undefined && (
                            <strong>{formatCLP(m.amount)}</strong>
                          )}
                        </h3>
                        <p>{m.note || "Sin observaciones adicionales."}</p>
                        {m.evidence && (
                          <button
                            className="evidence-chip"
                            onClick={() =>
                              downloadEvidence(
                                m.evidence!.id,
                                m.evidence!.name,
                              ).catch((e) => notify(e.message))
                            }
                          >
                            <FileText size={14} />
                            {m.evidence.name}
                            <Download size={13} />
                          </button>
                        )}
                        {m.type === "traspaso" && unsafe && (
                          <span className="timeline-warning">
                            <CircleAlert size={14} />
                            Traspaso registrado sin pago completo.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <Empty
                  title="Comienza tu cronología"
                  description="Registra la entrega del vehículo para iniciar el seguimiento."
                />
              )}
              <button className="timeline-add" onClick={onAdd}>
                <span>
                  <Plus size={17} />
                </span>
                Registrar un nuevo hito
              </button>
            </div>
          </section>
        </div>
        <aside className="tracking-aside">
          <section className="panel payment-card">
            <span className="eyebrow">TU PAGO</span>
            <span className="payment-icon">
              <Wallet size={23} />
            </span>
            <p>Saldo por recibir</p>
            <h2>{formatCLP(balance.balance)}</h2>
            <div className="payment-progress">
              <span
                style={{
                  width: `${Math.min(100, (balance.totalPaid / Math.max(balance.netAmount, 1)) * 100)}%`,
                }}
              />
            </div>
            <div className="payment-progress-label">
              <span>Recibido: {formatCLP(balance.totalPaid)}</span>
              <strong>
                {Math.min(
                  100,
                  Math.round(
                    (balance.totalPaid / Math.max(balance.netAmount, 1)) * 100,
                  ),
                )}
                %
              </strong>
            </div>
            <div className="payment-deadline">
              <CalendarDays size={19} />
              <div>
                <span>{due ? "Fecha límite de pago" : "Plazo pactado"}</span>
                <strong>
                  {due
                    ? formatDate(due)
                    : `${c.paymentDays} días hábiles desde la venta`}
                </strong>
              </div>
            </div>
            <small>
              Se excluyen fines de semana y feriados de referencia de Chile.
              Verifica el plazo con tu contrato.
            </small>
          </section>
          <section className="safe-mini">
            <ShieldCheck size={23} />
            <h3>
              {paid
                ? "Pago completo confirmado"
                : "Protege la secuencia segura"}
            </h3>
            <p>
              {paid
                ? "Ya registraste el monto neto completo. Conserva el comprobante antes de continuar con el traspaso."
                : "Confirma el pago completo antes de firmar el traspaso. Un pago parcial no completa esta etapa."}
            </p>
          </section>
        </aside>
      </div>
      <Disclaimer />
    </>
  );
}

function Evaluation({
  contracts,
  selectedId,
  onSelect,
}: {
  contracts: Contract[];
  selectedId?: string;
  onSelect: (s: string) => void;
  onNew: () => void;
}) {
  const current = contracts.find((c) => c.id === selectedId);
  const [text, setText] = useState(current?.text || "");
  const [results, setResults] = useState<RiskAssessment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [openRisk, setOpenRisk] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(current?.text || "");
    setResults(null);
    setFileName("");
    setError("");
  }, [current?.id]);
  async function load(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const content = await readContractFile(file);
      setText(content);
      setFileName(file.name);
      setResults(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function evaluate() {
    setError("");
    if (text.trim().length < 40) {
      setError(
        "Ingresa al menos 40 caracteres para revisar los términos del contrato.",
      );
      return;
    }
    setResults(assessContractText(text));
    setOpenRisk(null);
  }
  const counts = results
    ? {
        alto: results.filter((r) => r.level === "alto").length,
        medio: results.filter((r) => r.level === "medio").length,
        bajo: results.filter((r) => r.level === "bajo").length,
      }
    : null;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ANTES DE FIRMAR</div>
          <h1>
            Un contrato más claro<span className="heading-dot">.</span>
          </h1>
          <p>
            Conoce tus condiciones. Identifica los términos que merecen una
            segunda mirada.
          </p>
        </div>
        <span className="pill">
          <Sparkles size={15} />
          Evaluación demostrativa
        </span>
      </div>
      <div className="notice">
        <ShieldCheck size={19} />
        <p>
          Esta demostración aplica reglas de referencia. No utiliza una API de
          IA ni valida la normativa vigente. Los resultados requieren revisión.
        </p>
      </div>
      <div className="evaluation-layout">
        <section className="panel evaluation-input">
          <SectionHead
            title="Tu contrato"
            subtitle="Carga un archivo o pega los términos del acuerdo."
          />
          {contracts.length > 0 && (
            <div className="evaluation-picker">
              <label>Usar un contrato registrado</label>
              <ContractSelect
                contracts={contracts}
                selected={current}
                onSelect={onSelect}
              />
            </div>
          )}
          <input
            ref={inputRef}
            hidden
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            onChange={(e) => {
              void load(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            className={`upload-zone ${dragging ? "upload-dragging" : ""}`}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void load(e.dataTransfer.files[0]);
            }}
          >
            <span className="upload-icon">
              {busy ? (
                <LoaderCircle size={24} className="spin" />
              ) : (
                <Upload size={24} />
              )}
            </span>
            <strong>
              {busy
                ? "Extrayendo texto…"
                : fileName || "Haz clic o arrastra tu contrato"}
            </strong>
            <span>PDF con texto seleccionable o TXT · Hasta 10 MB</span>
          </button>
          <div className="or-divider">
            <span />O PEGA EL TEXTO
            <span />
          </div>
          <label className="field-label" htmlFor="contract-text">
            Términos del contrato
          </label>
          <textarea
            id="contract-text"
            className="contract-text"
            value={text}
            maxLength={100000}
            onChange={(e) => {
              setText(e.target.value);
              setResults(null);
            }}
            placeholder="Precio mínimo, comisión, plazo de pago, condiciones de rebaja, traspaso y penalidades…"
          />
          <div className="text-count">
            {text.length.toLocaleString("es-CL")} / 100.000 caracteres
          </div>
          {error && (
            <div className="field-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button button-primary button-full"
            disabled={busy}
            onClick={evaluate}
          >
            <ShieldCheck size={17} />
            Evaluar términos
            <ArrowRight size={17} />
          </button>
          <span className="input-footnote">
            <Shield size={13} />
            El archivo se procesa en tu navegador.
          </span>
        </section>
        <div className="evaluation-output">
          {results && counts ? (
            <>
              <div className="result-heading">
                <div>
                  <span className="eyebrow">RESULTADO DE REFERENCIA</span>
                  <h2>Estos son los puntos a revisar</h2>
                </div>
                <span>{results.length} términos evaluados</span>
              </div>
              <div className="risk-summary">
                <div>
                  <strong>{counts.alto}</strong>
                  <span>
                    <i className="risk-dot risk-alto" />
                    Riesgo alto
                  </span>
                </div>
                <div>
                  <strong>{counts.medio}</strong>
                  <span>
                    <i className="risk-dot risk-medio" />
                    Riesgo medio
                  </span>
                </div>
                <div>
                  <strong>{counts.bajo}</strong>
                  <span>
                    <i className="risk-dot risk-bajo" />
                    Riesgo bajo
                  </span>
                </div>
              </div>
              <div className="risk-list">
                {results.map((r) => (
                  <section
                    className={`risk-card ${openRisk === r.id ? "risk-open" : ""}`}
                    key={r.id}
                  >
                    <button
                      className="risk-toggle"
                      onClick={() =>
                        setOpenRisk(openRisk === r.id ? null : r.id)
                      }
                      aria-expanded={openRisk === r.id}
                    >
                      <span className={`risk-symbol risk-symbol-${r.level}`}>
                        {r.level === "bajo" ? (
                          <Check size={17} />
                        ) : (
                          <CircleAlert size={17} />
                        )}
                      </span>
                      <span>
                        <strong>{r.title}</strong>
                        {r.omitted && <small>Término no encontrado</small>}
                      </span>
                      <Badge
                        tone={
                          { alto: "danger", medio: "warning", bajo: "success" }[
                            r.level
                          ]
                        }
                      >
                        Riesgo {r.level}
                      </Badge>
                      <ChevronDown size={17} />
                    </button>
                    {openRisk === r.id && (
                      <div className="risk-explanation">
                        <p>{r.explanation}</p>
                        <div className="alternative">
                          <span>
                            <FileCheck2 size={15} />
                            Redacción sugerida
                          </span>
                          <p>{r.alternative}</p>
                        </div>
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <p className="subtle evaluation-note">
                El umbral de 15 días hábiles es un criterio de esta
                demostración, no un máximo legal. Una omisión requiere revisión
                expresa del contrato.
              </p>
            </>
          ) : (
            <section className="evaluation-placeholder">
              <div className="evaluation-graphic">
                <FileText size={45} strokeWidth={1} />
                <span>
                  <ShieldCheck size={25} />
                </span>
              </div>
              <span className="eyebrow">MÁS CLARIDAD, MEJORES DECISIONES</span>
              <h2>Los detalles importan.</h2>
              <p>
                Revisaremos siete términos para ayudarte
                <br />a entender qué estás acordando.
              </p>
              <div className="terms-grid">
                {[
                  "Precio mínimo",
                  "Comisión",
                  "Plazo de pago",
                  "Forma de pago",
                  "Rebajas de precio",
                  "Firma del traspaso",
                  "Penalidades",
                ].map((t) => (
                  <span key={t}>
                    <CheckCircle2 size={14} />
                    {t}
                  </span>
                ))}
              </div>
              <div className="evaluation-placeholder-bottom">
                <span className="risk-dot risk-bajo" /> Bajo
                <span className="risk-dot risk-medio" /> Medio
                <span className="risk-dot risk-alto" /> Alto
              </div>
            </section>
          )}
        </div>
      </div>
      <Disclaimer />
    </>
  );
}

function Claims({
  contracts,
  selected: c,
  onSelect,
  onTrack,
  notify,
}: {
  contracts: Contract[];
  selected?: Contract;
  onSelect: (s: string) => void;
  onTrack: () => void;
  notify: (s: string) => void;
}) {
  const [generated, setGenerated] = useState(false);
  const [audience, setAudience] = useState("automotora");
  useEffect(() => setGenerated(false), [c?.id]);
  if (!c)
    return (
      <Empty
        title="Sin antecedentes todavía"
        description="Primero agrega un contrato y registra sus hitos."
      />
    );
  const balance = financial(c);
  const eligible = isClaimable(c);
  const due = deadline(c);
  const events = [...c.milestones].sort((a, b) => a.date.localeCompare(b.date));
  const body = `${audience === "automotora" ? `A ${c.dealer}` : "Al Servicio Nacional del Consumidor (SERNAC)"}:\n\nPor medio de este documento, dejo constancia de los antecedentes relacionados con la consignación de mi vehículo ${c.vehicle}, patente ${c.plate}, registrada con ${c.dealer}.\n\nEl precio de venta registrado es ${formatCLP(c.price)}, con una comisión de ${c.commission}% (${formatCLP(balance.commission)}), lo que corresponde a un monto neto de ${formatCLP(balance.netAmount)}. A la fecha, los pagos registrados suman ${formatCLP(balance.totalPaid)}, con un saldo pendiente de ${formatCLP(balance.balance)}.${due ? ` La fecha de vencimiento de referencia es ${formatDate(due)}.` : ""}\n\n${isUnsafe(c) ? "En la cronología se registra un traspaso previo al pago completo. Solicito aclarar esta situación y entregar los comprobantes correspondientes.\n\n" : ""}Solicito informar por escrito el estado de la operación y, si corresponde, regularizar el saldo pendiente mediante el medio de pago acordado.\n\nAdjunto la cronología y las referencias a los comprobantes disponibles. Solicito una respuesta por escrito a este requerimiento.\n\nNombre del propietario: ____________________\nFecha: ${formatDate(todayISO())}\nDatos de contacto: ____________________`;
  async function exportPDF() {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      let y = 22;
      const write = (text: string, size = 10) => {
        doc.setFontSize(size);
        for (const line of doc.splitTextToSize(text, 170)) {
          if (y > 275) {
            doc.addPage();
            y = 22;
          }
          doc.text(line, 20, y);
          y += size * 0.52;
        }
        y += 5;
      };
      write("CONSIGNA | Informe y borrador de reclamo", 17);
      write("BORRADOR PARA REVISIÓN. No presentado ni enviado.", 10);
      write(`${c!.vehicle} | ${c!.plate} | ${c!.dealer}`, 12);
      write("CRONOLOGÍA", 12);
      events.forEach((m) =>
        write(
          `${formatDate(m.date)} - ${milestoneNames[m.type]}${m.amount ? ` - ${formatCLP(m.amount)}` : ""}\n${m.note}${m.evidence ? `\nComprobante: ${m.evidence.name}` : ""}`,
        ),
      );
      write("BORRADOR DE RECLAMO", 12);
      write(body);
      write(
        "Documento de demostración. No valida fundamentos normativos ni sustituye asesoría jurídica. Verificar el calendario y adjuntar los comprobantes antes de presentar.",
        9,
      );
      doc.save(`consigna-informe-${c!.id}.pdf`);
      notify("PDF descargado. Revísalo antes de presentarlo.");
    } catch {
      notify("No se pudo generar el PDF. Intenta nuevamente.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ANTECEDENTES PARA ACTUAR</div>
          <h1>
            Informes y reclamos<span className="heading-dot">.</span>
          </h1>
          <p>
            Tu historia ordenada, tu petición más clara. Tú decides el siguiente
            paso.
          </p>
        </div>
      </div>
      <ContractSelect contracts={contracts} selected={c} onSelect={onSelect} />
      {!eligible ? (
        <section className="panel no-claim">
          <span>
            <ShieldCheck size={38} strokeWidth={1.5} />
          </span>
          <h2>No se detecta un incumplimiento reclamable</h2>
          <p>
            {balance.balance === 0
              ? "El pago registrado está completo y no se detecta un traspaso anterior al pago."
              : "El plazo de pago aún no vence o la venta no se ha registrado. Puedes seguir agregando hitos y comprobantes."}
          </p>
          <button className="button button-outline" onClick={onTrack}>
            Ver seguimiento
            <ArrowRight size={16} />
          </button>
        </section>
      ) : (
        <div className="claims-layout">
          <section className="panel claim-summary">
            <SectionHead
              title="Resumen de antecedentes"
              subtitle="Calculado a partir de los hitos que registraste."
            />
            <div className="claim-alert">
              <CircleAlert size={19} />
              {isUnsafe(c)
                ? "Traspaso sin pago completo"
                : "Plazo de pago vencido"}
            </div>
            <div className="claim-amount">
              <span>Saldo pendiente</span>
              <strong>{formatCLP(balance.balance)}</strong>
            </div>
            <dl className="amount-breakdown">
              <div>
                <dt>Precio de venta</dt>
                <dd>{formatCLP(c.price)}</dd>
              </div>
              <div>
                <dt>Comisión ({c.commission}%)</dt>
                <dd>− {formatCLP(balance.commission)}</dd>
              </div>
              <div>
                <dt>Pagos recibidos</dt>
                <dd>− {formatCLP(balance.totalPaid)}</dd>
              </div>
              <div>
                <dt>Saldo adeudado</dt>
                <dd>{formatCLP(balance.balance)}</dd>
              </div>
            </dl>
            <div className="claim-facts">
              <span>
                <CalendarDays size={16} />
                Vencimiento: {due ? formatDate(due) : "No registrado"}
              </span>
              <span>
                <ListChecks size={16} />
                {events.length} hitos en la cronología
              </span>
              <span>
                <FolderOpen size={16} />
                {events.filter((e) => e.evidence).length} comprobantes adjuntos
              </span>
            </div>
            <div className="notice">
              Los montos se calculan en código. Revisa que el precio registrado
              corresponda al precio efectivo de venta.
            </div>
          </section>
          <section className="panel claim-editor">
            <SectionHead
              title="Prepara tu borrador"
              subtitle="Organiza los hechos y revisa tu solicitud."
            />
            <label className="field-label" htmlFor="claim-recipient">
              Dirigido a
            </label>
            <div className="recipient-tabs" id="claim-recipient">
              {[
                { id: "automotora", label: "La automotora", icon: CarFront },
                { id: "sernac", label: "SERNAC", icon: Shield },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  className={audience === id ? "recipient-active" : ""}
                  onClick={() => setAudience(id)}
                  key={id}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            {generated ? (
              <>
                <div className="draft-paper">
                  <span className="draft-tag">BORRADOR · NO PRESENTADO</span>
                  <h3>Solicitud de regularización de pago</h3>
                  <p>{body}</p>
                </div>
                <div className="notice notice-warning">
                  Revisa los hechos y agrega tus datos. Este borrador no
                  contiene fundamentos jurídicos validados. Adjunta los
                  comprobantes antes de presentarlo.
                </div>
                <button
                  className="button button-primary button-full"
                  onClick={() => void exportPDF()}
                >
                  <ArrowDownToLine size={17} />
                  Descargar informe y borrador PDF
                </button>
              </>
            ) : (
              <div className="draft-placeholder">
                <FilePlus2 size={44} strokeWidth={1} />
                <h3>Los hechos, en orden.</h3>
                <p>
                  El borrador incluirá tu cronología, los montos registrados y
                  una solicitud concreta.
                </p>
                <button
                  className="button button-primary"
                  onClick={() => setGenerated(true)}
                >
                  <FileText size={16} />
                  Generar borrador
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      <Disclaimer />
    </>
  );
}

function EvidencePage({
  contracts,
  notify,
  onTrack,
}: {
  contracts: Contract[];
  notify: (s: string) => void;
  onTrack: (s: string) => void;
}) {
  const files = contracts.flatMap((c) => [
    ...(c.original
      ? [
          {
            ...c.original,
            vehicle: c.vehicle,
            contractId: c.id,
            type: "contrato",
          },
        ]
      : []),
    ...c.milestones
      .filter((m) => m.evidence)
      .map((m) => ({
        ...m.evidence!,
        vehicle: c.vehicle,
        contractId: c.id,
        type: m.type,
      })),
  ]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TODO LO QUE RESPALDA TU ACUERDO</div>
          <h1>
            Mis documentos<span className="heading-dot">.</span>
          </h1>
          <p>
            Los comprobantes que adjuntas a tus hitos, organizados y
            disponibles.
          </p>
        </div>
        <Badge dot={false}>{files.length} documentos</Badge>
      </div>
      <section className="panel">
        {files.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DOCUMENTO</th>
                  <th>CONTRATO</th>
                  <th>FECHA</th>
                  <th>DESCARGAR</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div className="document-cell">
                        <span>
                          <FileText size={21} />
                        </span>
                        <div>
                          <strong>{f.name}</strong>
                          <small>
                            {(f.size / 1024).toFixed(0)} KB ·{" "}
                            {f.type === "contrato"
                              ? "Contrato original"
                              : milestoneNames[f.type as MilestoneType]}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => onTrack(f.contractId)}
                      >
                        {f.vehicle}
                        <ArrowUpRight size={14} />
                      </button>
                    </td>
                    <td>{formatDate(f.date)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Descargar ${f.name}`}
                        onClick={() =>
                          downloadEvidence(f.id, f.name).catch((e) =>
                            notify(e.message),
                          )
                        }
                      >
                        <Download size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Un respaldo para cada paso"
            description="Adjunta contratos y comprobantes al registrar un hito. Aquí podrás verlos y descargarlos."
            action={
              <button
                className="button button-primary"
                onClick={() => onTrack(contracts[0]?.id || "")}
              >
                <Plus size={16} />
                Ir al seguimiento
              </button>
            }
          />
        )}
      </section>
      <div className="notice">
        <FolderOpen size={18} />
        <p>
          Los archivos se guardan en este navegador. Al borrar sus datos también
          se eliminarán los documentos. Para compartirlos entre dispositivos se
          necesita el almacén de evidencias del backend.
        </p>
      </div>
      <Disclaimer />
    </>
  );
}

function NewContract({
  close,
  onSave,
}: {
  close: () => void;
  onSave: (c: Contract) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  async function handleFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setText(await readContractFile(file));
      setEvidence(file);
      setFileName(file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    const price = Number(data.get("price")),
      commission = Number(data.get("commission")),
      days = Number(data.get("days"));
    if (
      !Number.isSafeInteger(price) ||
      price <= 0 ||
      commission < 0 ||
      commission > 100 ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 60
    ) {
      setError(
        "Revisa los montos y el plazo: usa pesos enteros, comisión entre 0 y 100% y de 1 a 60 días hábiles.",
      );
      return;
    }
    setBusy(true);
    try {
      const c: Contract = {
        id: `CT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        vehicle: String(data.get("vehicle")).trim(),
        plate: String(data.get("plate")).trim().toUpperCase(),
        dealer: String(data.get("dealer")).trim(),
        price,
        commission,
        paymentDays: days,
        createdAt: todayISO(),
        text,
        milestones: [],
      };
      if (!c.vehicle || !c.dealer || !c.plate) {
        setError("Completa el vehículo, la patente y la automotora.");
        return;
      }
      if (evidence) {
        const id = await storeEvidenceFile(evidence);
        c.original = {
          id,
          name: evidence.name,
          size: evidence.size,
          date: todayISO(),
        };
      }
      onSave(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Una nueva consignación"
      subtitle="Comienza con los datos de tu vehículo y el acuerdo."
      close={close}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-section-label">EL VEHÍCULO Y LA AUTOMOTORA</div>
        <div className="form-grid">
          <label>
            Marca y modelo
            <input
              name="vehicle"
              required
              maxLength={80}
              placeholder="Ej. Toyota Corolla 2021"
            />
          </label>
          <label>
            Patente
            <input
              name="plate"
              required
              maxLength={10}
              placeholder="Ej. AB-CD-12"
            />
          </label>
          <label className="full-field">
            Automotora
            <input
              name="dealer"
              required
              maxLength={100}
              placeholder="Nombre de la automotora"
            />
          </label>
        </div>
        <div className="form-section-label">LAS CONDICIONES DEL ACUERDO</div>
        <div className="form-grid form-three">
          <label>
            Precio de venta (CLP)
            <input
              name="price"
              type="number"
              min="1"
              max="999999999999"
              step="1"
              required
              placeholder="12900000"
            />
          </label>
          <label>
            Comisión (%)
            <input
              name="commission"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue="5"
              required
            />
          </label>
          <label>
            Pago (días hábiles)
            <input
              name="days"
              type="number"
              min="1"
              max="60"
              step="1"
              defaultValue="15"
              required
            />
          </label>
        </div>
        <label className="field-label" htmlFor="new-contract-file">
          Contrato original <span className="optional">opcional</span>
        </label>
        <label className="file-input-label" htmlFor="new-contract-file">
          <Upload size={19} />
          <div>
            <strong>{fileName || "Adjuntar un archivo PDF o TXT"}</strong>
            <span>Texto seleccionable · Máximo 10 MB</span>
          </div>
          <input
            id="new-contract-file"
            type="file"
            accept=".pdf,.txt"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
        <label className="field-label" htmlFor="new-contract-text">
          Texto del contrato <span className="optional">opcional</span>
        </label>
        <textarea
          id="new-contract-text"
          rows={3}
          maxLength={100000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Puedes pegar aquí las condiciones para evaluarlas más adelante."
        />
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={close}
          >
            Cancelar
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}
            Crear contrato
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MilestoneForm({
  contract: c,
  close,
  onSave,
}: {
  contract: Contract;
  close: () => void;
  onSave: (m: Milestone) => void;
}) {
  const [type, setType] = useState<MilestoneType>("pago");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayISO());
  const balance = financial(c);
  const unsafe =
    type === "traspaso" &&
    calculateBalance(
      c.price,
      c.commission,
      c.milestones
        .filter((m) => m.type === "pago" && m.date <= date)
        .map((m) => m.amount || 0),
    ).balance > 0;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    const amount = type === "pago" ? Number(data.get("amount")) : undefined;
    if (date > todayISO()) {
      setError(
        "Los hitos deben corresponder a hechos ocurridos, no a fechas futuras.",
      );
      return;
    }
    if (
      type !== "entrega" &&
      !c.milestones.some((m) => m.type === "entrega" && m.date <= date)
    ) {
      setError(
        "Registra primero la entrega del vehículo con una fecha anterior o igual a este hito.",
      );
      return;
    }
    if (
      (type === "pago" || type === "traspaso") &&
      !c.milestones.some((m) => m.type === "venta" && m.date <= date)
    ) {
      setError("Registra primero la venta informada para esa fecha.");
      return;
    }
    if (type !== "pago" && c.milestones.some((m) => m.type === type)) {
      setError("Este hito ya está registrado en el contrato.");
      return;
    }
    if (type === "venta") {
      try {
        addBusinessDays(date, c.paymentDays);
      } catch {
        setError(
          "El calendario de demostración cubre plazos dentro de 2026–2027. Selecciona una fecha compatible.",
        );
        return;
      }
    }
    if (
      type === "pago" &&
      (!amount || !Number.isSafeInteger(amount) || amount < 1)
    ) {
      setError("Ingresa un pago válido en pesos enteros.");
      return;
    }
    if (type === "pago" && amount! > balance.balance) {
      setError(
        `El pago supera el saldo pendiente de ${formatCLP(balance.balance)}.`,
      );
      return;
    }
    if (unsafe && !data.get("confirm")) {
      setError(
        "Confirma que quieres registrar el hecho ocurrido pese a la advertencia.",
      );
      return;
    }
    setBusy(true);
    try {
      let evidence: Milestone["evidence"];
      if (file) {
        const id = await storeEvidenceFile(file);
        evidence = { id, name: file.name, size: file.size, date };
      }
      onSave({
        id: crypto.randomUUID(),
        type,
        date,
        note: String(data.get("note")).trim(),
        amount,
        evidence,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Registra un nuevo hito"
      subtitle={`${c.vehicle} · ${c.dealer}`}
      close={close}
    >
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="milestone-type">
          ¿Qué ocurrió?
        </label>
        <select
          id="milestone-type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as MilestoneType);
            setError("");
          }}
        >
          {Object.entries(milestoneNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="form-grid">
          <label>
            Fecha del hito
            <input
              type="date"
              name="date"
              required
              value={date}
              max={todayISO()}
              min="2026-01-01"
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {type === "pago" && (
            <label>
              Monto recibido (CLP)
              <input
                name="amount"
                type="number"
                min="1"
                max={balance.balance}
                step="1"
                required
                placeholder="Ej. 3000000"
              />
            </label>
          )}
        </div>
        {type === "pago" && (
          <p className="field-hint">
            Saldo actual: {formatCLP(balance.balance)}. Un abono parcial no
            confirma el pago completo.
          </p>
        )}
        {unsafe && (
          <div className="notice notice-danger transfer-warning">
            <ShieldCheck size={21} />
            <div>
              <strong>Primero el pago, después el traspaso.</strong>
              <p>
                Para la fecha indicada, el pago no está completo. Registrar este
                hecho no autoriza ni ejecuta un traspaso.
              </p>
              <label className="checkbox-label">
                <input type="checkbox" name="confirm" required />
                El traspaso ya ocurrió y quiero dejar constancia.
              </label>
            </div>
          </div>
        )}
        <label className="field-label" htmlFor="milestone-note">
          Observaciones <span className="optional">opcional</span>
        </label>
        <textarea
          id="milestone-note"
          name="note"
          rows={3}
          maxLength={2000}
          placeholder="Agrega información que ayude a respaldar lo ocurrido."
        />
        <label className="field-label" htmlFor="milestone-file">
          Comprobante <span className="optional">opcional</span>
        </label>
        <label className="file-input-label" htmlFor="milestone-file">
          <Upload size={19} />
          <div>
            <strong>{file?.name || "Adjuntar comprobante"}</strong>
            <span>PDF, imagen o TXT · Máximo 10 MB</span>
          </div>
          <input
            id="milestone-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.txt"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setError("");
            }}
          />
        </label>
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={close}
          >
            Cancelar
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            Guardar hito
          </button>
        </div>
      </form>
    </Modal>
  );
}
