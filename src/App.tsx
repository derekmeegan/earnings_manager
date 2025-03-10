import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Layout from './components/Layout';
import EarningsCalendar from './components/EarningsCalendar';
import HistoricalMetrics from './components/HistoricalMetrics';
import CompanyConfig from './components/CompanyConfig';
import Messages from './components/Messages';

function App() {
  return (
    <Router>
      <ToastContainer position="top-right" autoClose={3000} />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Messages />} />
          <Route path="calendar" element={<EarningsCalendar />} />
          <Route path="historical-metrics" element={<HistoricalMetrics />} />
          <Route path="company-config" element={<CompanyConfig />} />
          {/* Catch-all route for 404 pages */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;