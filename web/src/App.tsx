import { Route, Routes } from "react-router-dom";
import { AppProvider } from "./state/AppContext";
import Layout from "./components/Layout";
import LeaguePage from "./pages/LeaguePage";
import MyTeamPage from "./pages/MyTeamPage";
import MatchupsPage from "./pages/MatchupsPage";
import HistoryRecordsPage from "./pages/HistoryRecordsPage";
import HistoryH2HPage from "./pages/HistoryH2HPage";
import HistoryCareersPage from "./pages/HistoryCareersPage";
import DraftPage from "./pages/DraftPage";
import PickFuturesPage from "./pages/PickFuturesPage";
import TradesPage from "./pages/TradesPage";
import FranchisePage from "./pages/FranchisePage";
import TrophyCasePage from "./pages/TrophyCasePage";
import AdminGatePage from "./pages/AdminGatePage";
import TradeAnalyzerPage from "./pages/TradeAnalyzerPage";
import BuyLowPage from "./pages/BuyLowPage";
import PositionalStrengthPage from "./pages/PositionalStrengthPage";
import TradePartnersPage from "./pages/TradePartnersPage";
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
          <Route path="history" element={<HistoryRecordsPage />} />
          <Route path="history/h2h" element={<HistoryH2HPage />} />
          <Route path="history/careers" element={<HistoryCareersPage />} />
          <Route path="draft" element={<DraftPage />} />
          <Route path="draft/futures" element={<PickFuturesPage />} />
          <Route path="trades" element={<TradesPage />} />
          <Route path="franchise/:teamId" element={<FranchisePage />} />
          <Route path="trophies" element={<TrophyCasePage />} />
          <Route path="admin" element={<AdminGatePage />} />
          <Route path="admin/trade-analyzer" element={<TradeAnalyzerPage />} />
          <Route path="admin/buy-low" element={<BuyLowPage />} />
          <Route path="admin/positions" element={<PositionalStrengthPage />} />
          <Route path="admin/trade-partners" element={<TradePartnersPage />} />
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
