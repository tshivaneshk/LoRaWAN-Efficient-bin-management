import { create } from 'zustand';

export type ScreenRoute =
  | 'command-center'
  | 'pipeline'
  | 'bin-detail'
  | 'network'
  | 'operations'
  | 'scenario'
  | 'energy';

export type RightPanelTab = 'alerts' | 'bins' | 'fleet';

export interface MapLayerVisibility {
  base: boolean;
  zones: boolean;
  coverageHeatmap: boolean;
  radioLinks: boolean;
  bins: boolean;
  gateways: boolean;
  trucks: boolean;
  particles: boolean;
}

interface UiState {
  theme: 'dark' | 'light';
  activeRoute: ScreenRoute;
  selectedBinId: string;
  selectedPacketId: string | null;
  selectedPipelineHop: string;
  binDrawerOpen: boolean;
  binDetailTab: 'overview' | 'hardware' | 'sensor' | 'radio' | 'energy';
  rightPanelTab: RightPanelTab;
  timelineCollapsed: boolean;
  mapLayers: MapLayerVisibility;
  coverageSfPreview: 7 | 8 | 9 | 10 | 11 | 12;
  hardwareDialogOpen: boolean;
  hardwareConnectionState: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  hardwareMethod: 'WEBSOCKET' | 'WEBSERIAL' | null;
  hardwareErrorText: string | null;

  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  setActiveRoute: (route: ScreenRoute) => void;
  selectBin: (binId: string, openDrawer?: boolean) => void;
  setBinDrawerOpen: (open: boolean) => void;
  setBinDetailTab: (tab: UiState['binDetailTab']) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setTimelineCollapsed: (collapsed: boolean) => void;
  toggleMapLayer: (layer: keyof MapLayerVisibility) => void;
  setCoverageSfPreview: (sf: 7 | 8 | 9 | 10 | 11 | 12) => void;
  setSelectedPacketId: (id: string | null) => void;
  setSelectedPipelineHop: (hop: string) => void;
  setHardwareDialogOpen: (open: boolean) => void;
  setHardwareConnection: (
    state: UiState['hardwareConnectionState'],
    method?: UiState['hardwareMethod'],
    errorText?: string | null
  ) => void;
}

const getInitialTheme = (): 'dark' | 'light' => {
  try {
    const saved = localStorage.getItem('northgate-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  return 'dark';
};

export const useUiStore = create<UiState>((set) => ({
  theme: getInitialTheme(),
  activeRoute: 'command-center',
  selectedBinId: 'BIN-07',
  selectedPacketId: null,
  selectedPipelineHop: 'gateway',
  binDrawerOpen: false,
  binDetailTab: 'overview',
  rightPanelTab: 'alerts',
  timelineCollapsed: false,
  mapLayers: {
    base: true,
    zones: true,
    coverageHeatmap: true,
    radioLinks: true,
    bins: true,
    gateways: true,
    trucks: true,
    particles: true,
  },
  coverageSfPreview: 7,
  hardwareDialogOpen: false,
  hardwareConnectionState: 'DISCONNECTED',
  hardwareMethod: null,
  hardwareErrorText: null,

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('northgate-theme', theme);
    } catch {
      // ignore
    }
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('northgate-theme', next);
      } catch {
        // ignore
      }
      return { theme: next };
    }),
  setActiveRoute: (activeRoute) => set({ activeRoute }),
  selectBin: (binId, openDrawer = true) =>
    set({ selectedBinId: binId, binDrawerOpen: openDrawer }),
  setBinDrawerOpen: (binDrawerOpen) => set({ binDrawerOpen }),
  setBinDetailTab: (binDetailTab) => set({ binDetailTab }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setTimelineCollapsed: (timelineCollapsed) => set({ timelineCollapsed }),
  toggleMapLayer: (layer) =>
    set((state) => ({
      mapLayers: { ...state.mapLayers, [layer]: !state.mapLayers[layer] },
    })),
  setCoverageSfPreview: (coverageSfPreview) => set({ coverageSfPreview }),
  setSelectedPacketId: (selectedPacketId) => set({ selectedPacketId }),
  setSelectedPipelineHop: (selectedPipelineHop) => set({ selectedPipelineHop }),
  setHardwareDialogOpen: (hardwareDialogOpen) => set({ hardwareDialogOpen }),
  setHardwareConnection: (hardwareConnectionState, hardwareMethod = null, hardwareErrorText = null) =>
    set({ hardwareConnectionState, hardwareMethod, hardwareErrorText }),
}));
