import { Route, Routes } from "react-router-dom";
import { AppProvider } from "./state/AppContext";
import Layout from "./components/Layout";
import LeaguePage from "./pages/LeaguePage";
import MyTeamPage from "./pages/MyTeamPage";
import MatchupsPage from "./pages/MatchupsPage";
import HistoryStandingsPage from "./pages/HistoryStandingsPage";
import HistoryRecordsPage from "./pages/HistoryRecordsPage";
import HistoryH2HPage from "./pages/HistoryH2HPage";
import HistoryCareersPage from "./pages/HistoryCareersPage";
import DraftPage from "./pages/DraftPage";
import PickFuturesPage from "./pages/PickFuturesPage";
import TradesPage from "./pages/TradesPage";
import FranchiseIndexPage from "./pages/FranchiseIndexPage";
import FranchisePage from "./pages/FranchisePage";
import TrophyCasePage from "./pages/TrophyCasePage";
import TradeAdminPage from "./pages/TradeAdminPage";
import DraftAdminPage from "./pages/DraftAdminPage";
import PickAdminPage from "./pages/PickAdminPage";
import DraftOrderAdminPage from "./pages/DraftOrderAdminPage";
import WeeklySummaryAdminPage from "./pages/WeeklySummaryAdminPage";
import DataAdminPage from "./pages/DataAdminPage";

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LeaguePage />} />
          <Route path="team" element={<MyTeamPage />} />
          <Route path="matchups" element={<MatchupsPage />} />
          <Route path="history" element={<HistoryStandingsPage />} />
          <Route path="history/records" element={<HistoryRecordsPage />} />
          <Route path="history/h2h" element={<HistoryH2HPage />} />
          <Route path="history/careers" element={<HistoryCareersPage />} />
          <Route path="draft" element={<DraftPage />} />
          <Route path="draft/futures" element={<PickFuturesPage />} />
          <Route path="trades" element={<TradesPage />} />
          <Route path="franchises" element={<FranchiseIndexPage />} />
          <Route path="franchise/:teamId" element={<FranchisePage />} />
          <Route path="trophies" element={<TrophyCasePage />} />
          <Route path="admin/trades" element={<TradeAdminPage />} />
          <Route path="admin/drafts" element={<DraftAdminPage />} />
          <Route path="admin/picks" element={<PickAdminPage />} />
          <Route path="admin/draft-order" element={<DraftOrderAdminPage />} />
          <Route path="admin/weekly-summary" element={<WeeklySummaryAdminPage />} />
          <Route path="admin/data" element={<DataAdminPage />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
