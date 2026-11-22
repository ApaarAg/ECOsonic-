import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { SiteProvider } from '../../context/SiteContext';

export const AppLayout: React.FC = () => {
  return (
    <SiteProvider>
      <div className="flex flex-col h-screen overflow-hidden bg-forest-950 text-gray-100">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-forest-950 p-5 lg:p-7">
            <Outlet />
          </main>
        </div>
      </div>
    </SiteProvider>
  );
};
