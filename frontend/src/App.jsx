import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  Outlet,
} from "react-router-dom";
import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ToastProvider } from "./contexts/ToastContext";
import VoiceAssistants from "./pages/VoiceAssistants";
import FilesManagement from "./pages/FilesManagement";
import PhoneNumbers from "./pages/PhoneNumbers";
import CallLogs from "./pages/CallLogs";
import IncomingCalls from "./pages/IncomingCalls";
import BulkCalls from "./pages/BulkCalls";
import BulkCallDetails from "./pages/BulkCallDetails";
import UserManagement from "./pages/UserManagement";
import Login from "./pages/Login";
import UserIncomingCalls from "./user/pages/IncomingCalls";
import UserBulkCalls from "./user/pages/BulkCalls";
import UserBulkCallDetails from "./user/pages/BulkCallDetails";
import UserCallLogs from "./user/pages/CallLogs";
import UserOverview from "./user/pages/Overview";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import "./App.css";

function AppLayout() {
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [sidebarOpen, setSidebarOpen] = useState(
    localStorage.getItem("sidebarOpen") !== "false"
  );
  const location = useLocation();
  const navigate = useNavigate();

  // Apply theme to document
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    }
  }, [theme]);

  // Save sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem("sidebarOpen", sidebarOpen.toString());
  }, [sidebarOpen]);

  const handleThemeChange = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  };

  const handleRouteChange = (routeId) => {
    navigate(`/${routeId}`);
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  // Get active route from pathname
  // Handle bulk-call routes specially
  const pathParts = location.pathname.split("/").filter(Boolean);
  // For user routes, include the full path (e.g., 'user/incoming-calls')
  const activeRoute =
    pathParts.length > 1 && pathParts[0] === "user"
      ? `${pathParts[0]}/${pathParts[1]}`
      : pathParts[0] || "voice-assistants";

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden w-full">
      {/* Sidebar */}
      <Sidebar
        activeRoute={activeRoute}
        onRouteChange={handleRouteChange}
        isOpen={sidebarOpen}
        theme={theme}
        onToggleSidebar={toggleSidebar}
      />

      {/* Overlay for mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div
        className={`flex-1 transition-all duration-300 min-w-0 ${
          sidebarOpen ? "lg:ml-64" : "ml-0 lg:ml-16"
        }`}
      >
        {/* Header */}
        <Header
          theme={theme}
          onThemeChange={handleThemeChange}
          onToggleSidebar={toggleSidebar}
          sidebarOpen={sidebarOpen}
        />

        {/* Page Content */}
        <div className="p-3 sm:p-4 md:p-6 max-w-full overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

// Protected Route Component
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function DefaultRedirect() {
  const { user } = useAuth();

  if (user?.role === "admin") {
    return <Navigate to="/voice-assistants" replace />;
  } else {
    return <Navigate to="/user/overview" replace />;
  }
}

function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DefaultRedirect />} />
          <Route path="voice-assistants" element={<VoiceAssistants />} />
          <Route path="files" element={<FilesManagement />} />
          <Route path="phone-numbers" element={<PhoneNumbers />} />
          <Route path="call-logs" element={<CallLogs />} />
          <Route path="incoming-calls" element={<IncomingCalls />} />
          <Route path="bulk-call" element={<BulkCalls />} />
          <Route path="bulk-call/:id" element={<BulkCallDetails />} />
          <Route path="user-management" element={<UserManagement />} />

          {/* User Routes */}
          <Route path="user/overview" element={<UserOverview />} />
          <Route path="user/incoming-calls" element={<UserIncomingCalls />} />
          <Route path="user/bulk-calls" element={<UserBulkCalls />} />
          <Route path="user/bulk-calls/:id" element={<UserBulkCallDetails />} />
          <Route path="user/call-logs" element={<UserCallLogs />} />
        </Route>
      </Routes>
    </Router>
  );
}

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
