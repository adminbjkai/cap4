import type { ReactNode } from "react";
import type { RailTab } from "./shared";

type VideoRailProps = {
  railTab: RailTab;
  renderedRailTab: RailTab;
  outgoingRailTab: RailTab | null;
  onSelectTab: (tab: RailTab) => void;
  renderRailTabContent: (tab: RailTab) => ReactNode;
};

const TABS: RailTab[] = ["notes", "summary", "transcript"];

export function VideoRail({
  railTab,
  renderedRailTab,
  outgoingRailTab,
  onSelectTab,
  renderRailTabContent,
}: VideoRailProps) {
  return (
    <div className="min-w-0">
      <div
        className="flex max-h-[520px] flex-col overflow-hidden rounded-xl border shadow-card"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
      >
        <div className="rail-tab-bar">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onSelectTab(tab)}
              className={`rail-tab ${railTab === tab ? "rail-tab-active" : ""}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="rail-tab-stack scroll-panel">
          {outgoingRailTab && (
            <div className="rail-tab-panel-exit">{renderRailTabContent(outgoingRailTab)}</div>
          )}
          <div key={renderedRailTab} className="rail-tab-panel-enter">
            {renderRailTabContent(renderedRailTab)}
          </div>
        </div>
      </div>
    </div>
  );
}
