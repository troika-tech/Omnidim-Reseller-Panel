import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";

const Sidebar = ({
  activeRoute,
  onRouteChange,
  isOpen,
  theme,
  onToggleSidebar,
}) => {
  const { logout, user } = useAuth();
  const { showConfirm } = useToast();

  // Check if user is admin
  const isAdmin = user?.role === "admin";

  const handleLogout = () => {
    showConfirm(
      "Are you sure you want to sign out?",
      () => {
        logout();
      },
      () => {
        // User clicked No, do nothing
      }
    );
  };
  // Icon Component - Clean line art style
  const Icon = ({ children, className = "" }) => (
    <svg
      className={`w-5 h-5 flex-shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );

  // Admin menu items
  const adminMenuItems = [
    {
      id: "voice-assistants",
      name: "Voice AI Assistants",
      icon: (
        <Icon>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <circle cx="15" cy="9" r="1.5" />
          <path d="M9 13h6" />
          <path d="M12 10v3" />
        </Icon>
      ),
    },
    {
      id: "files",
      name: "Files",
      icon: (
        <Icon>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </Icon>
      ),
    },
    {
      id: "phone-numbers",
      name: "Phone Numbers",
      icon: (
        <Icon>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </Icon>
      ),
    },
    {
      id: "call-logs",
      name: "Call Logs",
      icon: (
        <Icon>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </Icon>
      ),
    },
    // {
    //   id: "incoming-calls",
    //   name: "Incoming Calls",
    //   icon: (
    //     <Icon>
    //       <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    //       <path d="M19 9l-7 7-4-4" />
    //     </Icon>
    //   ),
    // },
    {
      id: "bulk-call",
      name: "Bulk Call",
      icon: (
        <Icon>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Icon>
      ),
    },
    {
      id: "user-management",
      name: "User Management",
      icon: (
        <Icon>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Icon>
      ),
    },
  ];

  // User menu items
  const userMenuItems = [
    {
      id: "user/overview",
      name: "Overview",
      icon: (
        <Icon>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="15" x2="15" y2="15" />
          <line x1="9" y1="12" x2="15" y2="12" />
        </Icon>
      ),
    },
    // {
    //   id: "user/incoming-calls",
    //   name: "Incoming Calls",
    //   icon: (
    //     <Icon>
    //       <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    //     </Icon>
    //   ),
    // },
    {
      id: "user/bulk-calls",
      name: "Bulk Calls",
      icon: (
        <Icon>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Icon>
      ),
    },
    {
      id: "user/call-logs",
      name: "Call Logs",
      icon: (
        <Icon>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </Icon>
      ),
    },
  ];

  // Select menu items based on user role
  const menuItems = isAdmin ? adminMenuItems : userMenuItems;

  return (
    <aside
      className={`
          fixed top-0 left-0 z-30 h-screen
          bg-white dark:bg-gray-800
          border-r border-gray-200 dark:border-gray-700
          transform transition-all duration-300 ease-in-out
          ${
            isOpen
              ? "w-64 translate-x-0"
              : "-translate-x-full lg:translate-x-0 lg:w-16"
          }
          shadow-lg lg:shadow-none
        `}
    >
      {/* Logo and Close Button */}
      <div
        className={`border-b border-gray-200 dark:border-gray-700 transition-all duration-300 ${
          isOpen ? "p-6" : "p-4 flex justify-center items-center"
        } relative`}
      >
        <img
          src="https://raw.githubusercontent.com/troikatechindia/Asset/refs/heads/main/logo.png"
          alt="OMNIDIMENSION"
          className={`transition-all duration-300 ${
            isOpen ? "h-8 w-auto" : "h-8 w-8 object-contain"
          }`}
        />
        {/* Close Button - Only show on mobile when sidebar is open */}
        {isOpen && onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="lg:hidden absolute top-4 right-4 p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition text-gray-600 dark:text-gray-300"
            title="Close Sidebar"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav
        className={`flex flex-col h-[calc(100vh-81px)] transition-all duration-300 ${
          isOpen ? "p-4" : "p-2"
        }`}
      >
        {/* Menu Items */}
        <div
          className={`flex-1 overflow-y-auto transition-all duration-300 ${
            isOpen ? "space-y-1" : "space-y-1"
          }`}
        >
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onRouteChange(item.id)}
              title={!isOpen ? item.name : ""}
              className={`
                  w-full flex items-center transition-all duration-300 rounded-lg mb-1
                  ${isOpen ? "gap-3 px-4 py-3" : "justify-center px-2 py-3"}
                  ${
                    activeRoute === item.id
                      ? "bg-cyan-600 text-white shadow-md"
                      : theme === "dark"
                      ? "text-gray-300 hover:bg-gray-700"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }
                `}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {isOpen && (
                <span className="font-medium whitespace-nowrap">
                  {item.name}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sign Out Button at Bottom */}
        <div
          className={`border-t border-gray-200 dark:border-gray-700 transition-all duration-300 ${
            isOpen ? "pt-4 mt-4" : "pt-2 mt-2"
          }`}
        >
          <button
            onClick={handleLogout}
            title={!isOpen ? "Sign out" : ""}
            className={`
                w-full flex items-center transition-all duration-300 rounded-lg
                ${isOpen ? "gap-3 px-4 py-3" : "justify-center px-2 py-3"}
                text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20
              `}
          >
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            {isOpen && (
              <span className="font-medium whitespace-nowrap">Sign out</span>
            )}
          </button>
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
