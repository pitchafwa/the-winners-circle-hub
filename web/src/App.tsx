import { Route, Routes } from "react-router-dom";
import { AppProvider } from "./state/AppContext";
import Layout from "./components/Layout";
import LeaguePage from "./pages/LeaguePage";
import MyTeamPage from "./pages/MyTeamPage";
import MatchupsPage from "./pages/MatchupsPage";
import HistoryPage from "./pages/HistoryPage";
import TrophyCasePage from "./pages/TrophyCasePage";
import TradeAdminPage from "./pages/TradeAdminPage";
import DraftAdminPage from "./pages/DraftAdminPage";
import WeeklySummaryAdminPage from "./pages/WeeklySummaryAdminPage";

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LeaguePage />} />
          <Route path="team" element={<MyTeamPage />} />
          <Route path="matchups" element={<MatchupsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="trophies" element={<TrophyCasePage />} />
          <Route path="admin/trades" element={<TradeAdminPage />} />
          <Route path="admin/drafts" element={<DraftAdminPage />} />
          <Route path="admin/weekly-summary" element={<WeeklySummaryAdminPage />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
