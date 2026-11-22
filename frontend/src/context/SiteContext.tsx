import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Site } from '../types';
import { sitesService } from '../services/sitesService';

interface SiteContextType {
  sites: Site[];
  selectedSite: Site | null;
  setSelectedSite: (site: Site | null) => void;
  loadingSites: boolean;
  refreshSites: () => Promise<void>;
}

const SiteContext = createContext<SiteContextType | undefined>(undefined);

export const SiteProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [loadingSites, setLoadingSites] = useState<boolean>(true);

  const refreshSites = async () => {
    try {
      setLoadingSites(true);
      const data = await sitesService.getSites();
      setSites(data);
      if (data.length > 0 && !selectedSite) {
        setSelectedSite(data[0]);
      }
    } catch (err) {
      console.error('Failed to load monitoring sites:', err);
    } finally {
      setLoadingSites(false);
    }
  };

  useEffect(() => {
    refreshSites();
  }, []);

  return (
    <SiteContext.Provider
      value={{
        sites,
        selectedSite,
        setSelectedSite,
        loadingSites,
        refreshSites,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
};

export const useSiteContext = (): SiteContextType => {
  const context = useContext(SiteContext);
  if (!context) {
    throw new Error('useSiteContext must be used within a SiteProvider');
  }
  return context;
};
