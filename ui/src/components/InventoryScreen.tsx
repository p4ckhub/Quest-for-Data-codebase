
import React from "react";
import { useGameStore } from "../store";

export const InventoryScreen: React.FC = () => {
  const { save, setScreen } = useGameStore();
  const items = save?.inventory ?? [];

  return (
    <div className="inventory-screen">
      <h2>Inventory</h2>
      {items.length === 0 && <p>Your pack is empty — rewards from lessons and battles land here.</p>}
      <div className="inventory-grid">
        {items.map((item) => (
          <div key={item.item_id} className="item-slot filled">
            <span className="item-name">{item.item_id.replace(/_/g, " ")}</span>
            <span className="item-count">×{item.count}</span>
          </div>
        ))}
      </div>
      <button className="btn" onClick={() => setScreen("world-map")}>Back</button>
    </div>
  );
};
