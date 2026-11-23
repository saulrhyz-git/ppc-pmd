import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type { TabKey } from "@pmd/shared";
import { useAuth } from "./auth";
import Layout from "./Layout";
import Login from "./pages/Login";
import Portal from "./pages/Portal";
import NeedsFocus from "./pages/NeedsFocus";
import Overview from "./pages/Overview";
import ConcernsWO from "./pages/ConcernsWO";
import Breakdowns from "./pages/Breakdowns";
import Financial from "./pages/Financial";
import Projects from "./pages/Projects";
import Preventive from "./pages/Preventive";
import Permits from "./pages/Permits";
import Contracts from "./pages/Contracts";
import Safety from "./pages/Safety";
import DataEntry from "./pages/DataEntry";
import Settings from "./pages/Settings";
import WorkOrders from "./pages/WorkOrders";
import { TAB_PATH } from "./Layout";
import { TABS } from "@pmd/shared";

function Guard({ tab, children }: { tab: TabKey; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || (user.tabs[tab] ?? 0) < 1) return <div className="card"><h2>No access</h2><p className="mu">Your account does not have access to this screen. Ask the Department Head if you need it.</p></div>;
  return <>{children}</>;
}

/** Users without the Needs Focus screen (e.g. technicians) start on their first screen. */
function Home() {
  const { user } = useAuth();
  const first = TABS.find(([k]) => k !== "brief" && (user?.tabs[k] ?? 0) >= 1);
  return first ? <Navigate to={TAB_PATH[first[0]]} replace /> : <Guard tab="brief"><NeedsFocus /></Guard>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Login />;
  if (user.role === "Tenant") return <Routes><Route path="*" element={<Portal />} /></Routes>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={(user.tabs.brief ?? 0) >= 1 ? <NeedsFocus /> : <Home />} />
        <Route path="work-orders" element={<Guard tab="wos"><WorkOrders /></Guard>} />
        <Route path="overview" element={<Guard tab="ov"><Overview /></Guard>} />
        <Route path="concerns" element={<Guard tab="wo"><ConcernsWO /></Guard>} />
        <Route path="breakdowns" element={<Guard tab="as"><Breakdowns /></Guard>} />
        <Route path="financial" element={<Guard tab="bud"><Financial /></Guard>} />
        <Route path="projects" element={<Guard tab="pjm"><Projects /></Guard>} />
        <Route path="preventive" element={<Guard tab="pm"><Preventive /></Guard>} />
        <Route path="permits" element={<Guard tab="per"><Permits /></Guard>} />
        <Route path="contracts" element={<Guard tab="ct"><Contracts /></Guard>} />
        <Route path="safety" element={<Guard tab="sf"><Safety /></Guard>} />
        <Route path="data" element={<Guard tab="data"><DataEntry /></Guard>} />
        <Route path="settings" element={<Guard tab="set"><Settings /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
