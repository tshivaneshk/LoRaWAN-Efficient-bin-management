import React, { useEffect } from 'react';
import { FooterBar, LeftRail, TopBar } from '../components/AppShell';
import { HardwareBridgeModal } from '../components/HardwareBridgeModal';
import { BinDetailView } from '../features/bin-detail/BinDetailView';
import { CommandCenterScreen } from '../features/command-center/CommandCenterScreen';
import { EnergyLabScreen } from '../features/energy/EnergyLabScreen';
import { NetworkScreen } from '../features/network/NetworkScreen';
import { OperationsScreen } from '../features/operations/OperationsScreen';
import { PipelineScreen } from '../features/pipeline/PipelineScreen';
import { ScenarioScreen } from '../features/scenario/ScenarioScreen';
import { startLiveBridge } from '../lib/liveBridge';
import { useSimStore } from '../store/simStore';
import { useUiStore } from '../store/uiStore';

export const App: React.FC = () => {
  const initWorker = useSimStore((s) => s.initWorker);
  const activeRoute = useUiStore((s) => s.activeRoute);
  const binDrawerOpen = useUiStore((s) => s.binDrawerOpen);
  const setBinDrawerOpen = useUiStore((s) => s.setBinDrawerOpen);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    initWorker();
    const stopBridge = startLiveBridge();
    return () => {
      stopBridge();
    };
  }, [initWorker, theme]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg)] text-[var(--text)] overflow-hidden">
      <TopBar />

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <LeftRail />

        <main className="flex-1 min-w-0 h-full overflow-hidden relative">
          {activeRoute === 'command-center' && <CommandCenterScreen />}
          {activeRoute === 'pipeline' && <PipelineScreen />}
          {activeRoute === 'bin-detail' && <BinDetailView isDrawer={false} />}
          {activeRoute === 'network' && <NetworkScreen />}
          {activeRoute === 'operations' && <OperationsScreen />}
          {activeRoute === 'scenario' && <ScenarioScreen />}
          {activeRoute === 'energy' && <EnergyLabScreen />}

          {/* Slide-over Bin Detail Drawer when opened from Command Center or Operations */}
          {binDrawerOpen && activeRoute !== 'bin-detail' && (
            <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[1px]">
              <div
                className="flex-1"
                onClick={() => setBinDrawerOpen(false)}
                aria-hidden="true"
              />
              <div className="w-full max-w-4xl h-full bg-[var(--surface-1)] border-l border-[var(--border-strong)] shadow-2xl transition-transform duration-200 ease-out">
                <BinDetailView isDrawer={true} />
              </div>
            </div>
          )}
        </main>
      </div>

      <FooterBar />
      <HardwareBridgeModal />
    </div>
  );
};
